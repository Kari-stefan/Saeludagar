import express from 'express';
import multer from 'multer';
import { requireEventAccess, requireTeacher } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { setFlash } from '../middleware/flash.js';
import { attendanceWindow, setAttendance } from '../services/attendance.js';
import { createMessageCooldown, queueTeacherMessage, validateMessage } from '../services/email.js';
import {
  addCoteacher, coteacherCandidates, createEvent, deleteEvent, moveEvent, ownerCandidates, publishEvent, removeCoteacher,
  updateEvent, validateEvent,
} from '../services/events.js';
import {
  cleanImage, deleteImage, MAX_IMAGE_BYTES, MAX_IMAGES_PER_EVENT, saveImage,
} from '../services/images.js';
import { brautList } from '../services/import.js';
import { getSettings } from '../services/settings.js';
import {
  addStudentToEvent, eventParticipants, eventPeople, removeStudentFromEvent, searchStudentsForEvent, signupWindow,
} from '../services/signups.js';

const collator = new Intl.Collator('is');

// BR-27, §8: up to 5 images of at most 2 MB each, read into memory and checked by their content.
// fieldArrayIndexLimit refuses a field name with a huge index, which would otherwise make a list
// that takes minutes to walk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES_PER_EVENT, fields: 200, fieldArrayIndexLimit: 200 },
}).array('images', MAX_IMAGES_PER_EVENT);

// A multer error (such as an image over 2 MB, or a sixth image) becomes a message on the images.
function readImages(req, res, next) {
  upload(req, res, (err) => {
    if (err) {
      const tooMany = err.code === 'LIMIT_FILE_COUNT' || (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === 'images');
      req.imageError = err.code === 'LIMIT_FILE_SIZE' ? 'events.errors.imageTooLarge'
        : tooMany ? 'events.errors.tooManyImages' : 'events.errors.imageUpload';
    }
    next();
  });
}

// The chosen images, without their metadata (BR-71): { error } or { images } from cleanImage,
// ready for saveImage. Nothing is saved yet, so a file of the wrong type or one that cannot be read
// is a message on the images like any other. An empty file field counts as none.
function uploadedImages(req) {
  if (req.imageError) return { error: req.imageError };
  const images = (req.files ?? []).filter((file) => file.size > 0).map((file) => cleanImage(file.buffer));
  const failed = images.find((image) => image.error);
  return failed ? { error: failed.error } : { images };
}

// A form value that may be sent once or several times, as a list of whole numbers.
function idList(value) {
  const sent = typeof value === 'string' ? [value] : Array.isArray(value) ? Object.values(value) : [];
  return sent.map(Number).filter(Number.isSafeInteger);
}

// A request from a page's script (the attendance list, the "Nýr viðburður" dialog), which wants a
// JSON answer instead of a page.
const wantsJson = (req) => Boolean(req.get('Accept')?.includes('application/json'));

// Mounted at /teacher; event managers and admins only (BR-67).
export function teacherRouter({ config, db }) {
  const router = express.Router();
  router.use(requireTeacher);
  const access = (level) => requireEventAccess(db, level);

  // The teacher home moved to the front page (§6); old links keep working.
  router.get('/', (req, res) => res.redirect(303, '/#managed-events'));

  // The form offers the Sæludagar days (BR-21) and the braut list (BR-18), plus the event's own
  // brautir, so an edit never drops one that is no longer on the list.
  const formOptions = (event) => ({
    maxImages: MAX_IMAGES_PER_EVENT,
    maxImageBytes: MAX_IMAGE_BYTES,
    days: getSettings(db).days,
    brautir: [...new Set([...brautList(db), ...(event?.brautir ?? [])])].sort(collator.compare),
  });
  const renderForm = (req, res, status, { event = null, values, errors = {} }) => res.status(status).render('teacher/event-form', {
    ...formOptions(event),
    event,
    values,
    errors,
    access: req.eventAccess ?? 'owner',
    candidates: event && req.eventAccess === 'owner' ? coteacherCandidates(db, event) : [],
    ownerChoices: event && req.user.isAdmin ? ownerCandidates(db, event) : null, // BR-72: admins only
  });

  router.get('/events/new', (req, res) => renderForm(req, res, 200, { values: { brautir: [] } }));

  // Saves the uploaded images and returns their file names. If one cannot be saved, those saved
  // before it are deleted again.
  const deleteImages = (names) => Promise.all(names.map((name) => deleteImage(config.uploadDir, name)));
  async function saveImages(images) {
    const names = [];
    try {
      for (const image of images) names.push(await saveImage(config.uploadDir, image));
    } catch (err) {
      await deleteImages(names);
      throw err;
    }
    return names;
  }

  // The form is multipart (it has the images), so the CSRF token is checked after multer.
  // The front page's dialog (§6) posts here too and wants JSON: the errors for it to show next to
  // the fields, which keeps what was entered and the chosen images.
  router.post('/events/new', readImages, verifyCsrf, async (req, res) => {
    const { values, errors } = validateEvent(req.body ?? {}, formOptions());
    const refuse = (found) => {
      if (!wantsJson(req)) return renderForm(req, res, 400, { values, errors: found });
      const messages = Object.fromEntries(Object.entries(found).map(([field, key]) => [field, res.locals.t(key, { max: MAX_IMAGES_PER_EVENT })]));
      return res.status(400).json({ ok: false, errors: messages });
    };
    const uploaded = uploadedImages(req);
    if (uploaded.error) errors.images = uploaded.error;
    if (Object.keys(errors).length > 0) return refuse(errors);

    const files = await saveImages(uploaded.images);
    let result;
    try {
      result = createEvent(db, req.user.id, values, files);
    } catch (err) {
      await deleteImages(files);
      throw err;
    }
    if (result.error) {
      await deleteImages(files);
      return refuse({ [result.field]: result.error });
    }
    setFlash(req, 'success', 'events.created');
    if (wantsJson(req)) return res.json({ ok: true, id: result.id });
    res.redirect(303, `/teacher/events/${result.id}`);
  });

  router.get('/events/:id/edit', access('editor'), (req, res) => {
    renderForm(req, res, 200, { event: req.event, values: req.event });
  });

  // BR-28: a published event stays editable; the maximum cannot go below the sign-ups.
  router.post('/events/:id/edit', access('editor'), readImages, verifyCsrf, async (req, res) => {
    const { event } = req;
    const body = req.body ?? {};
    const { values, errors } = validateEvent(body, { ...formOptions(event), signups: event.signups });
    // New images go after the saved ones; the ticked saved ones are dropped (BR-27).
    const uploaded = uploadedImages(req);
    const removeImages = idList(body.remove_images);
    const kept = event.images.filter((image) => !removeImages.includes(image.id)).length;
    if (uploaded.error) errors.images = uploaded.error;
    else if (kept + uploaded.images.length > MAX_IMAGES_PER_EVENT) errors.images = 'events.errors.tooManyImages';
    if (Object.keys(errors).length > 0) return renderForm(req, res, 400, { event, values, errors });

    const files = await saveImages(uploaded.images);
    let result;
    try {
      result = updateEvent(db, event, values, { addImages: files, removeImages });
    } catch (err) {
      await deleteImages(files);
      throw err;
    }
    if (result.error) {
      await deleteImages(files);
      return renderForm(req, res, 400, { event, values, errors: { [result.field]: result.error } });
    }
    await deleteImages(result.removed);
    setFlash(req, 'success', 'events.saved');
    res.redirect(303, `/teacher/events/${event.id}`);
  });

  // BR-22: exactly as students will see it, drafts included. So "Hópur" shows only the count,
  // as it does for a student (BR-68).
  router.get('/events/:id/preview', access('editor'), (req, res) => {
    res.render('teacher/preview', {
      event: req.event,
      window: signupWindow(db),
      ...eventPeople(db, req.event, { loggedIn: true, access: null }),
    });
  });
  // BR-38, BR-39: the checklist for the event day. Each tick saves on its own from the page's
  // script; without JavaScript the "Vista" button saves the whole list.
  router.get('/events/:id/attendance', access('editor'), (req, res) => {
    res.render('teacher/attendance', {
      event: req.event,
      participants: eventParticipants(db, req.event.id),
      window: attendanceWindow(db, req.event),
    });
  });

  router.post('/events/:id/attendance', access('editor'), (req, res, next) => {
    const { event } = req;
    const body = req.body ?? {};
    const single = body.student !== undefined;
    const ids = (value) => [].concat(value ?? []).map(Number).filter(Number.isSafeInteger);
    let changes;
    if (single) {
      const studentId = Number(body.student);
      if (!Number.isSafeInteger(studentId)) return next(Object.assign(new Error('HTTP 400'), { status: 400 }));
      changes = [{ studentId, attended: body.attended === '1' }];
    } else {
      // Only the rows changed on this page: one loaded earlier must not undo newer ticks (and,
      // through BR-41, delete a course choice).
      const present = new Set(ids(body.present));
      const marked = new Set(ids(body.marked));
      changes = ids(body.listed)
        .filter((studentId) => present.has(studentId) !== marked.has(studentId))
        .map((studentId) => ({ studentId, attended: present.has(studentId) }));
    }
    const result = setAttendance(db, req.user.id, event, changes);
    const error = result.error ?? (result.own > 0 ? 'attendance.errors.own'
      : single && result.missing > 0 ? 'attendance.errors.notSignedUp' : null);

    if (wantsJson(req)) {
      if (error) return res.status(409).json({ ok: false, message: res.locals.t(error) });
      const counts = db.prepare('SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE attended = 1) AS count FROM registrations WHERE event_id = ?')
        .get(event.id);
      return res.json({ ok: true, message: res.locals.t('attendance.saved'), summary: res.locals.t('attendance.count', counts) });
    }
    if (error) setFlash(req, 'error', error);
    else setFlash(req, 'success', 'attendance.savedAll');
    res.redirect(303, `/teacher/events/${event.id}/attendance`);
  });

  // BR-51: name, braut and an empty box per participant, for printing.
  router.get('/events/:id/print', access('editor'), (req, res) => {
    res.render('teacher/print', { event: req.event, participants: eventParticipants(db, req.event.id) });
  });

  // BR-50: a message to everyone signed up, sent from the noreply address with the teacher as Reply-To.
  const recipientsOf = (event) => eventParticipants(db, event.id).filter((student) => student.active);
  const messageCooldown = createMessageCooldown(); // BR-50: one message per event every 5 minutes
  const renderMessage = (req, res, status, { values = {}, errors = {}, minutes = 0 } = {}) => res.status(status).render('teacher/message', {
    event: req.event,
    minutes,
    recipients: recipientsOf(req.event).length,
    values,
    errors,
    limits: validateMessage({}).limits,
  });

  router.get('/events/:id/message', access('editor'), (req, res) => renderMessage(req, res, 200));

  router.post('/events/:id/message', access('editor'), (req, res) => {
    const { event } = req;
    const { values, errors } = validateMessage(req.body ?? {});
    const recipients = recipientsOf(event);
    if (recipients.length === 0) errors.recipients = 'message.errors.noRecipients';
    if (Object.keys(errors).length > 0) return renderMessage(req, res, 400, { values, errors });
    const minutes = messageCooldown.minutesLeft(event.id);
    if (minutes > 0) return renderMessage(req, res, 400, { values, errors: { cooldown: 'message.errors.cooldown' }, minutes });
    const count = queueTeacherMessage(db, {
      event, teacherId: req.user.id, studentIds: recipients.map((student) => student.id), ...values,
    });
    messageCooldown.start(event.id);
    setFlash(req, 'success', 'message.sent', { count });
    res.redirect(303, `/teacher/events/${event.id}`);
  });

  function refusalParams(result, res) {
    if (!result.event) return result.params ?? {};
    const other = result.event;
    return {
      title: res.locals.eventText(other, 'title'),
      when: `${res.locals.formatDate(other.event_date)}, ${res.locals.formatTimeRange(other.start_time, other.end_time)}`,
    };
  }

  router.get('/events/:id', access('editor'), (req, res) => {
    const participants = eventParticipants(db, req.event.id);
    const search = searchStudentsForEvent(db, req.event.id, req.query.search);
    res.render('teacher/event', {
      event: req.event,
      access: req.eventAccess,
      participants,
      studentSearch: search.search,
      studentResults: search.students,
    });
  });

  // Publish (owner, co-teacher or admin); delete and co-teachers (owner or admin only, BR-29, §6);
  // moving the event to another event manager (admin only, BR-72).
  router.post('/events/:id', access('editor'), async (req, res, next) => {
    const { event } = req;
    const body = req.body ?? {};
    const back = `/teacher/events/${event.id}`;
    if (body.action === 'publish') {
      publishEvent(db, event);
      setFlash(req, 'success', 'events.published');
      return res.redirect(303, back);
    }
    if (!['delete', 'add-coteacher', 'remove-coteacher', 'add-student', 'remove-student', 'move-event'].includes(body.action)) {
      return next(Object.assign(new Error('HTTP 400'), { status: 400 }));
    }

    if (body.action === 'add-student' || body.action === 'remove-student') {
      const studentId = Number(body.student);
      if (!Number.isSafeInteger(studentId)) return next(Object.assign(new Error('HTTP 400'), { status: 400 }));
      const result = body.action === 'add-student'
        ? addStudentToEvent(db, req.user.id, event.id, studentId)
        : removeStudentFromEvent(db, req.user.id, event.id, studentId);
      if (result.ok) setFlash(req, 'success', `events.participants.${body.action === 'add-student' ? 'added' : 'removed'}`);
      else setFlash(req, 'error', result.error, refusalParams(result, res));
      return res.redirect(303, body.action === 'add-student' ? `${back}?search=${encodeURIComponent(String(body.search ?? ''))}` : back);
    }

    if (req.eventAccess !== 'owner') return res.status(403).render('errors/403');

    if (body.action === 'move-event') {
      if (!req.user.isAdmin) return res.status(403).render('errors/403');
      const ownerId = Number(body.owner);
      if (!Number.isSafeInteger(ownerId)) return next(Object.assign(new Error('HTTP 400'), { status: 400 }));
      const result = moveEvent(db, event, ownerId);
      if (result.ok) setFlash(req, 'success', 'events.transfer.moved', { name: result.owner.name });
      else setFlash(req, 'error', result.error);
      return res.redirect(303, `${back}/edit#owner`);
    }

    if (body.action === 'delete') {
      if (body.confirm !== '1') {
        setFlash(req, 'error', 'events.errors.confirmDelete');
        return res.redirect(303, back);
      }
      const result = deleteEvent(db, event, req.user.id);
      if (result.error) {
        setFlash(req, 'error', result.error);
        return res.redirect(303, back);
      }
      await deleteImages(result.images);
      setFlash(req, 'success', 'events.deleted', { title: res.locals.eventText(event, 'title') });
      return res.redirect(303, '/#managed-events');
    }

    const teacherId = Number(body.teacher);
    if (body.action === 'add-coteacher' && addCoteacher(db, event, teacherId)) {
      setFlash(req, 'success', 'events.coteacherAdded');
    } else if (body.action === 'remove-coteacher' && removeCoteacher(db, event, teacherId)) {
      setFlash(req, 'success', 'events.coteacherRemoved');
    }
    res.redirect(303, `${back}/edit#coteachers`);
  });

  return router;
}

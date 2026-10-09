import express from 'express';
import multer from 'multer';
import { requireEventAccess, requireTeacher } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { setFlash } from '../middleware/flash.js';
import {
  addCoteacher, coteacherCandidates, createEvent, deleteEvent, publishEvent, removeCoteacher, teacherEvents, updateEvent,
  validateEvent,
} from '../services/events.js';
import { deleteImage, imageType, MAX_IMAGE_BYTES, saveImage } from '../services/images.js';
import { brautList } from '../services/import.js';
import { getSettings } from '../services/settings.js';

const collator = new Intl.Collator('is');

// BR-27, §8: one image of at most 2 MB, read into memory and checked by its content.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 200 } })
  .single('image');

// A multer error (such as an image over 2 MB) becomes a message on the image field.
function readImage(req, res, next) {
  upload(req, res, (err) => {
    if (err) req.imageError = err.code === 'LIMIT_FILE_SIZE' ? 'events.errors.imageTooLarge' : 'events.errors.imageUpload';
    next();
  });
}

// The chosen image: { error }, { bytes, type }, or {} when none was chosen.
function uploadedImage(req) {
  if (req.imageError) return { error: req.imageError };
  if (!req.file || req.file.size === 0) return {};
  const type = imageType(req.file.buffer);
  return type ? { bytes: req.file.buffer, type } : { error: 'events.errors.imageType' };
}

// Mounted at /teacher; teachers and admins only. Attendance, print and message are stubs until
// milestone 6.
export function teacherRouter({ config, db }) {
  const router = express.Router();
  router.use(requireTeacher);
  const access = (level) => requireEventAccess(db, level);

  router.get('/', (req, res) => res.render('teacher/home', { events: teacherEvents(db, req.user.id), days: getSettings(db).days }));

  // The form offers the Sæludagar days (BR-21) and the braut list (BR-18), plus the event's own
  // brautir, so an edit never drops one that is no longer on the list.
  const formOptions = (event) => ({
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
  });

  router.get('/events/new', (req, res) => renderForm(req, res, 200, { values: { brautir: [] } }));

  // The form is multipart (it has the image), so the CSRF token is checked after multer.
  router.post('/events/new', readImage, verifyCsrf, async (req, res) => {
    const { values, errors } = validateEvent(req.body ?? {}, formOptions());
    const image = uploadedImage(req);
    if (image.error) errors.image = image.error;
    if (Object.keys(errors).length > 0) return renderForm(req, res, 400, { values, errors });

    const imageFile = image.bytes ? await saveImage(config.uploadDir, image.bytes, image.type) : null;
    let result;
    try {
      result = createEvent(db, req.user.id, values, imageFile);
    } catch (err) {
      await deleteImage(config.uploadDir, imageFile);
      throw err;
    }
    if (result.error) {
      await deleteImage(config.uploadDir, imageFile);
      return renderForm(req, res, 400, { values, errors: { [result.field]: result.error } });
    }
    setFlash(req, 'success', 'events.created');
    res.redirect(303, `/teacher/events/${result.id}`);
  });

  router.get('/events/:id/edit', access('editor'), (req, res) => {
    renderForm(req, res, 200, { event: req.event, values: req.event });
  });

  // BR-28: a published event stays editable; the maximum cannot go below the sign-ups.
  router.post('/events/:id/edit', access('editor'), readImage, verifyCsrf, async (req, res) => {
    const { event } = req;
    const body = req.body ?? {};
    const { values, errors } = validateEvent(body, { ...formOptions(event), signups: event.signups });
    const image = uploadedImage(req);
    if (image.error) errors.image = image.error;
    if (Object.keys(errors).length > 0) {
      return renderForm(req, res, 400, { event, values: { ...values, image_file: event.image_file }, errors });
    }

    // A new image replaces the old one; "remove" goes back to the default image (BR-27).
    let imageFile;
    if (image.bytes) imageFile = await saveImage(config.uploadDir, image.bytes, image.type);
    else if (body.remove_image === '1') imageFile = null;
    let result;
    try {
      result = updateEvent(db, event, values, imageFile);
    } catch (err) {
      if (imageFile) await deleteImage(config.uploadDir, imageFile);
      throw err;
    }
    if (result.error) {
      if (imageFile) await deleteImage(config.uploadDir, imageFile);
      const form = { ...values, image_file: event.image_file };
      return renderForm(req, res, 400, { event, values: form, errors: { [result.field]: result.error } });
    }
    if (imageFile !== undefined) await deleteImage(config.uploadDir, event.image_file);
    setFlash(req, 'success', 'events.saved');
    res.redirect(303, `/teacher/events/${event.id}`);
  });

  // BR-22: exactly as students will see it, drafts included.
  router.get('/events/:id/preview', access('editor'), (req, res) => res.render('teacher/preview', { event: req.event }));
  router.get('/events/:id/attendance', access('editor'), (req, res) => res.render('teacher/attendance'));
  router.get('/events/:id/print', access('editor'), (req, res) => res.render('teacher/print'));
  router.get('/events/:id/message', access('editor'), (req, res) => res.render('teacher/message'));

  router.get('/events/:id', access('editor'), (req, res) => {
    res.render('teacher/event', { event: req.event, access: req.eventAccess });
  });

  // Publish (owner, co-teacher or admin); delete and co-teachers (owner or admin only, BR-29, §6).
  router.post('/events/:id', access('editor'), async (req, res, next) => {
    const { event } = req;
    const body = req.body ?? {};
    const back = `/teacher/events/${event.id}`;
    if (body.action === 'publish') {
      publishEvent(db, event);
      setFlash(req, 'success', 'events.published');
      return res.redirect(303, back);
    }
    if (!['delete', 'add-coteacher', 'remove-coteacher'].includes(body.action)) {
      return next(Object.assign(new Error('HTTP 400'), { status: 400 }));
    }
    if (req.eventAccess !== 'owner') return res.status(403).render('errors/403');

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
      await deleteImage(config.uploadDir, result.image);
      setFlash(req, 'success', 'events.deleted', { title: res.locals.eventText(event, 'title') });
      return res.redirect(303, '/teacher');
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

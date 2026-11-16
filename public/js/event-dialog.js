// The "Nýr viðburður" dialog on the front page (AGENT_START §6, §11). Without this script the button
// is a link to the form page. A <dialog> gives the dark backdrop, keeps focus inside and closes on
// Escape. Closing keeps what was entered. Saving sends the form as the form page does and asks
// for JSON, so errors show next to the fields and nothing entered is lost; the server checks
// everything again. A saved event is always a draft (BR-22). The images are chosen, shown and
// removed by public/js/image-preview.js, which the page loads first.
const dialog = document.querySelector('#new-event-dialog');
// Long enough for a 2 MB image on a slow phone connection.
const SAVE_TIMEOUT_MS = 120000;
// A saved draft reloads the page. A click this soon after a reload is the second click of a
// double-click on "Vista drög", which sat where the button now is.
const JUST_RELOADED_MS = 700;

if (dialog) {
  const afterReload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
  const form = dialog.querySelector('form[data-event-form]');
  const formError = form.querySelector('[data-form-error]');
  const progress = form.querySelector('[data-progress]');
  const save = form.querySelector('[data-save]');

  document.querySelector('[data-open-event-dialog]').addEventListener('click', (event) => {
    event.preventDefault();
    if (afterReload && performance.now() < JUST_RELOADED_MS) return;
    dialog.showModal();
    form.elements.title_is.focus();
  });

  for (const button of form.querySelectorAll('[data-dialog-close]')) {
    button.addEventListener('click', () => dialog.close());
  }

  // The control a message belongs to. The one about brautir goes with "Aðeins fyrir nemendur
  // brautar", as on the form page.
  const controlFor = (name) => form.querySelector(`[name="${name === 'brautir' ? 'braut_restricted' : name}"]`);

  function unlinkError(control) {
    control.removeAttribute('aria-invalid');
    const describedBy = (control.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => !id.endsWith('-error')).join(' ');
    if (describedBy) control.setAttribute('aria-describedby', describedBy);
    else control.removeAttribute('aria-describedby');
  }

  function clearErrors() {
    formError.hidden = true;
    formError.textContent = '';
    for (const message of form.querySelectorAll('.field__error')) message.remove();
    for (const control of form.querySelectorAll('[aria-invalid]')) unlinkError(control);
  }

  function showFormError(text) {
    formError.textContent = text;
    formError.hidden = false;
    formError.scrollIntoView({ block: 'nearest' });
  }

  // A message next to its field, linked to it and read out by screen readers (§11).
  function showFieldError(name, text) {
    const message = document.createElement('p');
    message.className = 'field__error';
    message.id = `new-event-${name}-error`;
    message.setAttribute('role', 'alert');
    message.textContent = text;
    const slot = form.querySelector(`[data-error-slot="${name}"]`);
    const control = controlFor(name);
    if (slot) slot.append(message);
    else if (control) control.before(message);
    else {
      showFormError(text);
      return;
    }
    if (control) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', `${control.getAttribute('aria-describedby') ?? ''} ${message.id}`.trim());
    }
  }

  function setBusy(busy) {
    save.disabled = busy;
    form.setAttribute('aria-busy', String(busy));
    if (!busy) progress.hidden = true;
  }

  // Disabling the save button drops keyboard focus. This puts it somewhere useful, unless the
  // person has moved on to another field in the meantime.
  function focusIfDropped(target) {
    if ([document.body, dialog, null].includes(document.activeElement)) target?.focus({ preventScroll: true });
  }

  // Closing the dialog while the form is still on its way to the server stops the save. Once all
  // of it has been sent, the save goes through and the page shows the new draft.
  let sending = null;
  dialog.addEventListener('close', () => sending?.abort());

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors();
    setBusy(true);

    const request = new XMLHttpRequest();
    request.open('POST', form.action);
    request.timeout = SAVE_TIMEOUT_MS;
    request.setRequestHeader('Accept', 'application/json');
    request.setRequestHeader('X-CSRF-Token', form.elements._csrf.value);
    request.upload.addEventListener('progress', (sent) => {
      if (!sent.lengthComputable) return;
      progress.hidden = false;
      progress.value = (sent.loaded / sent.total) * 100;
    });
    const failed = (text) => {
      setBusy(false);
      showFormError(text);
      focusIfDropped(save);
    };
    request.addEventListener('load', () => {
      let reply = null;
      try {
        reply = JSON.parse(request.responseText);
      } catch {
        // Not JSON: a page, such as the login page or an error page. Handled below.
      }
      if (request.status === 200 && reply?.ok) {
        // The confirmation and the new draft are on the front page. Emptied first, because some
        // browsers fill a form in again after a reload, which would invite saving it twice.
        form.reset();
        location.hash = 'managed-events';
        location.reload();
        return;
      }
      if (reply?.errors) {
        setBusy(false);
        for (const [name, text] of Object.entries(reply.errors)) showFieldError(name, text);
        focusIfDropped(form.querySelector('[aria-invalid="true"]'));
        form.querySelector('.field__error')?.scrollIntoView({ block: 'center' });
        return;
      }
      // Without a login the server sends the request on to the login page; without the right, or
      // with a token from an earlier login, it answers 403.
      const loginEnded = request.status === 403 || new URL(request.responseURL, location.href).pathname === '/login';
      failed(loginEnded ? form.dataset.sessionEnded : form.dataset.error);
    });
    request.addEventListener('error', () => failed(form.dataset.error));
    request.addEventListener('timeout', () => failed(form.dataset.error));
    request.addEventListener('abort', () => setBusy(false));
    request.upload.addEventListener('loadend', () => {
      sending = null;
    });
    sending = request;
    request.send(new FormData(form));
  });
}

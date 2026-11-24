// The attendance checklist (AGENT_START §11, BR-38): each tick saves as soon as it changes. The
// page works without this script, through its "Vista" button, which the script hides while
// saving works and shows again if a save fails. Saves go one at a time, in the order of the
// ticks, so quick taps cannot arrive out of order. A save that takes more than 15 seconds is
// given up, so one stuck request does not block the next ticks.
const form = document.querySelector('form[data-autosave]');

if (form) {
  const token = form.querySelector('input[name="_csrf"]').value;
  const saveAll = form.querySelector('[data-save-all]');
  const status = document.querySelector('[data-attendance-status]');
  const count = document.querySelector('[data-attendance-count]');
  let queue = Promise.resolve();
  if (saveAll) saveAll.hidden = true;

  async function save(box) {
    const attended = box.checked;
    let message = form.dataset.error;
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-CSRF-Token': token },
        body: new URLSearchParams({ student: box.value, attended: attended ? '1' : '0' }),
        signal: AbortSignal.timeout(15000),
      });
      // An ended session answers 303 to /login, which fetch follows.
      if (res.redirected && new URL(res.url).pathname === '/login') {
        message = form.dataset.loggedOut;
        throw new Error();
      }
      const data = await res.json().catch(() => ({}));
      // Without a session the CSRF check refuses the request first, with an HTML 403 page.
      if (res.status === 403 && !('ok' in data)) message = form.dataset.loggedOut;
      else if (data.message) message = data.message;
      if (!res.ok || !data.ok) throw new Error();
      status.textContent = data.message;
      count.textContent = data.summary;
      // Keep the row's saved state current, for "Vista" if a later save fails.
      form.querySelector(`input[name="marked"][value="${box.value}"]`).disabled = !attended;
    } catch {
      if (box.checked === attended) box.checked = !attended;
      status.textContent = message;
      if (saveAll) saveAll.hidden = false;
    }
  }

  form.addEventListener('change', (event) => {
    const box = event.target;
    if (!box.matches('input[type="checkbox"][name="present"]')) return;
    queue = queue.then(() => save(box));
  });
}

// The attendance checklist (AGENT_START §11, BR-38): each tick saves as soon as it changes. The
// page works without this script, through its "Vista" button, which the script hides while
// saving works and shows again if a save fails. Saves go one at a time, in the order of the
// ticks, so quick taps cannot arrive out of order. A save that takes more than 15 seconds is
// given up, so one stuck request does not block the next ticks. A failed save puts the tick
// back. When no answer came (a network error or the 15 seconds), the server may have stored the
// change all the same, so the row then counts as changed and "Vista" sends what the page shows.
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
    // The row's saved state, which "Vista" compares with the box (src/routes/teacher.js).
    const marked = form.querySelector(`input[name="marked"][value="${box.value}"]`);
    let message = form.dataset.error;
    let answered = false;
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-CSRF-Token': token },
        body: new URLSearchParams({ student: box.value, attended: attended ? '1' : '0' }),
        signal: AbortSignal.timeout(15000),
      });
      const text = await res.text();
      answered = true;
      // An ended session answers 303 to /login, which fetch follows.
      if (res.redirected && new URL(res.url).pathname === '/login') {
        message = form.dataset.loggedOut;
        throw new Error();
      }
      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        // not JSON: an HTML error page
      }
      // Without a session the CSRF check refuses the request first, with an HTML 403 page.
      if (res.status === 403 && !('ok' in data)) message = form.dataset.loggedOut;
      else if (data.message) message = data.message;
      if (!res.ok || !data.ok) throw new Error();
      status.textContent = data.message;
      count.textContent = data.summary;
      // Keep the row's saved state current, for "Vista" if a later save fails.
      marked.disabled = !attended;
    } catch {
      if (box.checked === attended) box.checked = !attended;
      // Unknown outcome: mark the row as differing from the box, so "Vista" writes the box's state.
      if (!answered && marked) marked.disabled = box.checked;
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

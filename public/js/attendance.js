// The attendance checklist (AGENT_START §11, BR-38): each tick saves as soon as it changes. The
// page works without this script, through its "Vista" button, which the script hides while
// saving works and shows again if a save fails. Saves go one at a time, in the order of the
// ticks, so quick taps cannot arrive out of order.
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
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-CSRF-Token': token },
        body: new URLSearchParams({ student: box.value, attended: attended ? '1' : '0' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || form.dataset.error);
      status.textContent = data.message;
      count.textContent = data.summary;
      // Keep the row's saved state current, for "Vista" if a later save fails.
      form.querySelector(`input[name="marked"][value="${box.value}"]`).disabled = !attended;
    } catch (err) {
      if (box.checked === attended) box.checked = !attended;
      status.textContent = err.message || form.dataset.error;
      if (saveAll) saveAll.hidden = false;
    }
  }

  form.addEventListener('change', (event) => {
    const box = event.target;
    if (!box.matches('input[type="checkbox"][name="present"]')) return;
    queue = queue.then(() => save(box));
  });
}

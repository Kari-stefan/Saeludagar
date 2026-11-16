// The steppers on "Fjarvistastig" (BR-69) without reloading the page. Without this script each
// step is a plain form that reloads it. The server stays the only source of truth: the counter,
// the message and the courses are those of the page the form would have landed on, put in place
// of the old ones. The counter itself stays in the page, so screen readers read out its new text.
const pointsPage = document.querySelector('[data-points]');

if (pointsPage) {
  const part = (name, root = pointsPage) => root.querySelector(`[data-points-${name}]`);
  const steppers = () => [...pointsPage.querySelectorAll('form[data-points-form]')];
  let sending = false;

  function showMessage(nodes) {
    part('flash').replaceChildren(...nodes);
    for (const alert of part('flash').querySelectorAll('.alert')) alert.setAttribute('role', 'alert');
  }

  pointsPage.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!form.matches('form[data-points-form]')) return;
    event.preventDefault();
    if (sending) return;
    sending = true;

    const button = event.submitter;
    const body = new URLSearchParams(new FormData(form));
    body.set(button.name, button.value);
    // One step at a time. The buttons go back to how they were if the step cannot be sent.
    const buttons = steppers().flatMap((stepper) => [...stepper.querySelectorAll('button')]);
    const before = buttons.map((other) => other.disabled);
    for (const other of buttons) other.disabled = true;
    let leaving = false;
    const leave = (go) => {
      leaving = true;
      buttons.forEach((other, index) => {
        other.disabled = before[index];
      });
      go();
    };

    try {
      // Not form.action: the buttons are named "action", and that name would return one of them.
      const res = await fetch(form.getAttribute('action'), {
        method: 'POST', headers: { 'X-CSRF-Token': body.get('_csrf') }, body, signal: AbortSignal.timeout(20000),
      });
      // The session ended: show the page as it is now, which is the login page.
      if (res.status === 403 || res.status === 404) {
        leave(() => location.reload());
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const fresh = new DOMParser().parseFromString(await res.text(), 'text/html').querySelector('[data-points]');
      if (!fresh) {
        leave(() => location.assign(res.url));
        return;
      }
      const incoming = document.adoptNode(fresh);
      part('counter').replaceChildren(...part('counter', incoming).childNodes);
      part('deadline').replaceChildren(...part('deadline', incoming).childNodes);
      part('courses').replaceChildren(...part('courses', incoming).childNodes);
      showMessage(part('flash', incoming).childNodes);
      // Focus stays on the course: on the same button, or on the other one if this one is now off.
      const stepper = steppers().find((other) => other.elements.course.value === body.get('course'));
      const same = stepper?.querySelector(`button[value="${button.value}"]:not([disabled])`) ?? stepper?.querySelector('button:not([disabled])');
      same?.focus({ preventScroll: true });
    } catch {
      buttons.forEach((other, index) => {
        other.disabled = before[index];
      });
      button.focus({ preventScroll: true });
      const alert = document.createElement('div');
      alert.className = 'alert alert--error';
      alert.textContent = pointsPage.dataset.networkError;
      showMessage([alert]);
    } finally {
      if (!leaving) sending = false;
    }
  });
}

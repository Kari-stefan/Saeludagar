// "Skrá" and "Afskrá" on event cards (BR-66), without reloading the page. Without this script they
// are plain forms that reload it. The server stays the only source of truth: the sections, counts
// and message are those of the page the form would have landed on, put in place of the old ones.
// The search and filter forms stay as they are, with whatever is typed or ticked in them. The
// listeners are on the document, so they keep working on what is put in.
const content = document.querySelector('[data-home-content]');
const flash = document.querySelector('[data-home-flash]');
// About the longest gap in a double-click. A press this soon after the page's content moved
// belongs to the press before it, so it must not act on whatever slid into its place. A reloaded
// page starts this way too: this script reloads the page when it is out of date, and that moves
// everything as well.
const SETTLE_MS = 500;
const REQUEST_TIMEOUT_MS = 20000;
const reloaded = performance.getEntriesByType('navigation')[0]?.type === 'reload';
let busy = false;
let movedAt = reloaded ? 0 : -SETTLE_MS;
// Where this script last put the keyboard focus, if anywhere.
let focused = null;

const buttonsIn = (root) => [...root.querySelectorAll('form[data-card-signup] button')];

// The message area stays in the page, so screen readers read out what is put into it.
function showMessage(nodes) {
  flash.replaceChildren(...nodes);
  for (const alert of flash.querySelectorAll('.alert')) alert.setAttribute('role', 'alert');
}

// Puts the server's new content and message in place of the old. `byKeyboard` says whether the
// button was pressed with the keyboard.
function swap(form, button, page, fresh, byKeyboard) {
  const active = document.activeElement;
  const inside = active === document.body || content.contains(active);
  const section = form.closest('section[id]');
  const place = section ? buttonsIn(section).indexOf(button) : -1;
  const top = section?.getBoundingClientRect().top;

  const incoming = document.adoptNode(fresh);
  for (const kept of content.querySelectorAll('form.browse[id]')) incoming.querySelector(`#${kept.id}`)?.replaceWith(kept);
  content.replaceChildren(...incoming.childNodes);
  movedAt = performance.now();

  // Keyboard focus goes back to where it was if that is still here, such as a search field. After
  // a press with the keyboard it goes to the card now in the pressed one's place in the same list,
  // so the student keeps their place, or to the first thing left in that list. After a press with
  // the mouse or a finger it goes nowhere: focus on a button they cannot see would make the next
  // Space or Enter press it.
  const list = section && document.getElementById(section.id);
  focused = null;
  if (content.contains(active)) {
    active.focus({ preventScroll: true });
  } else if (inside && byKeyboard && list) {
    const buttons = buttonsIn(list);
    focused = buttons[Math.min(place, buttons.length - 1)] ?? list.querySelector('a[href], input:not([type="hidden"])');
    focused?.focus({ preventScroll: true });
  }
  showMessage(page.querySelector('[data-home-flash]')?.childNodes ?? []);
  // The list stays where it was on screen, whatever changed above it.
  if (list) scrollBy({ top: list.getBoundingClientRect().top - top, behavior: 'instant' });
}

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!content || !form.matches('form[data-card-signup]')) return;
  event.preventDefault();
  if (busy) return;
  busy = true;

  const button = form.querySelector('button');
  const byKeyboard = button.matches(':focus-visible');
  // Not form.action: the button is named "action", and that name would return the button.
  const address = form.getAttribute('action');
  const body = new URLSearchParams(new FormData(form));
  body.set(button.name, button.value);
  // One at a time: the site keeps one message per session, so two answers would lose one.
  const buttons = buttonsIn(content);
  const hold = (held) => {
    for (const other of buttons) other.disabled = held;
  };
  hold(true);
  button.setAttribute('aria-busy', 'true');
  // Set when the page is about to be replaced: further presses stay ignored, and the buttons are
  // let go first, because some browsers bring a disabled button back disabled after a reload.
  let leaving = false;
  const leave = (go) => {
    leaving = true;
    hold(false);
    go();
  };

  try {
    const res = await fetch(address, {
      method: 'POST', headers: { 'X-CSRF-Token': body.get('_csrf') }, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // The session ended, or the event is gone: the page is out of date, so show it as it is now.
    if (res.status === 403 || res.status === 404) {
      leave(() => location.reload());
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    const page = new DOMParser().parseFromString(await res.text(), 'text/html');
    const fresh = page.querySelector('[data-home-content]');
    // Sent somewhere else, such as to log in again after the account was deactivated.
    if (!fresh) {
      leave(() => location.assign(res.url));
      return;
    }
    swap(form, button, page, fresh, byKeyboard);
  } catch {
    hold(false);
    button.removeAttribute('aria-busy');
    // Disabling the button dropped keyboard focus; back to it, to try again.
    if (document.activeElement === document.body) button.focus({ preventScroll: true });
    const alert = document.createElement('div');
    alert.className = 'alert alert--error';
    alert.textContent = content.dataset.networkError;
    const top = button.getBoundingClientRect().top;
    showMessage([alert]);
    scrollBy({ top: button.getBoundingClientRect().top - top, behavior: 'instant' });
  } finally {
    if (!leaving) busy = false;
  }
});

// The second click of a double-click, or a second quick press of a key. Each ignored click starts
// the wait again, so a burst of clicks is ignored until it pauses. A press with the keyboard (a
// click without a click count) is ignored only where this script has just put the focus: anywhere
// else, such as Enter in a search field the student is typing in, it is a press of its own.
document.addEventListener('click', (event) => {
  if (performance.now() - movedAt >= SETTLE_MS || !content?.contains(event.target)) return;
  if (event.detail === 0 && document.activeElement !== focused) return;
  event.preventDefault();
  movedAt = performance.now();
}, true);

// A held Enter repeats, and each repeat would press whatever button focus has moved to. (Space
// presses on release, so holding it presses once.)
document.addEventListener('keydown', (event) => {
  if (event.repeat && event.key === 'Enter' && event.target.closest?.('form[data-card-signup]')) event.preventDefault();
});

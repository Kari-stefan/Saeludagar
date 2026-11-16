// The header's mobile drawer and the front page's "Sía" and "Raða" menus are <details> elements, so
// they open and close without JavaScript (AGENT_START §6, §11). This only adds:
// - Escape closes them, and so does a click outside (for the drawer, on the dimmed backdrop)
// - the drawer's closing animation, on every way of closing it (its opening animation is CSS)
// - choosing a link in the drawer closes it
// - while the drawer is open, the page behind it is inert, so focus stays on its button and links
// The front page swaps its content after a sign-up, so the menus are looked up on each event.
const drawer = document.querySelector('details.menu');
const CLOSING_MS = 200; // the animation's length in scss/_layout.scss
const openMenus = () => [...document.querySelectorAll('details.menu[open], details.browse__menu[open]')];
let closingTimer = null;

function finishClosing() {
  clearTimeout(closingTimer);
  drawer.classList.remove('is-closing');
  drawer.open = false;
}

function closeDrawer() {
  if (drawer.classList.contains('is-closing')) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    drawer.open = false;
    return;
  }
  drawer.classList.add('is-closing');
  closingTimer = setTimeout(finishClosing, CLOSING_MS);
}

function closeMenu(menu) {
  if (menu === drawer) closeDrawer();
  else menu.open = false;
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  for (const menu of openMenus()) {
    const hadFocus = menu.contains(document.activeElement);
    closeMenu(menu);
    if (hadFocus) menu.querySelector('summary').focus();
  }
});

document.addEventListener('click', (event) => {
  for (const menu of openMenus()) {
    if (!menu.contains(event.target) || event.target.matches('.menu__backdrop')) closeMenu(menu);
  }
});

if (drawer) {
  const behind = [
    ...[...document.body.children].filter((element) => !element.contains(drawer)),
    ...[...drawer.parentElement.children].filter((element) => element !== drawer),
  ];
  // Focus stays on the menu button, which now closes the drawer, so a second press of Enter
  // closes it again instead of following the first link.
  drawer.addEventListener('toggle', () => {
    for (const element of behind) element.inert = drawer.open;
  });
  // The button closes the drawer through the animation too, instead of at once.
  drawer.querySelector('summary').addEventListener('click', (event) => {
    if (!drawer.open) return;
    event.preventDefault();
    closeDrawer();
  });
  drawer.querySelector('.menu__panel').addEventListener('click', (event) => {
    if (event.target.closest('a')) closeDrawer();
  });
  // On a wide screen the drawer is hidden, so it must not leave the page inert.
  matchMedia('(min-width: 48rem)').addEventListener('change', (event) => {
    if (event.matches && drawer.open) finishClosing();
  });
}

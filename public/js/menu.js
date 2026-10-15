// The header's mobile drawer and the front page's "Sía" menus are <details> elements, so they open
// and close without JavaScript (AGENT_START §6, §11). This only adds:
// - Escape closes them, and so does a click outside (for the drawer, on the dimmed backdrop)
// - choosing a link in the drawer closes it
// - while the drawer is open, the page behind it is inert, so focus stays in the drawer
const drawer = document.querySelector('details.menu');
const menus = [...document.querySelectorAll('details.menu, details.browse__menu')];

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  for (const menu of menus) {
    if (!menu.open) continue;
    const hadFocus = menu.contains(document.activeElement);
    menu.open = false;
    if (hadFocus) menu.querySelector('summary').focus();
  }
});

document.addEventListener('click', (event) => {
  for (const menu of menus) {
    if (menu.open && (!menu.contains(event.target) || event.target.matches('.menu__backdrop'))) menu.open = false;
  }
});

if (drawer) {
  const behind = [
    ...[...document.body.children].filter((element) => !element.contains(drawer)),
    ...[...drawer.parentElement.children].filter((element) => element !== drawer),
  ];
  drawer.addEventListener('toggle', () => {
    for (const element of behind) element.inert = drawer.open;
    if (drawer.open) drawer.querySelector('.menu__panel a, .menu__panel button')?.focus();
  });
  drawer.querySelector('.menu__panel').addEventListener('click', (event) => {
    if (event.target.closest('a')) drawer.open = false;
  });
  // On a wide screen the drawer is hidden, so it must not leave the page inert.
  matchMedia('(min-width: 48rem)').addEventListener('change', (event) => {
    if (event.matches) drawer.open = false;
  });
}

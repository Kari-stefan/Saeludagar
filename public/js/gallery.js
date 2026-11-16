// The arrows and the "Mynd n af m" count for an event's images (BR-27, AGENT_START §6, §11).
// Without this script the images still scroll sideways, by swipe, scroll bar or the arrow keys.
// The arrows go round: after the last image comes the first.
for (const gallery of document.querySelectorAll('[data-gallery]')) {
  const strip = gallery.querySelector('[data-gallery-strip]');
  const count = gallery.querySelector('[data-gallery-count]');
  const total = strip.children.length;
  // Each image is as wide as the strip, so the scroll position says which one is showing.
  const shown = () => Math.min(total - 1, Math.max(0, Math.round(strip.scrollLeft / strip.clientWidth)));

  function step(by) {
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    strip.scrollTo({ left: ((shown() + by + total) % total) * strip.clientWidth, behavior });
  }

  function update() {
    count.textContent = count.dataset.label.replace('{n}', shown() + 1);
  }

  for (const [selector, by] of [['[data-gallery-previous]', -1], ['[data-gallery-next]', 1]]) {
    const button = gallery.querySelector(selector);
    button.hidden = false;
    button.addEventListener('click', () => step(by));
  }
  // With focus on the images, the arrow keys step one whole image at a time.
  strip.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    step(event.key === 'ArrowLeft' ? -1 : 1);
  });
  strip.addEventListener('scroll', update, { passive: true });
  update();
}

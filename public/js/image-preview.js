// The chosen images in the event form and the "Nýr viðburður" dialog (BR-27, AGENT_START §11): a
// preview of each with its own remove button, images added a few at a time, and never more than
// the maximum. Without this script the file field still takes several images, and the server
// checks everything again. The previews are data: URLs, which the Content-Security-Policy allows.
for (const picker of document.querySelectorAll('[data-image-picker]')) {
  const input = picker.querySelector('input[type="file"]');
  const previews = picker.querySelector('[data-image-previews]');
  const slot = picker.querySelector('[data-error-slot="images"]');
  const count = picker.querySelector('[data-image-count]');
  const max = Number(picker.dataset.max);
  const maxBytes = Number(picker.dataset.maxBytes);
  const accepted = input.accept.split(',');
  // The chosen files, each with its row in the list of previews.
  const rows = new Map();

  const saved = () => picker.querySelectorAll('[data-saved-image]:not(:checked)').length;

  // Any message about the images goes when they change, also one the server sent.
  function clearProblem() {
    for (const message of picker.querySelectorAll('.field__error')) message.remove();
    input.removeAttribute('aria-invalid');
    const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => !id.endsWith('-error')).join(' ');
    if (describedBy) input.setAttribute('aria-describedby', describedBy);
    else input.removeAttribute('aria-describedby');
  }

  // A message by the file field, linked to it and read out by screen readers.
  function showProblem(text) {
    clearProblem();
    const message = document.createElement('p');
    message.className = 'field__error';
    message.id = `${input.id}-problem-error`;
    message.setAttribute('role', 'alert');
    message.textContent = text;
    slot.append(message);
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', `${input.getAttribute('aria-describedby') ?? ''} ${message.id}`.trim());
  }

  // The file field holds exactly the chosen files, so the form sends what the previews show.
  function show() {
    const transfer = new DataTransfer();
    for (const file of rows.keys()) transfer.items.add(file);
    input.files = transfer.files;
    previews.replaceChildren(...rows.values());
    previews.hidden = rows.size === 0;
    const total = saved() + rows.size;
    count.textContent = total > 0 ? picker.dataset.countLabel.replace('{count}', total) : '';
  }

  function row(file) {
    const item = document.createElement('li');
    item.className = 'image-list__item';
    const image = document.createElement('img');
    image.className = 'image-list__thumb';
    image.alt = '';
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      image.src = reader.result;
    });
    reader.readAsDataURL(file);
    const name = document.createElement('span');
    name.className = 'image-list__name';
    name.textContent = file.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button button--small button--secondary';
    remove.textContent = picker.dataset.removeLabel;
    const which = document.createElement('span');
    which.className = 'visually-hidden';
    which.textContent = `: ${file.name}`;
    remove.append(which);
    remove.addEventListener('click', () => {
      // Focus goes to the next image's button, or back to the file field.
      const next = item.nextElementSibling ?? item.previousElementSibling;
      rows.delete(file);
      clearProblem();
      show();
      (next?.querySelector('button') ?? input).focus();
    });
    item.append(image, name, remove);
    return item;
  }

  // Each choice adds to those already chosen. A file that cannot be used is left out, with the
  // reason shown once.
  input.addEventListener('change', () => {
    let problem = null;
    for (const file of input.files) {
      // The same file chosen again is not added twice.
      const same = (other) => other.name === file.name && other.size === file.size && other.lastModified === file.lastModified;
      if ([...rows.keys()].some(same)) continue;
      if (!accepted.includes(file.type)) problem ??= picker.dataset.wrongType;
      else if (file.size > maxBytes) problem ??= picker.dataset.tooLarge;
      else if (saved() + rows.size >= max) problem ??= picker.dataset.tooMany;
      else rows.set(file, row(file));
    }
    show();
    if (problem) showProblem(problem);
    else clearProblem();
  });

  // Keeping a saved image that was ticked for removal must not take the total over the maximum.
  picker.addEventListener('change', (event) => {
    if (!event.target.matches('[data-saved-image]')) return;
    if (saved() + rows.size > max) {
      event.target.checked = true;
      showProblem(picker.dataset.tooMany);
    } else {
      clearProblem();
    }
    show();
  });

  // The dialog empties its form after saving.
  input.form.addEventListener('reset', () => {
    rows.clear();
    clearProblem();
    show();
  });
}

// Shows the chosen event image before the form is saved (AGENT_START §11). The form works the
// same without JavaScript. The preview is a data: URL, which the Content-Security-Policy allows.
for (const input of document.querySelectorAll('input[type="file"][data-preview]')) {
  const preview = document.getElementById(input.dataset.preview);
  input.addEventListener('change', () => {
    const [file] = input.files;
    if (!file || !file.type.startsWith('image/')) {
      preview.hidden = true;
      preview.removeAttribute('src');
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      preview.src = reader.result;
      preview.hidden = false;
    });
    reader.readAsDataURL(file);
  });
}

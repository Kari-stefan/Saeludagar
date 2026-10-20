// Copies the participants' emails to the clipboard (AGENT_START §11, BR-50). Without this script
// the button stays hidden and the teacher selects the text in the box and copies it.
for (const button of document.querySelectorAll('button[data-copy]')) {
  const box = document.getElementById(button.dataset.copy);
  const status = document.querySelector(`[data-copy-status="${button.dataset.copy}"]`);
  button.hidden = false;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(box.value);
      status.textContent = button.dataset.copied;
    } catch {
      box.focus();
      box.select();
      status.textContent = button.dataset.failed;
    }
  });
}

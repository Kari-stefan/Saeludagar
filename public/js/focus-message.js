// Moves keyboard focus to the error message a page loads with: a form that came back with errors,
// a failed login or a refused action (AGENT_START §11). Focus makes a screen reader read the
// message out, which it often does not for a message that is already in the page at load.
// Success and info messages do not have the data-focus-on-load attribute. Without this script
// the message is in the same place and the errors are still linked to their fields.
document.querySelector('[data-focus-on-load]')?.focus();

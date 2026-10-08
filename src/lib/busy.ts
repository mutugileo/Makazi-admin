// Busy state for buttons that start a request: the button is disabled, shows a
// spinner and a short label, and is restored exactly as it was when the request ends.

const SPINNER =
  '<svg class="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
  '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>' +
  '</svg>';

/**
 * Puts a button into its busy state. Returns a function that restores the
 * button's original content and enabled state. Call it on failure; on success
 * the modal or page usually reloads.
 */
export function setBusy(button: HTMLButtonElement | null | undefined, label = 'Saving…'): () => void {
  if (!button) return () => {};
  const originalHtml = button.innerHTML;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  // `label` is always a constant from our own code, never user input.
  button.innerHTML = `${SPINNER}<span>${label}</span>`;
  return () => {
    button.innerHTML = originalHtml;
    button.disabled = wasDisabled;
    button.removeAttribute('aria-busy');
  };
}

/**
 * Focuses a control only when a person could reach it: connected, enabled,
 * rendered, and outside inert content or a closed dialog. Returns whether focus
 * moved, so callers can try another origin instead of leaving focus on body.
 */
export function focusIfAvailable(element) {
  if (!element || !element.isConnected || element.disabled || element.closest('[inert], dialog:not([open])')) return false;
  if (typeof element.checkVisibility === 'function' && !element.checkVisibility()) return false;
  element.focus();
  return document.activeElement === element;
}

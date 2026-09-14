// Shortcut labels follow the platform: ⇧⌘S on macOS, Ctrl+Shift+S elsewhere.
export function isMacPlatform() {
  if (typeof window === 'undefined') return false;
  const platform = window.bordeauxAPI?.platform;
  if (platform) return platform === 'darwin';
  return typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
}

export function shortcutLabel(key, { shift = false } = {}, mac = isMacPlatform()) {
  return mac ? (shift ? '⇧' : '') + '⌘' + key : 'Ctrl+' + (shift ? 'Shift+' : '') + key;
}

/** The modifier word used in prose, such as "⌘-click" or "Ctrl-click". */
export function modifierName(mac = isMacPlatform()) {
  return mac ? '⌘' : 'Ctrl';
}

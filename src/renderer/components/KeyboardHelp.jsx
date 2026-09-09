import * as React from 'react';
const h = React.createElement;
export const TOOL_SHORTCUTS = { '1': 'select', v: 'select', '2': 'waypoint', w: 'waypoint', '3': 'rotation', r: 'rotation', '4': 'marker', m: 'marker', '5': 'range', c: 'range' };
export function KeyboardHelp() {
  const dialog = React.useRef(null), trigger = React.useRef(null);
  const mod = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const close = () => { dialog.current?.close(); trigger.current?.focus(); };
  const shortcuts = [
    ['Select / move', '1 or V'], ['Place waypoint', '2 or W'], ['Place rotation', '3 or R'], ['Place command', '4 or M'], ['Create constraint region', '5 or C'],
    ['Delete a field or outline feature', 'Shift-click'], ['Delete selection', 'Delete / Backspace'], ['Play / pause', 'Space'], ['Fit field', 'F'], ['Toggle grid', 'G'], ['Cancel / select tool', 'Esc'],
    ['Move selection', 'Arrow keys'], ['Larger move', 'Shift + arrows'], ['Fine waypoint move', 'Alt + arrows'], ['Undo', mod + 'Z'], ['Redo', mod + 'Shift+Z'],
    ['Open project folder', mod + 'O'], ['Choose project folder', mod + 'Shift+O'], ['Save project and BDX files', mod + 'S'], ['Save to another folder', mod + 'Shift+S'], ['Rename library item', 'F2'],
  ];
  return h(React.Fragment, null,
    h('button', { ref: trigger, type: 'button', className: 'qbtn keyboard-help-trigger', 'aria-label': 'Keyboard shortcuts', title: 'Keyboard shortcuts', onClick: () => dialog.current.showModal() }, '?'),
    h('dialog', { ref: dialog, className: 'keyboard-help', 'aria-labelledby': 'keyboard-help-title', onCancel: (event) => { event.preventDefault(); close(); }, onClick: (event) => { if (event.target === event.currentTarget) { const b = event.currentTarget.getBoundingClientRect(); if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) close(); } } },
      h('header', null, h('h2', { id: 'keyboard-help-title' }, 'Keyboard shortcuts'), h('button', { type: 'button', 'aria-label': 'Close keyboard shortcuts', onClick: close }, '×')),
      h('table', null, h('tbody', null, shortcuts.map(([label, keys]) => h('tr', { key: label }, h('td', null, label), h('td', null, h('kbd', null, keys)))))),
      h('p', null, 'In the library, Shift selects a range; ' + (/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl') + '-click selects multiple paths.')));
}

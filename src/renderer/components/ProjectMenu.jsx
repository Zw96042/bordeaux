import * as React from 'react';
import { UI } from './ui';
import '../styles/project-menu.css';

const h = React.createElement;
const { Icon } = UI;

export function ProjectMenu({ projectName, projectLocation, saveState, openError, onRetryOpen, onDismissOpenError, onOpen, onSave }) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef(null), trigger = React.useRef(null), menu = React.useRef(null);
  const name = projectName || 'Untitled project';
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  React.useEffect(() => { if (openError) setOpen(true); }, [openError]);
  React.useEffect(() => {
    if (!open) return;
    (menu.current?.querySelector('[data-retry-open]') || menu.current?.querySelector('button'))?.focus();
    const away = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open, openError]);
  const action = (label, callback, shortcut) => h('button', {
    type: 'button', role: 'menuitem', tabIndex: -1, onClick: () => { close(true); callback(); },
  }, h('span', null, label), h('span', { className: 'project-menu-shortcut', 'aria-hidden': true }, shortcut));
  const modifier = typeof window !== 'undefined' && window.bordeauxAPI?.platform === 'darwin' ? '⌘' : 'Ctrl+';
  return h('div', { ref: root, className: 'project-control', onBlur: (event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  } },
    h('button', { ref: trigger, type: 'button', className: 'project-trigger', 'aria-label': 'Project menu',
      'aria-haspopup': 'menu', 'aria-busy': saveState?.status === 'saving', 'aria-expanded': open, 'aria-controls': open ? 'project-menu' : undefined,
      title: name, onClick: () => setOpen(!open), onKeyDown: (event) => {
        if ([' ', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) event.stopPropagation();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      } }, h(Icon, { name: 'folder', size: 15 }), h('span', { className: 'project-trigger-label' }, 'Project'),
      h('span', { className: 'project-trigger-name' }, name),
      h('span', { className: 'project-saving-indicator', 'data-saving': saveState?.status === 'saving', 'aria-hidden': true }),
      (openError || saveState?.status === 'error') && h('span', { className: 'project-error-indicator', 'aria-label': openError ? 'Could not open project' : 'Save failed' }, '!'),
      h(Icon, { name: 'chevron', size: 12 })),
    open && h('div', { ref: menu, id: 'project-menu', className: 'project-menu', role: 'menu', 'aria-label': 'Project actions',
      onKeyDown: (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); close(true); }
        if (event.key === 'Tab') { close(true); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const buttons = [...menu.current.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      } },
      h('div', { className: 'project-menu-heading', role: 'presentation' }, h('strong', null, name),
        h('span', null, projectLocation?.folderPath || 'Not saved to a folder yet')),
      openError && h('div', { className: 'project-menu-note project-menu-error', role: 'alert' }, 'Could not open project. ', openError.message),
      openError && h('button', { type: 'button', role: 'menuitem', tabIndex: -1, 'data-retry-open': true, onClick: () => { close(true); onRetryOpen(); } }, 'Retry opening'),
      openError && action('Dismiss opening error', onDismissOpenError, ''),
      action('Open project…', onOpen, modifier + 'O'),
      action('Save', () => onSave(false), modifier + 'S'),
      action('Save as…', () => onSave(true), modifier + '⇧S'),
      h('div', { className: 'project-menu-note' + (saveState?.status === 'error' ? ' project-menu-error' : ''), role: saveState?.status === 'error' ? 'alert' : 'presentation' },
        saveState?.status === 'error' ? saveState.error : projectLocation?.folderPath
          ? 'Paths and routines autosave. Save also updates BDX files.' : 'Save chooses a folder for this project.')));
}

import * as React from "react";
import { UI } from "./ui";

const h = React.createElement;

export function FieldStatus({ notices }) {
  if (!notices.length) return null;
  const primary = notices[0];
  const action = notices.find((notice) => notice.action)?.action;
  return h('div', { className: 'field-status ' + (primary.error ? 'error' : '') },
    h('details', null,
      h('summary', null,
        h(UI.Icon, { name: 'info', size: 14 }),
        h('span', { className: 'field-status-label', role: primary.error ? 'alert' : 'status' }, primary.label),
        h('span', { className: 'field-status-disclosure' }, 'Details', notices.length > 1 ? ' (' + notices.length + ')' : ''),
        h(UI.Icon, { name: 'chevron', size: 12 })),
      h('div', { className: 'field-status-details' }, notices.map((notice) =>
        h('div', { key: notice.id, className: 'field-status-item' },
          h('strong', null, notice.label),
          h('p', null, notice.detail),
          notice.action && h('button', { type: 'button', onClick: notice.action.onClick }, notice.action.label))))),
    action && h('button', { type: 'button', className: 'field-status-action', onClick: action.onClick }, action.label));
}

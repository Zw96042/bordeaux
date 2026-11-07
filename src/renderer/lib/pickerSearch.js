// Options and catalogs are immutable snapshots. A replacement array invalidates its weakly held index;
// no timer or catalog hash can keep old labels/types alive after a refresh.
const indexes = new WeakMap();
export const PICKER_PAGE_SIZE = 80;

/** Preserve the two existing search contracts: one substring per field, or AND terms in joined fields. */
export function filterPickerItems(items, query, mode = 'terms') {
  const normalized = mode === 'substring' ? query.trim().toLowerCase() : query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  let index = indexes.get(items);
  if (!index) { index = {}; indexes.set(items, index); }
  const terms = mode === 'terms' ? normalized.split(/\s+/) : null;
  const matches = text => mode === 'substring' ? text.some(part => part.includes(normalized)) : terms.every(term => text.includes(term));
  if (!index[mode]) {
    const text = [], result = [];
    for (const item of items) {
      const entry = mode === 'substring' ? [item.label, item.meta, item.searchText].map(part => String(part || '').toLowerCase())
        : [item.label, item.meta, item.searchText].join(' ').toLocaleLowerCase();
      text.push(entry); if (matches(entry)) result.push(item);
    }
    index[mode] = text;
    return result;
  }
  return items.filter((_item, position) => matches(index[mode][position]));
}

/** A logical cursor may cross pages. Disabled choices are never activated or selected. */
export function enabledPickerIndex(items, start, direction = 1, wrap = true, end = items.length) {
  if (!items.length) return -1;
  for (let offset = 0; offset < items.length; offset++) {
    const candidate = start + offset * direction;
    if (!wrap && (candidate < 0 || candidate >= end)) return -1;
    const index = (candidate % items.length + items.length) % items.length;
    if (!items[index].disabled) return index;
  }
  return -1;
}

/** Derive a bounded page without changing option order or requiring fixed row heights. */
export function pickerPage(items, requestedPage, size = PICKER_PAGE_SIZE) {
  const last = Math.max(0, Math.ceil(items.length / size) - 1), page = Math.max(0, Math.min(last, requestedPage));
  const start = page * size, end = Math.min(items.length, start + size);
  return { page, last, start, end, items: items.slice(start, end) };
}

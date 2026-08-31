    if (start.segment + start.local > end.segment + end.local) { const swap = start; start = end; end = swap; }
    next.w0 = start.segment; next.t0 = start.local; next.w1 = end.segment; next.t1 = end.local;
    return next;
  }
  const oldStart = range.w0 !== undefined && Number.isInteger(range.w0) ? range.w0 : 0;
  const oldEnd = range.w1 !== undefined && Number.isInteger(range.w1) ? range.w1 : oldToNew.length - 1;
  const resolve = (value: number, start: boolean) => {
    const mapped = oldToNew[value];
    if (mapped != null && Number.isInteger(mapped)) return mapped;
    if (value === removedIndex) return start ? Math.min(value, last) : Math.max(0, value - 1);
    return Math.max(0, Math.min(last, value));
  };
  if (oldStart === removedIndex && oldEnd === removedIndex) {
    next.w0 = next.w1 = Math.min(removedIndex, last);
    return next;
  }
  const a = resolve(oldStart, true), b = resolve(oldEnd, false);
  next.w0 = Math.min(a, b); next.w1 = Math.max(a, b);
  return next;
}

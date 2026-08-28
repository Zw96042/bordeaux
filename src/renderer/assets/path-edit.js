  /** A tiny external store that confines high-frequency canvas drafts to subscribers. */
  function create() {
    const listeners = new Set();
    let draft = null;
    let revision = 0;
    let cancelRevision = 0;
    let lastResolution = null;
    const emit = () => listeners.forEach((listener) => listener());
    return {
      begin(value) {
        if (draft) return false;
        draft = value;
        lastResolution = null;
        revision += 1;
        return true;
      },
      update(value) {
        if (!draft) return false;
        draft = value;
        revision += 1;
        emit();
        return true;
      },
      finish() {
        if (!draft) return null;

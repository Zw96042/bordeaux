import * as React from 'react';

export function useAppUpdates(api = globalThis.window?.bordeauxAPI) {
  const [state, setState] = React.useState(null);
  React.useEffect(() => {
    if (!api?.getAppUpdateState) return;
    let alive = true, received = false;
    const unsubscribe = api.onAppUpdateState((next) => { received = true; if (alive) setState(next); });
    Promise.resolve(api.getAppUpdateState()).then((next) => { if (alive && !received) setState(next); }).catch(() => {});
    return () => { alive = false; unsubscribe?.(); };
  }, [api]);
  const actions = React.useMemo(() => ({
    onClose: () => api?.setAppUpdatesVisible(false),
    onCheck: () => api?.checkAppUpdates(), onDownload: () => api?.downloadAppUpdate(),
    onCancel: () => api?.cancelAppUpdateDownload(), onInstall: () => api?.installAppUpdate(),
    onOpenReleases: () => api?.openAppUpdateReleases(), onCopyDetails: () => api?.copyAppUpdateDetails(),
  }), [api]);
  return { state, actions };
}

export function clientNeedsUpdate(config, loadedBuild, initialVersion) {
  if (!config) return false;
  if (config.clientBuild && config.clientBuild !== 'dev' && loadedBuild !== 'dev') {
    return config.clientBuild !== loadedBuild;
  }
  return !!initialVersion && !!config.version && config.version !== initialVersion;
}

// An interrupted deployment or a stale intermediary must not cause a reload loop.
export function allowAutomaticReload(loadedBuild, targetBuild, storage) {
  try {
    const target = storage || sessionStorage;
    const key = 'limoninior.client-reload';
    const pair = `${loadedBuild}:${targetBuild}`;
    if (target.getItem(key) === pair) return false;
    target.setItem(key, pair);
    return true;
  } catch { return false; } // With blocked storage, offer the explicit update button.
}

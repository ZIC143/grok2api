const FUNCTION_MANIFEST_ENDPOINT = '/v1/function/manifest';
let functionManifestCache = null;

async function loadFunctionManifestShared() {
  if (functionManifestCache) return functionManifestCache;
  try {
    const res = await fetch(FUNCTION_MANIFEST_ENDPOINT, { cache: 'no-store' });
    if (!res.ok) throw new Error('manifest fetch failed');
    functionManifestCache = await res.json();
    return functionManifestCache;
  } catch (e) {
    return null;
  }
}

async function applyFunctionManifestShared(onManifest, onMissing) {
  const manifest = await loadFunctionManifestShared();
  if (manifest) {
    if (typeof onManifest === 'function') {
      await onManifest(manifest);
    }
    return manifest;
  }
  if (typeof onMissing === 'function') {
    await onMissing();
  }
  return null;
}

async function initializeFunctionManifestShared(options = {}) {
  const manifest = await loadFunctionManifestShared();
  if (manifest) {
    if (typeof options.onManifest === 'function') {
      await options.onManifest(manifest);
    }
    return { manifest, fallbackData: null };
  }

  let fallbackData = null;
  if (options.fallbackEndpoint) {
    try {
      const res = await fetch(options.fallbackEndpoint, { cache: 'no-store' });
      if (res.ok) {
        fallbackData = await res.json();
        if (typeof options.onFallbackData === 'function') {
          await options.onFallbackData(fallbackData);
        }
      }
    } catch (e) {
      fallbackData = null;
    }
  }

  if (!fallbackData && typeof options.onMissing === 'function') {
    await options.onMissing();
  }

  return { manifest: null, fallbackData };
}

window.FunctionManifestClient = {
  load: loadFunctionManifestShared,
  apply: applyFunctionManifestShared,
  initialize: initializeFunctionManifestShared,
  clear() {
    functionManifestCache = null;
  },
};

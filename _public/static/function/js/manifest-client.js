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

window.FunctionManifestClient = {
  load: loadFunctionManifestShared,
  apply: applyFunctionManifestShared,
  clear() {
    functionManifestCache = null;
  },
};

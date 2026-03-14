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

window.FunctionManifestClient = {
  load: loadFunctionManifestShared,
  clear() {
    functionManifestCache = null;
  },
};

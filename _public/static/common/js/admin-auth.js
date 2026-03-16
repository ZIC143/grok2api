const APP_KEY_STORAGE = 'grok2api_app_key';
const FUNCTION_KEY_STORAGE = 'grok2api_function_key';
const APP_KEY_ENC_PREFIX = 'enc:v1:';
const APP_KEY_XOR_PREFIX = 'enc:xor:';
const APP_KEY_SECRET = 'grok2api-admin-key';
let cachedAdminKey = null;
let cachedFunctionKey = null;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64(bytes) {
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function xorCipher(bytes, keyBytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return out;
}

function xorEncrypt(plain) {
  const data = textEncoder.encode(plain);
  const key = textEncoder.encode(APP_KEY_SECRET);
  const cipher = xorCipher(data, key);
  return `${APP_KEY_XOR_PREFIX}${toBase64(cipher)}`;
}

function xorDecrypt(stored) {
  if (!stored.startsWith(APP_KEY_XOR_PREFIX)) return stored;
  const payload = stored.slice(APP_KEY_XOR_PREFIX.length);
  const data = fromBase64(payload);
  const key = textEncoder.encode(APP_KEY_SECRET);
  const plain = xorCipher(data, key);
  return textDecoder.decode(plain);
}

async function deriveKey(salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(APP_KEY_SECRET),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptAppKey(plain) {
  if (!plain) return '';
  if (!crypto?.subtle) return xorEncrypt(plain);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(salt);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(plain)
  );
  return `${APP_KEY_ENC_PREFIX}${toBase64(salt)}:${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

async function decryptAppKey(stored) {
  if (!stored) return '';
  if (stored.startsWith(APP_KEY_XOR_PREFIX)) return xorDecrypt(stored);
  if (!stored.startsWith(APP_KEY_ENC_PREFIX)) return stored;
  if (!crypto?.subtle) return '';
  const parts = stored.split(':');
  if (parts.length !== 5) return '';
  const salt = fromBase64(parts[2]);
  const iv = fromBase64(parts[3]);
  const cipher = fromBase64(parts[4]);
  const key = await deriveKey(salt);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipher
  );
  return textDecoder.decode(plain);
}

async function getStoredAppKey() {
  const stored = localStorage.getItem(APP_KEY_STORAGE) || '';
  if (!stored) return '';
  try {
    return await decryptAppKey(stored);
  } catch (e) {
    clearStoredAppKey();
    return '';
  }
}

async function getStoredFunctionKey() {
  const stored = localStorage.getItem(FUNCTION_KEY_STORAGE) || '';
  if (!stored) return '';
  try {
    return await decryptAppKey(stored);
  } catch (e) {
    clearStoredFunctionKey();
    return '';
  }
}

async function storeAppKey(appKey) {
  if (!appKey) {
    clearStoredAppKey();
    return;
  }
  const encrypted = await encryptAppKey(appKey);
  localStorage.setItem(APP_KEY_STORAGE, encrypted || '');
}

async function storeFunctionKey(publicKey) {
  if (!publicKey) {
    clearStoredFunctionKey();
    return;
  }
  const encrypted = await encryptAppKey(publicKey);
  localStorage.setItem(FUNCTION_KEY_STORAGE, encrypted || '');
}

function clearStoredAppKey() {
  localStorage.removeItem(APP_KEY_STORAGE);
  cachedAdminKey = null;
}

function clearStoredFunctionKey() {
  localStorage.removeItem(FUNCTION_KEY_STORAGE);
  cachedFunctionKey = null;
}

async function verifyKey(url, key) {
  const headers = key ? { 'Authorization': `Bearer ${key}` } : {};
  const res = await fetch(url, { method: 'GET', headers });
  return res.ok;
}

async function ensureAdminKey() {
  if (cachedAdminKey) return cachedAdminKey;
  const appKey = await getStoredAppKey();
  if (!appKey) {
    window.location.href = '/admin/login';
    return null;
  }
  try {
    const ok = await verifyKey('/v1/admin/verify', appKey);
    if (!ok) throw new Error('Unauthorized');
    cachedAdminKey = `Bearer ${appKey}`;
    return cachedAdminKey;
  } catch (e) {
    clearStoredAppKey();
    window.location.href = '/admin/login';
    return null;
  }
}

async function ensureFunctionKey() {
  if (cachedFunctionKey !== null) return cachedFunctionKey;

  const key = await getStoredFunctionKey();
  if (!key) {
    try {
      const ok = await verifyKey('/v1/function/verify', '');
      if (ok) {
        cachedFunctionKey = '';
        return cachedFunctionKey;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  try {
    const ok = await verifyKey('/v1/function/verify', key);
    if (!ok) throw new Error('Unauthorized');
    cachedFunctionKey = `Bearer ${key}`;
    return cachedFunctionKey;
  } catch (e) {
    clearStoredFunctionKey();
    return null;
  }
}

async function getFunctionAccessState() {
  try {
    const authHeader = await ensureFunctionKey();
    return {
      verified: authHeader !== null,
      requiresLogin: authHeader === null,
      authHeader,
    };
  } catch (e) {
    return {
      verified: false,
      requiresLogin: true,
      authHeader: null,
    };
  }
}

async function initializeFunctionPage(options = {}) {
  const accessState = await getFunctionAccessState();
  if (accessState.requiresLogin) {
    if (typeof options.onUnauthorized === 'function') {
      await options.onUnauthorized(accessState);
      return accessState;
    }
    window.location.href = '/login';
    return accessState;
  }

  if (typeof options.onAuthorized === 'function') {
    await options.onAuthorized(accessState);
  }

  return accessState;
}

async function initializeFunctionScene(options = {}) {
  return initializeFunctionPage({
    onUnauthorized: options.onUnauthorized,
    onAuthorized: async (accessState) => {
      if (typeof options.beforeSceneInit === 'function') {
        await options.beforeSceneInit(accessState);
      }
      if (options.manifest) {
        await window.FunctionManifestClient.initialize(options.manifest);
      }
      if (typeof options.afterSceneInit === 'function') {
        await options.afterSceneInit(accessState);
      }
    },
  });
}

function setFunctionStatus(statusElement, state, text, fallbackText) {
  if (!statusElement) return;
  statusElement.textContent = text || fallbackText || '';
  statusElement.classList.remove('connected', 'connecting', 'error');
  if (state) {
    statusElement.classList.add(state);
  }
}

function showFunctionToast(message, type) {
  if (typeof showToast === 'function') {
    showToast(message, type);
  }
}

function setFunctionActionButtons(primaryButton, secondaryButton, active) {
  if (!primaryButton || !secondaryButton) return;
  if (active) {
    primaryButton.classList.add('hidden');
    secondaryButton.classList.remove('hidden');
  } else {
    primaryButton.classList.remove('hidden');
    secondaryButton.classList.add('hidden');
    primaryButton.disabled = false;
  }
}

async function withFunctionAuth(action, options = {}) {
  try {
    const authHeader = await ensureFunctionKey();
    if (authHeader === null) {
      if (typeof options.onUnauthorized === 'function') {
        await options.onUnauthorized();
      } else if (options.redirectOnUnauthorized !== false) {
        window.location.href = '/login';
      }
      return null;
    }
    if (typeof action === 'function') {
      return await action(authHeader);
    }
    return authHeader;
  } catch (e) {
    if (typeof options.onError === 'function') {
      await options.onError(e);
      return null;
    }
    throw e;
  }
}

async function buildFunctionJsonHeaders(baseHeaders = {}, options = {}) {
  let headers = { ...baseHeaders };
  await withFunctionAuth(
    async (authHeader) => {
      headers = { ...headers, ...buildAuthHeaders(authHeader) };
    },
    {
      redirectOnUnauthorized: false,
      onError: options.onError,
    }
  );
  return headers;
}

async function postFunctionJson(url, payload, options = {}) {
  const headers = await buildFunctionJsonHeaders(
    { 'Content-Type': 'application/json', ...(options.headers || {}) },
    { onError: options.onError }
  );

  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: options.signal,
  });
}

async function postFunctionJsonExpectJson(url, payload, options = {}) {
  const res = await postFunctionJson(url, payload, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || options.errorMessage || 'Request failed');
  }
  return res.json();
}

async function postFunctionJsonRaw(url, payload, options = {}) {
  return postFunctionJson(url, payload, options);
}

function getManifestBridgeMode(manifest, runtimeKey, scene, fallbackMode = '') {
  if (manifest && manifest.runtime && manifest.runtime[runtimeKey] && manifest.runtime[runtimeKey].mode) {
    return String(manifest.runtime[runtimeKey].mode);
  }
  if (scene && scene.capabilities && scene.capabilities.bridge && scene.capabilities.bridge.mode) {
    return String(scene.capabilities.bridge.mode);
  }
  return fallbackMode;
}

function getBridgeBackendTraceId(res) {
  if (!res || !res.headers) return '';
  return res.headers.get('x-grok2api-backend-trace-id') || '';
}

function getBridgeRequestId(res) {
  if (!res || !res.headers) return '';
  return res.headers.get('x-grok2api-request-id') || '';
}

function getBridgeIdempotencyKey(res) {
  if (!res || !res.headers) return '';
  return res.headers.get('x-grok2api-idempotency-key') || '';
}

function getBridgeIdempotencyKey(res) {
  if (!res || !res.headers) return '';
  return res.headers.get('x-grok2api-idempotency-key') || '';
}

function getBridgeMode(res, headerName) {
  if (!res || !res.headers || !headerName) return '';
  return res.headers.get(headerName) || '';
}

function isBridgeMode(res, headerName, expectedMode) {
  return getBridgeMode(res, headerName) === expectedMode;
}

function isProbeBridgeResponse(res, headerName) {
  return isBridgeMode(res, headerName, 'probe');
}

function isBackendForwardBridgeResponse(res, headerName) {
  return isBridgeMode(res, headerName, 'backend-forward');
}
  getBridgeIdempotencyKey,

function getBridgeRetryAfter(res) {
  if (!res || !res.headers) return '';
  return res.headers.get('retry-after') || '';
}

function getBridgeFailureMessage(res, fallbackKey, traceKey, retryKey, traceRetryKey, translate, options = {}) {
  const tFn = typeof translate === 'function' ? translate : (key, params) => {
    if (typeof t === 'function') return t(key, params);
    return key;
  };
  const traceId = getBridgeBackendTraceId(res);
  const retryAfter = getBridgeRetryAfter(res);
  const requestId = getBridgeRequestId(res);
  const withRequestId = (message) => {
    if (!message || !requestId || options.includeRequestId === false) return message;
    return `${message}${tFn('common.requestIdSuffix', { requestId })}`;
  };
  if (traceId && retryAfter) {
    return withRequestId(tFn(traceRetryKey, { trace: traceId, retryAfter }));
  }
  if (retryAfter) {
    return withRequestId(tFn(retryKey, { retryAfter }));
  }
  if (traceId) {
    return withRequestId(tFn(traceKey, { trace: traceId }));
  }
  return withRequestId(tFn(fallbackKey));
}

async function parseBridgeError(res, fallbackMessage) {
  if (!res) return fallbackMessage || 'Request failed';
  try {
    const data = await res.clone().json();
    const errorData = data && typeof data.error === 'object' ? data.error : null;
    const parts = [
      data && data.message,
      data && data.detail,
      data && data.code,
      errorData && errorData.message,
      errorData && errorData.param,
      errorData && errorData.code,
    ].filter((value, index, list) => value && list.indexOf(value) === index);
    if (parts.length) {
      return parts.join(' · ');
    }
  } catch (e) {
    // ignore body parse errors
  }
  return fallbackMessage || `Request failed: ${res.status}`;
}

function splitBridgeErrorMessage(error, fallbackDisplay, fallbackToast) {
  const parts = String(error && error.message ? error.message : '').split('|||');
  return {
    display: parts[0] || fallbackDisplay || fallbackToast || 'Request failed',
    toast: parts[1] || parts[0] || fallbackToast || fallbackDisplay || 'Request failed',
  };
}

function getBridgeReadyStatusMessage(sceneKey, mode, translate) {
  const tFn = typeof translate === 'function' ? translate : (key) => key;
  if (mode === 'backend-forward-ready' || mode === 'backend-forward') {
    return tFn(`${sceneKey}.bridgeBackendReady`);
  }
  if (mode === 'probe-only' || mode === 'probe') {
    return tFn(`${sceneKey}.bridgeProbeOnly`);
  }
  if (mode === 'init-only') {
    return tFn(`${sceneKey}.bridgeInitOnly`);
  }
  return '';
}

function getBridgeResponseStatusMessage(sceneKey, res, headerName, translate, fallbackText = '') {
  return getBridgeReadyStatusMessage(sceneKey, getBridgeMode(res, headerName), translate) || fallbackText;
}

async function executeBridgeJson(url, payload, options = {}) {
  const res = await postFunctionJsonRaw(url, payload, options);
  if (!res.ok) {
    const errorText = await parseBridgeError(res, options.fallbackError || 'Request failed');
    const toastText = getBridgeFailureMessage(
      res,
      options.fallbackToastKey || 'common.requestFailed',
      options.traceKey || options.fallbackToastKey || 'common.requestFailed',
      options.retryKey || options.fallbackToastKey || 'common.requestFailed',
      options.traceRetryKey || options.fallbackToastKey || 'common.requestFailed',
      options.translate
    );
    throw new Error(`${errorText}|||${toastText}`);
  }
  const data = await res.json();
  return { res, data };
}

async function getJson(url, options = {}) {
  const res = await fetch(url, {
    method: 'GET',
    headers: options.headers || {},
    cache: options.cache || 'no-store',
  });
  if (!res.ok) {
    throw new Error(options.errorMessage || `Request failed: ${res.status}`);
  }
  return res.json();
}

function buildAuthHeaders(apiKey) {
  return apiKey ? { 'Authorization': apiKey } : {};
}

function createRequestId(prefix = 'req') {
  const safePrefix = String(prefix || 'req').replace(/[^a-zA-Z0-9_-]/g, '') || 'req';
  if (crypto && typeof crypto.randomUUID === 'function') {
    return `${safePrefix}-${crypto.randomUUID()}`;
  }
  return `${safePrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

window.AdminAuth = {
  ensureAdminKey,
  ensureFunctionKey,
  getFunctionAccessState,
  initializeFunctionPage,
  initializeFunctionScene,
  setFunctionStatus,
  showFunctionToast,
  setFunctionActionButtons,
  withFunctionAuth,
  buildFunctionJsonHeaders,
  postFunctionJson,
  postFunctionJsonExpectJson,
  postFunctionJsonRaw,
  getBridgeBackendTraceId,
  getBridgeRequestId,
  getBridgeIdempotencyKey,
  getBridgeMode,
  isBridgeMode,
  isProbeBridgeResponse,
  isBackendForwardBridgeResponse,
  getBridgeRetryAfter,
  getBridgeFailureMessage,
  parseBridgeError,
  splitBridgeErrorMessage,
  getManifestBridgeMode,
  getBridgeReadyStatusMessage,
  getBridgeResponseStatusMessage,
  executeBridgeJson,
  getJson,
  buildAuthHeaders,
  createRequestId,
  logout,
  functionLogout,
};

function logout() {
  clearStoredAppKey();
  clearStoredFunctionKey();
  window.location.href = '/admin/login';
}

function functionLogout() {
  clearStoredFunctionKey();
  window.location.href = '/login';
}

async function fetchStorageType() {
  const apiKey = await ensureAdminKey();
  if (apiKey === null) return null;
  try {
    const res = await fetch('/v1/admin/storage', {
      headers: buildAuthHeaders(apiKey)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data && data.type) ? String(data.type) : null;
  } catch (e) {
    return null;
  }
}

function formatStorageLabel(type) {
  if (!type) return '-';
  const normalized = type.toLowerCase();
  const map = {
    local: 'local',
    mysql: 'mysql',
    pgsql: 'pgsql',
    postgres: 'pgsql',
    postgresql: 'pgsql',
    redis: 'redis'
  };
  return map[normalized] || '-';
}

async function updateStorageModeButton() {
  const btn = document.getElementById('storage-mode-btn');
  if (!btn) return;
  btn.textContent = '...';
  btn.title = typeof t === 'function' ? t('nav.storageMode') : '存储模式';
  btn.classList.remove('storage-ready');
  const storageType = await fetchStorageType();
  const label = formatStorageLabel(storageType);
  btn.textContent = label === '-' ? label : label.toUpperCase();
  btn.title = typeof t === 'function' ? t('nav.storageMode') : '存储模式';
  if (label !== '-') {
    btn.classList.add('storage-ready');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateStorageModeButton);
} else {
  updateStorageModeButton();
}

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

function buildAuthHeaders(apiKey) {
  return apiKey ? { 'Authorization': apiKey } : {};
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
  buildAuthHeaders,
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

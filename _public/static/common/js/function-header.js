const FUNCTION_MANIFEST_ENDPOINT = '/v1/function/manifest';

async function loadFunctionManifestSummary() {
  try {
    const res = await fetch(FUNCTION_MANIFEST_ENDPOINT, { cache: 'no-store' });
    if (!res.ok) throw new Error('manifest fetch failed');
    return await res.json();
  } catch (e) {
    return null;
  }
}

function applyFunctionManifestSummary(container, manifest) {
  if (!container || !manifest || !manifest.scenes) return;
  const navMap = {
    '/chat': 'chat',
    '/imagine': 'imagine',
    '/video': 'video',
    '/voice': 'voice',
  };

  const links = container.querySelectorAll('a[data-nav]');
  links.forEach((link) => {
    const target = link.getAttribute('data-nav') || '';
    const sceneName = navMap[target];
    if (!sceneName) return;
    const scene = manifest.scenes[sceneName];
    if (!scene) return;
    const ui = scene.ui || {};
    const access = scene.access || {};
    const enabled = access.enabled !== false;
    const titleParts = [];
    if (ui.description) titleParts.push(ui.description);
    if (!enabled) titleParts.push('当前入口暂不可用');
    if (titleParts.length) {
      link.title = titleParts.join('｜');
    }
    link.dataset.sceneEnabled = enabled ? 'true' : 'false';
    if (!enabled) {
      link.classList.add('nav-link-disabled');
      link.setAttribute('aria-disabled', 'true');
      link.addEventListener('click', (event) => {
        event.preventDefault();
      });
    }
  });
}

async function loadFunctionHeader() {
  const container = document.getElementById('app-header');
  if (!container) return;
  try {
    const res = await fetch('/static/common/html/function-header.html?v=1.6.1');
    if (!res.ok) return;
    container.innerHTML = await res.text();
    const logoutBtn = container.querySelector('#function-logout-btn');
    if (logoutBtn) {
      logoutBtn.classList.add('hidden');
      try {
        const verify = await fetch('/v1/function/verify', { method: 'GET' });
        if (verify.status === 401) {
          logoutBtn.classList.remove('hidden');
        }
      } catch (e) {
        // Ignore verification errors and keep it hidden
      }
    }
    if (window.I18n) {
      I18n.applyToDOM(container);
      var toggle = container.querySelector('#lang-toggle');
      if (toggle) toggle.textContent = I18n.getLang() === 'zh' ? 'EN' : '中';
    }
    const path = window.location.pathname;
    const links = container.querySelectorAll('a[data-nav]');
    links.forEach((link) => {
      const target = link.getAttribute('data-nav') || '';
      if (target && path.startsWith(target)) {
        link.classList.add('active');
      }
    });
    const manifest = await loadFunctionManifestSummary();
    applyFunctionManifestSummary(container, manifest);
  } catch (e) {
    // Fail silently to avoid breaking page load
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadFunctionHeader);
} else {
  loadFunctionHeader();
}

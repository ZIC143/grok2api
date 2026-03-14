const FUNCTION_MANIFEST_ENDPOINT = '/v1/function/manifest';

function applyChatModelSummary(container, manifest) {
  if (!container || !manifest || !manifest.scenes || !manifest.scenes.chat) return;
  const host = container.querySelector('#function-summary-badges');
  if (!host) return;
  const chatScene = manifest.scenes.chat;
  const models = chatScene.bootstrap && chatScene.bootstrap.models && Array.isArray(chatScene.bootstrap.models.available)
    ? chatScene.bootstrap.models.available
    : [];
  if (!models.length) return;
  const badge = document.createElement('span');
  badge.className = 'nav-summary-badge nav-summary-muted';
  badge.textContent = `Chat 模型 ${models.length}`;
  badge.title = `聊天场景可用模型数：${models.length}`;
  host.appendChild(badge);
}

function applyCapabilitySummary(container, manifest) {
  if (!container || !manifest || !manifest.scenes) return;
  const host = container.querySelector('#function-summary-badges');
  if (!host) return;

  const sceneEntries = Object.values(manifest.scenes);
  const imageRefSupported = sceneEntries.some((scene) => scene && scene.capabilities && scene.capabilities.image_reference_supported);
  const reasoningSupported = sceneEntries.some((scene) => scene && scene.capabilities && scene.capabilities.reasoning_effort_supported);
  const streamSupported = sceneEntries.some((scene) => scene && scene.capabilities && scene.capabilities.streaming_supported);

  const badges = [];
  if (imageRefSupported) {
    badges.push({ label: '参考图', title: '至少一个场景支持参考图输入' });
  }
  if (reasoningSupported) {
    badges.push({ label: '推理强度', title: '至少一个场景支持 reasoning effort 相关参数' });
  }
  if (!streamSupported) {
    badges.push({ label: '无流桥接', title: '当前 Worker 入口仍不提供流式执行桥接' });
  }

  badges.forEach((badge) => {
    const el = document.createElement('span');
    el.className = 'nav-summary-badge nav-summary-muted';
    el.textContent = badge.label;
    el.title = badge.title;
    host.appendChild(el);
  });
}

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

  const badgesHost = container.querySelector('#function-summary-badges');
  if (badgesHost) {
    badgesHost.innerHTML = '';
    const sceneEntries = Object.entries(manifest.scenes)
      .filter(([, scene]) => scene && scene.access)
      .map(([sceneName, scene]) => ({
        sceneName,
        enabled: scene.access.enabled !== false,
        authRequired: Boolean(scene.access.auth_required),
        publicAccess: Boolean(scene.access.public_access),
      }));

    const totalEnabled = sceneEntries.filter((entry) => entry.enabled).length;
    const publicCount = sceneEntries.filter((entry) => entry.publicAccess).length;
    const authCount = sceneEntries.filter((entry) => entry.authRequired).length;

    const badges = [
      { label: `已启用 ${totalEnabled}`, tone: totalEnabled > 0 ? 'ready' : 'muted', title: '当前可用的 function 场景数量' },
      { label: `公开 ${publicCount}`, tone: publicCount > 0 ? 'info' : 'muted', title: '无需 function key 的入口数量' },
      { label: `鉴权 ${authCount}`, tone: authCount > 0 ? 'warn' : 'muted', title: '需要 function key 的入口数量' },
    ];

    badges.forEach((badge) => {
      const el = document.createElement('span');
      el.className = `nav-summary-badge nav-summary-${badge.tone}`;
      el.textContent = badge.label;
      el.title = badge.title;
      badgesHost.appendChild(el);
    });
  }

  applyChatModelSummary(container, manifest);
  applyCapabilitySummary(container, manifest);

  const banner = document.getElementById('function-status-banner');
  if (banner) {
    const disabledScenes = Object.entries(manifest.scenes)
      .filter(([, scene]) => scene && scene.access && scene.access.enabled === false)
      .map(([sceneName, scene]) => (scene.ui && scene.ui.title) ? scene.ui.title : sceneName);
    if (disabledScenes.length) {
      banner.classList.remove('hidden');
      banner.textContent = `当前不可用入口：${disabledScenes.join('、')}`;
      banner.title = '来自 function manifest 的入口状态摘要';
    } else {
      banner.classList.add('hidden');
      banner.textContent = '';
      banner.removeAttribute('title');
    }
  }
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
        const accessState = window.AdminAuth && typeof window.AdminAuth.getFunctionAccessState === 'function'
          ? await window.AdminAuth.getFunctionAccessState()
          : { requiresLogin: false };
        if (accessState.requiresLogin) {
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

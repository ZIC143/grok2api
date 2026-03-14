function json(data, init = {}) {
  return Response.json(data, {
    headers: {
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
    ...init,
  });
}

const CONFIG_KEY = 'grok2api:config:runtime';
const FLAGS_KEY = 'grok2api:runtime:flags';

const MODEL_CATALOG = [
  { id: 'grok-3', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-3-mini', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-3-thinking', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-4', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-4-thinking', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-4-heavy', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'super', cost: 'high' },
  { id: 'grok-4.1-mini', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-4.1-fast', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-4.1-expert', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'high' },
  { id: 'grok-4.1-thinking', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'high' },
  { id: 'grok-4.20-beta', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-imagine-1.0-fast', owned_by: 'grok2api@cloudflare', mode: 'image', tier: 'basic', cost: 'high' },
  { id: 'grok-imagine-1.0', owned_by: 'grok2api@cloudflare', mode: 'image', tier: 'basic', cost: 'high' },
  { id: 'grok-imagine-1.0-edit', owned_by: 'grok2api@cloudflare', mode: 'image_edit', tier: 'basic', cost: 'high' },
  { id: 'grok-imagine-1.0-video', owned_by: 'grok2api@cloudflare', mode: 'video', tier: 'basic', cost: 'high' },
];

function getModelCatalogResponse() {
  return MODEL_CATALOG.map((model) => ({
    id: model.id,
    object: 'model',
    created: 0,
    owned_by: model.owned_by,
    metadata: {
      mode: model.mode,
      tier: model.tier,
      cost: model.cost,
      runtime: 'cloudflare-workers-bridge',
    },
  }));
}

function getConfigSummary(config) {
  return {
    sections: Object.keys(config),
    app: {
      function_enabled: Boolean(config.app?.function_enabled),
      image_format: config.app?.image_format || 'url',
      video_format: config.app?.video_format || 'html',
      temporary: Boolean(config.app?.temporary),
      disable_memory: Boolean(config.app?.disable_memory),
      stream: Boolean(config.app?.stream),
      thinking: Boolean(config.app?.thinking),
    },
    proxy: {
      enabled: Boolean(config.proxy?.enabled),
      has_base_proxy_url: Boolean(config.proxy?.base_proxy_url),
      has_asset_proxy_url: Boolean(config.proxy?.asset_proxy_url),
      has_cf_clearance: Boolean(config.proxy?.cf_clearance),
    },
    token: {
      auto_refresh: Boolean(config.token?.auto_refresh),
      refresh_interval_hours: config.token?.refresh_interval_hours,
      super_refresh_interval_hours: config.token?.super_refresh_interval_hours,
    },
    runtime: config.runtime || {},
  };
}

const DEFAULT_RUNTIME_CONFIG = {
  app: {
    app_url: '',
    app_key: 'grok2api',
    api_key: '',
    function_enabled: false,
    function_key: '',
    image_format: 'url',
    video_format: 'html',
    temporary: true,
    disable_memory: true,
    stream: true,
    thinking: true,
    dynamic_statsig: true,
    custom_instruction: '',
    filter_tags: ['xaiartifact', 'xai:tool_usage_card', 'grok:render'],
  },
  proxy: {
    base_proxy_url: '',
    asset_proxy_url: '',
    cf_cookies: '',
    skip_proxy_ssl_verify: false,
    enabled: false,
    flaresolverr_url: '',
    refresh_interval: 3600,
    timeout: 60,
    cf_clearance: '',
    browser: 'chrome136',
    user_agent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  },
  retry: {
    max_retry: 3,
    retry_status_codes: [401, 429, 403],
    reset_session_status_codes: [403],
    retry_backoff_base: 0.5,
    retry_backoff_factor: 2,
    retry_backoff_max: 20,
    retry_budget: 60,
  },
  token: {
    auto_refresh: true,
    refresh_interval_hours: 8,
    super_refresh_interval_hours: 2,
    fail_threshold: 5,
    save_delay_ms: 500,
    usage_flush_interval_sec: 5,
    reload_interval_sec: 30,
  },
  cache: {
    enable_auto_clean: true,
    limit_mb: 512,
  },
  chat: {
    concurrent: 50,
    timeout: 60,
    stream_timeout: 60,
  },
  image: {
    timeout: 60,
    stream_timeout: 60,
    final_timeout: 15,
    blocked_grace_seconds: 10,
    nsfw: true,
    medium_min_bytes: 30000,
    final_min_bytes: 100000,
    blocked_parallel_attempts: 5,
    blocked_parallel_enabled: true,
  },
  imagine_fast: {
    n: 1,
    size: '1024x1024',
    response_format: 'url',
  },
  video: {
    concurrent: 100,
    timeout: 60,
    stream_timeout: 60,
    upscale_timing: 'complete',
  },
  voice: {
    timeout: 60,
  },
  asset: {
    upload_concurrent: 100,
    upload_timeout: 60,
    download_concurrent: 100,
    download_timeout: 60,
    list_concurrent: 100,
    list_timeout: 60,
    list_batch_size: 50,
    delete_concurrent: 100,
    delete_timeout: 60,
    delete_batch_size: 50,
  },
  nsfw: {
    concurrent: 60,
    batch_size: 30,
    timeout: 60,
  },
  usage: {
    concurrent: 100,
    batch_size: 50,
    timeout: 60,
  },
  runtime: {
    app_name: 'grok2api',
    environment: 'unknown',
    runtime: 'cloudflare-workers',
  },
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return deepClone(override);
  }

  const result = deepClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = deepClone(value);
    }
  }
  return result;
}

function buildDefaultConfig(env) {
  const config = deepClone(DEFAULT_RUNTIME_CONFIG);
  config.runtime.app_name = env.APP_NAME || 'grok2api';
  config.runtime.environment = env.APP_ENV || 'unknown';
  config.app.app_url = env.APP_URL || '';
  return config;
}

function pruneUnknownConfig(config, defaults) {
  if (!isPlainObject(config)) {
    return { config: {}, removed: { __root__: ['<section>'] } };
  }

  const pruned = {};
  const removed = {};

  for (const [section, value] of Object.entries(config)) {
    if (!(section in defaults)) {
      removed[section] = ['<section>'];
      continue;
    }

    const defaultSection = defaults[section];
    if (isPlainObject(defaultSection) && isPlainObject(value)) {
      const kept = {};
      const removedKeys = [];
      for (const [key, sectionValue] of Object.entries(value)) {
        if (key in defaultSection) {
          kept[key] = sectionValue;
        } else {
          removedKeys.push(key);
        }
      }
      if (Object.keys(kept).length > 0) {
        pruned[section] = kept;
      }
      if (removedKeys.length > 0) {
        removed[section] = removedKeys;
      }
      continue;
    }

    pruned[section] = value;
  }

  return { config: pruned, removed };
}

function migrateLegacyConfig(config) {
  if (!isPlainObject(config)) {
    return { config: {}, migrated: {} };
  }

  const next = deepClone(config);
  const migrated = {};
  const mapping = {
    'grok.temporary': 'app.temporary',
    'grok.disable_memory': 'app.disable_memory',
    'grok.stream': 'app.stream',
    'grok.thinking': 'app.thinking',
    'grok.dynamic_statsig': 'app.dynamic_statsig',
    'grok.filter_tags': 'app.filter_tags',
    'grok.base_proxy_url': 'proxy.base_proxy_url',
    'grok.asset_proxy_url': 'proxy.asset_proxy_url',
    'grok.cf_clearance': 'proxy.cf_clearance',
    'grok.browser': 'proxy.browser',
    'grok.user_agent': 'proxy.user_agent',
    'security.cf_clearance': 'proxy.cf_clearance',
    'security.browser': 'proxy.browser',
    'security.user_agent': 'proxy.user_agent',
    'network.base_proxy_url': 'proxy.base_proxy_url',
    'network.asset_proxy_url': 'proxy.asset_proxy_url',
  };

  for (const [source, target] of Object.entries(mapping)) {
    const [sourceSection, sourceKey] = source.split('.');
    const [targetSection, targetKey] = target.split('.');
    if (!isPlainObject(next[sourceSection])) {
      continue;
    }
    if (!(sourceKey in next[sourceSection])) {
      continue;
    }
    if (!isPlainObject(next[targetSection])) {
      next[targetSection] = {};
    }
    if (!(targetKey in next[targetSection])) {
      next[targetSection][targetKey] = next[sourceSection][sourceKey];
      migrated[source] = target;
    }
    delete next[sourceSection][sourceKey];
    if (Object.keys(next[sourceSection]).length === 0) {
      delete next[sourceSection];
    }
  }

  if (isPlainObject(next.chat)) {
    const legacyChatMap = {
      temporary: 'temporary',
      disable_memory: 'disable_memory',
      stream: 'stream',
      thinking: 'thinking',
      dynamic_statsig: 'dynamic_statsig',
      filter_tags: 'filter_tags',
    };
    if (!isPlainObject(next.app)) {
      next.app = {};
    }
    for (const [oldKey, newKey] of Object.entries(legacyChatMap)) {
      if (oldKey in next.chat && !(newKey in next.app)) {
        next.app[newKey] = next.chat[oldKey];
        migrated[`chat.${oldKey}`] = `app.${newKey}`;
        delete next.chat[oldKey];
      }
    }
    if (Object.keys(next.chat).length === 0) {
      delete next.chat;
    }
  }

  return { config: next, migrated };
}

function normalizeConfig(env, candidate) {
  const defaults = buildDefaultConfig(env);
  const migratedResult = migrateLegacyConfig(candidate);
  const prunedResult = pruneUnknownConfig(migratedResult.config, defaults);
  const merged = deepMerge(defaults, prunedResult.config);

  return {
    config: merged,
    migrated: migratedResult.migrated,
    removed: prunedResult.removed,
    defaults,
  };
}

async function ensureD1Schema(env) {
  if (!(env.DB && typeof env.DB.prepare === 'function')) {
    return { ok: false, detail: 'binding-missing' };
  }

  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS worker_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    ).run();
    return { ok: true, detail: 'schema-ready' };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function upsertWorkerState(env, key, value) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO worker_state (key, value, updated_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(key, JSON.stringify(value), now)
    .run();
}

async function getWorkerState(env, key) {
  const row = await env.DB.prepare(
    'SELECT key, value, updated_at FROM worker_state WHERE key = ?1'
  )
    .bind(key)
    .first();

  if (!row) {
    return null;
  }

  let parsedValue = row.value;
  try {
    parsedValue = JSON.parse(row.value);
  } catch {
    // keep raw string value
  }

  return {
    key: row.key,
    value: parsedValue,
    updated_at: row.updated_at,
  };
}

async function getRuntimeConfig(env) {
  const defaultConfig = buildDefaultConfig(env);

  if (!(env.KV_CACHE && typeof env.KV_CACHE.get === 'function')) {
    return {
      source: 'default',
      config: defaultConfig,
      migrated: {},
      removed: {},
    };
  }

  const stored = await env.KV_CACHE.get(CONFIG_KEY, { type: 'json' });
  if (stored && typeof stored === 'object') {
    const normalized = normalizeConfig(env, stored);
    return {
      source: 'kv',
      config: normalized.config,
      migrated: normalized.migrated,
      removed: normalized.removed,
    };
  }

  return {
    source: 'default',
    config: defaultConfig,
    migrated: {},
    removed: {},
  };
}

async function saveRuntimeConfig(env, payload) {
  if (!(env.KV_CACHE && typeof env.KV_CACHE.put === 'function')) {
    return { ok: false, detail: 'kv-binding-missing' };
  }

  await env.KV_CACHE.put(CONFIG_KEY, JSON.stringify(payload));
  return { ok: true, detail: 'config-saved' };
}

async function getRuntimeFlags(env) {
  const defaults = {
    bridge_readonly: false,
    maintenance_mode: false,
    models_bridge_enabled: true,
  };

  if (!(env.KV_CACHE && typeof env.KV_CACHE.get === 'function')) {
    return { source: 'default', flags: defaults };
  }

  const stored = await env.KV_CACHE.get(FLAGS_KEY, { type: 'json' });
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { source: 'default', flags: defaults };
  }

  return {
    source: 'kv',
    flags: {
      ...defaults,
      ...stored,
    },
  };
}

async function saveRuntimeFlags(env, flags) {
  if (!(env.KV_CACHE && typeof env.KV_CACHE.put === 'function')) {
    return { ok: false, detail: 'kv-binding-missing' };
  }

  await env.KV_CACHE.put(FLAGS_KEY, JSON.stringify(flags));
  return { ok: true, detail: 'flags-saved' };
}

async function getStorageSnapshot(env) {
  const schema = await ensureD1Schema(env);
  const runtimeConfig = await getRuntimeConfig(env);
  const snapshot = {
    environment: env.APP_ENV || 'unknown',
    app_name: env.APP_NAME || 'grok2api',
    kv: {
      available: Boolean(env.KV_CACHE),
      config_source: runtimeConfig.source,
      config_key: CONFIG_KEY,
    },
    d1: {
      available: Boolean(env.DB),
      schema,
      state: null,
    },
    config: runtimeConfig.config,
  };

  if (schema.ok) {
    const current = await getWorkerState(env, 'runtime_config');
    if (!current) {
      await upsertWorkerState(env, 'runtime_config', runtimeConfig.config);
      snapshot.d1.state = await getWorkerState(env, 'runtime_config');
    } else {
      snapshot.d1.state = current;
    }
  }

  return snapshot;
}

async function runStorageCheck(env) {
  const result = {
    d1: { available: false, ok: false, detail: '' },
    kv: { available: false, ok: false, detail: '' },
  };

  if (env.DB && typeof env.DB.prepare === 'function') {
    result.d1.available = true;
    try {
      const schema = await ensureD1Schema(env);
      if (!schema.ok) {
        result.d1.detail = schema.detail;
        result.ok = false;
        return result;
      }
      const row = await env.DB.prepare('SELECT 1 AS ok').first();
      result.d1.ok = Number(row?.ok) === 1;
      result.d1.detail = result.d1.ok ? 'query-ok' : 'unexpected-result';
    } catch (error) {
      result.d1.detail = error instanceof Error ? error.message : String(error);
    }
  } else {
    result.d1.detail = 'binding-missing';
  }

  if (env.KV_CACHE && typeof env.KV_CACHE.get === 'function') {
    result.kv.available = true;
    const key = `grok2api:health:${crypto.randomUUID()}`;
    try {
      await env.KV_CACHE.put(key, 'ok', { expirationTtl: 60 });
      const value = await env.KV_CACHE.get(key);
      await env.KV_CACHE.delete(key);
      result.kv.ok = value === 'ok';
      result.kv.detail = result.kv.ok ? 'roundtrip-ok' : 'unexpected-value';
    } catch (error) {
      result.kv.detail = error instanceof Error ? error.message : String(error);
    }
  } else {
    result.kv.detail = 'binding-missing';
  }

  result.ok = result.d1.ok && result.kv.ok;
  return result;
}

async function getRuntimeStatus(env) {
  const [runtimeConfig, snapshot, checks, runtimeFlags] = await Promise.all([
    getRuntimeConfig(env),
    getStorageSnapshot(env),
    runStorageCheck(env),
    getRuntimeFlags(env),
  ]);

  return {
    app: env.APP_NAME || 'grok2api',
    environment: env.APP_ENV || 'unknown',
    source: runtimeConfig.source,
    migrated: runtimeConfig.migrated,
    removed: runtimeConfig.removed,
    flags: runtimeFlags,
    checks,
    storage: snapshot,
  };
}

async function getOpenAIMetadata(env) {
  const runtimeConfig = await getRuntimeConfig(env);
  return {
    object: 'service',
    id: 'grok2api-cloudflare-workers',
    created: 0,
    owned_by: 'grok2api@cloudflare',
    version: 'bridge-v1',
    runtime: {
      name: 'cloudflare-workers',
      environment: env.APP_ENV || 'unknown',
      source: runtimeConfig.source,
    },
    endpoints: {
      models: '/v1/models',
      model_detail: '/v1/models/:id',
      runtime_status: '/v1/runtime/status',
      runtime_checks: '/v1/runtime/checks',
      runtime_storage: '/v1/runtime/storage',
      config_summary: '/v1/config/summary',
      metadata: '/v1/metadata',
    },
    capabilities: {
      models_list: true,
      model_detail: true,
      runtime_status: true,
      runtime_checks: true,
      runtime_storage: true,
      config_summary: true,
      config_write: true,
      responses_bridge: false,
      chat_bridge: false,
      image_bridge: false,
      video_bridge: false,
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        runtime: 'cloudflare-workers',
        environment: env.APP_ENV || 'unknown',
        bindings: {
          d1: Boolean(env.DB),
          kv: Boolean(env.KV_CACHE),
        },
      });
    }

    if (url.pathname === '/ready') {
      const checks = await runStorageCheck(env);
      return json(
        {
          status: checks.ok ? 'ok' : 'degraded',
          runtime: 'cloudflare-workers',
          environment: env.APP_ENV || 'unknown',
          checks,
        },
        { status: checks.ok ? 200 : 503 }
      );
    }

    if (url.pathname === '/meta') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json({
        app: env.APP_NAME || 'grok2api',
        runtime: 'cloudflare-workers',
        environment: env.APP_ENV || 'unknown',
        endpoints: ['/health', '/ready', '/meta', '/config', '/storage', '/config/sections', '/v1/models', '/v1/models/:id', '/v1/runtime/status', '/v1/runtime/checks', '/v1/runtime/storage', '/v1/config/summary', '/v1/metadata'],
        sections: Object.keys(runtimeConfig.config),
      });
    }

    if (url.pathname === '/v1/models' && request.method === 'GET') {
      return json({
        object: 'list',
        data: getModelCatalogResponse(),
      });
    }

    if (url.pathname.startsWith('/v1/models/') && request.method === 'GET') {
      const modelId = decodeURIComponent(url.pathname.slice('/v1/models/'.length));
      const model = getModelCatalogResponse().find((item) => item.id === modelId);
      if (!model) {
        return json({ status: 'error', message: 'model-not-found', model: modelId }, { status: 404 });
      }
      return json(model);
    }

    if (url.pathname === '/v1/runtime/status' && request.method === 'GET') {
      const status = await getRuntimeStatus(env);
      return json({ status: 'ok', runtime: status });
    }

    if (url.pathname === '/v1/runtime/checks' && request.method === 'GET') {
      const checks = await runStorageCheck(env);
      return json({ status: checks.ok ? 'ok' : 'degraded', checks });
    }

    if (url.pathname === '/v1/runtime/flags' && request.method === 'GET') {
      const runtimeFlags = await getRuntimeFlags(env);
      return json({ status: 'ok', source: runtimeFlags.source, flags: runtimeFlags.flags });
    }

    if (url.pathname === '/v1/runtime/flags' && request.method === 'POST') {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ status: 'error', message: 'invalid-json' }, { status: 400 });
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json({ status: 'error', message: 'payload-must-be-object' }, { status: 400 });
      }

      const current = await getRuntimeFlags(env);
      const nextFlags = {
        ...current.flags,
        ...payload,
        updated_at: new Date().toISOString(),
      };
      const saveResult = await saveRuntimeFlags(env, nextFlags);
      if (!saveResult.ok) {
        return json({ status: 'error', message: saveResult.detail }, { status: 503 });
      }

      const schema = await ensureD1Schema(env);
      if (schema.ok) {
        await upsertWorkerState(env, 'runtime_flags', nextFlags);
      }

      return json({ status: 'ok', flags: nextFlags });
    }

    if (url.pathname === '/v1/runtime/storage' && request.method === 'GET') {
      const snapshot = await getStorageSnapshot(env);
      return json({ status: snapshot.d1.schema.ok ? 'ok' : 'degraded', storage: snapshot });
    }

    if (url.pathname === '/v1/config/summary' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json({
        status: 'ok',
        source: runtimeConfig.source,
        migrated: runtimeConfig.migrated,
        removed: runtimeConfig.removed,
        summary: getConfigSummary(runtimeConfig.config),
      });
    }

    if (url.pathname === '/v1/metadata' && request.method === 'GET') {
      const metadata = await getOpenAIMetadata(env);
      return json(metadata);
    }

    if (url.pathname === '/config/sections' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json({
        status: 'ok',
        migrated: runtimeConfig.migrated,
        removed: runtimeConfig.removed,
        sections: Object.fromEntries(
          Object.entries(runtimeConfig.config).map(([section, value]) => [
            section,
            {
              type: Array.isArray(value) ? 'array' : typeof value,
              keys: isPlainObject(value) ? Object.keys(value) : [],
            },
          ])
        ),
      });
    }

    if (url.pathname === '/config' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json({
        status: 'ok',
        environment: env.APP_ENV || 'unknown',
        source: runtimeConfig.source,
        migrated: runtimeConfig.migrated,
        removed: runtimeConfig.removed,
        config: runtimeConfig.config,
      });
    }

    if (url.pathname.startsWith('/config/') && request.method === 'GET' && url.pathname !== '/config/sections') {
      const section = decodeURIComponent(url.pathname.slice('/config/'.length));
      const runtimeConfig = await getRuntimeConfig(env);
      if (!(section in runtimeConfig.config)) {
        return json({ status: 'error', message: 'section-not-found', section }, { status: 404 });
      }
      return json({
        status: 'ok',
        section,
        value: runtimeConfig.config[section],
        migrated: runtimeConfig.migrated,
        removed: runtimeConfig.removed,
      });
    }

    if (url.pathname === '/config' && request.method === 'POST') {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ status: 'error', message: 'invalid-json' }, { status: 400 });
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json({ status: 'error', message: 'payload-must-be-object' }, { status: 400 });
      }

      const currentConfig = await getRuntimeConfig(env);
      const normalized = normalizeConfig(env, deepMerge(currentConfig.config, payload));
      const nextConfig = normalized.config;
      nextConfig.runtime = {
        ...nextConfig.runtime,
        updated_at: new Date().toISOString(),
      };
      const saveResult = await saveRuntimeConfig(env, nextConfig);
      if (!saveResult.ok) {
        return json({ status: 'error', message: saveResult.detail }, { status: 503 });
      }

      const schema = await ensureD1Schema(env);
      if (schema.ok) {
        await upsertWorkerState(env, 'runtime_config', nextConfig);
      }

      return json({
        status: 'ok',
        config: nextConfig,
        migrated: normalized.migrated,
        removed: normalized.removed,
      });
    }

    if (url.pathname === '/config/reset' && request.method === 'POST') {
      const nextConfig = buildDefaultConfig(env);
      nextConfig.runtime = {
        ...nextConfig.runtime,
        updated_at: new Date().toISOString(),
      };

      const saveResult = await saveRuntimeConfig(env, nextConfig);
      if (!saveResult.ok) {
        return json({ status: 'error', message: saveResult.detail }, { status: 503 });
      }

      const schema = await ensureD1Schema(env);
      if (schema.ok) {
        await upsertWorkerState(env, 'runtime_config', nextConfig);
      }

      return json({ status: 'ok', reset: true, config: nextConfig });
    }

    if (url.pathname.startsWith('/config/') && request.method === 'POST') {
      const section = decodeURIComponent(url.pathname.slice('/config/'.length));
      if (!section || section === 'sections') {
        return json({ status: 'error', message: 'invalid-section' }, { status: 400 });
      }

      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ status: 'error', message: 'invalid-json' }, { status: 400 });
      }

      if (!isPlainObject(payload)) {
        return json({ status: 'error', message: 'payload-must-be-object' }, { status: 400 });
      }

      const currentConfig = await getRuntimeConfig(env);
      if (!(section in currentConfig.config)) {
        return json({ status: 'error', message: 'section-not-found', section }, { status: 404 });
      }

      const normalized = normalizeConfig(env, {
        ...currentConfig.config,
        [section]: deepMerge(currentConfig.config[section], payload),
      });
      const nextConfig = normalized.config;
      nextConfig.runtime = {
        ...nextConfig.runtime,
        updated_at: new Date().toISOString(),
      };

      const saveResult = await saveRuntimeConfig(env, nextConfig);
      if (!saveResult.ok) {
        return json({ status: 'error', message: saveResult.detail }, { status: 503 });
      }

      const schema = await ensureD1Schema(env);
      if (schema.ok) {
        await upsertWorkerState(env, 'runtime_config', nextConfig);
      }

      return json({
        status: 'ok',
        section,
        value: nextConfig[section],
        migrated: normalized.migrated,
        removed: normalized.removed,
      });
    }

    if (url.pathname === '/storage') {
      const snapshot = await getStorageSnapshot(env);
      return json({
        status: snapshot.d1.schema.ok ? 'ok' : 'degraded',
        snapshot,
      }, { status: snapshot.d1.schema.ok ? 200 : 503 });
    }

    return json(
      {
        status: 'deployed',
        message: 'Cloudflare Workers minimal runtime with config and storage is ready.',
        path: url.pathname,
        hint: 'Use /health, /ready, /meta, /config or /storage.',
      },
      { status: 200 }
    );
  },
};

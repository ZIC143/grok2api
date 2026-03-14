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
  if (!(env.KV_CACHE && typeof env.KV_CACHE.get === 'function')) {
    return {
      source: 'default',
      config: {
        app_name: env.APP_NAME || 'grok2api',
        environment: env.APP_ENV || 'unknown',
        runtime: 'cloudflare-workers',
      },
    };
  }

  const stored = await env.KV_CACHE.get(CONFIG_KEY, { type: 'json' });
  if (stored && typeof stored === 'object') {
    return { source: 'kv', config: stored };
  }

  return {
    source: 'default',
    config: {
      app_name: env.APP_NAME || 'grok2api',
      environment: env.APP_ENV || 'unknown',
      runtime: 'cloudflare-workers',
    },
  };
}

async function saveRuntimeConfig(env, payload) {
  if (!(env.KV_CACHE && typeof env.KV_CACHE.put === 'function')) {
    return { ok: false, detail: 'kv-binding-missing' };
  }

  await env.KV_CACHE.put(CONFIG_KEY, JSON.stringify(payload));
  return { ok: true, detail: 'config-saved' };
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
      return json({
        app: env.APP_NAME || 'grok2api',
        runtime: 'cloudflare-workers',
        environment: env.APP_ENV || 'unknown',
        endpoints: ['/health', '/ready', '/meta', '/config', '/storage'],
      });
    }

    if (url.pathname === '/config' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json({
        status: 'ok',
        environment: env.APP_ENV || 'unknown',
        source: runtimeConfig.source,
        config: runtimeConfig.config,
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

      const nextConfig = {
        ...(await getRuntimeConfig(env)).config,
        ...payload,
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

      return json({ status: 'ok', config: nextConfig });
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

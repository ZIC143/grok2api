function json(data, init = {}) {
  return Response.json(data, {
    headers: {
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
    ...init,
  });
}

async function runStorageCheck(env) {
  const result = {
    d1: { available: false, ok: false, detail: '' },
    kv: { available: false, ok: false, detail: '' },
  };

  if (env.DB && typeof env.DB.prepare === 'function') {
    result.d1.available = true;
    try {
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
        app: 'grok2api',
        runtime: 'cloudflare-workers',
        environment: env.APP_ENV || 'unknown',
        endpoints: ['/health', '/ready', '/meta'],
      });
    }

    return json(
      {
        status: 'deployed',
        message: 'Cloudflare Workers minimal runtime is ready.',
        path: url.pathname,
        hint: 'Use /health, /ready or /meta.',
      },
      { status: 200 }
    );
  },
};

# Grok2API on Cloudflare Workers (Python)

## Requirements
- Node.js (for Wrangler runtime tooling)
- Python 3.13+
- uv
- Cloudflare account + API token

## Files
- wrangler.jsonc: Workers config (bindings + vars)
- src/entry.py: Python Worker entrypoint

## Bindings
- D1: `DB`
- KV: `KV_CACHE`
- R2: `R2_STORAGE`

## Local Dev
```bash
uv run pywrangler dev
```

## Deploy
```bash
uv run pywrangler deploy
```

## Notes
- `PLATFORM=cloudflare` enables httpx fallback for reverse requests.
- Storage is D1-backed via `SERVER_STORAGE_TYPE=d1`.
- Cache stats and list use KV index; file content is served from KV (small) or R2 (large).
- `curl_cffi` is not used on Workers; httpx fallback success rate is lower.

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

## 自动资源创建（GitHub Actions）
GitHub Actions 会自动创建或复用以下资源，并把绑定写入 wrangler.jsonc：
- KV 命名空间（含 preview）
- D1 数据库（写入 `database_id`）
- R2 Bucket

只需在仓库 Secrets 中配置：
- `CLOUDFLARE_API_TOKEN`（需要 Workers Scripts、D1、KV、R2 权限）
- `CLOUDFLARE_ACCOUNT_ID`

如需修改资源名称，请在 [​.github/workflows/deploy-cloudflare.yml](.github/workflows/deploy-cloudflare.yml) 中调整 `DB_NAME` / `R2_NAME` / `KV_NAME` / `KV_PREVIEW_NAME`。

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
- Cache stats and list use KV index; file content is served from KV (small) or R2 (large, optional).
- `curl_cffi` is not used on Workers; httpx fallback success rate is lower.
- WebSocket features (image/voice) are disabled on Workers.
 - If R2 is disabled, `/v1/files` only serves KV hits and falls back to direct asset URLs.

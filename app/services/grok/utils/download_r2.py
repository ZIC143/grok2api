"""R2-backed download cache for Cloudflare Workers."""

from __future__ import annotations

import hashlib
from typing import Optional, Tuple
from urllib.parse import urlparse

from app.core.config import get_config
from app.core.logger import logger
from app.core.runtime import get_binding
from app.services.reverse.assets_download import AssetsDownloadReverse
from app.services.reverse.utils.session import ResettableSession
from app.services.grok.utils.locks import _get_download_semaphore


class R2DownloadService:
    """Assets download service backed by R2."""

    def __init__(self):
        self._session: Optional[ResettableSession] = None
        self._bucket = get_binding("R2_STORAGE")
        if self._bucket is None:
            raise RuntimeError("R2 binding is required")

    async def create(self) -> ResettableSession:
        if self._session is None:
            browser = get_config("proxy.browser")
            if browser:
                self._session = ResettableSession(impersonate=browser)
            else:
                self._session = ResettableSession()
        return self._session

    async def close(self):
        if self._session:
            await self._session.close()
            self._session = None

    def _normalize_path(self, file_path: str) -> str:
        if not isinstance(file_path, str) or not file_path.strip():
            raise ValueError("Invalid file path")
        value = file_path.strip()
        parsed = urlparse(value)
        if parsed.scheme or parsed.netloc:
            path = parsed.path or ""
            if parsed.query:
                path = f"{path}?{parsed.query}"
        else:
            path = value
        if not path.startswith("/"):
            path = f"/{path}"
        return path

    def _key_for(self, media_type: str, path: str) -> str:
        digest = hashlib.sha1(path.encode("utf-8")).hexdigest()[:32]
        safe = path.lstrip("/").replace("/", "-")
        return f"cache/{media_type}/{digest}_{safe}"

    async def resolve_url(self, path_or_url: str, token: str, media_type: str = "image") -> str:
        asset_url = path_or_url
        path = path_or_url
        if path_or_url.startswith("http"):
            parsed = urlparse(path_or_url)
            path = parsed.path or ""
            asset_url = path_or_url
        else:
            if not path_or_url.startswith("/"):
                path_or_url = f"/{path_or_url}"
            path = path_or_url
            asset_url = f"https://assets.grok.com{path_or_url}"

        app_url = get_config("app.app_url")
        if app_url:
            await self.download_file(asset_url, token, media_type)
            return f"{app_url.rstrip('/')}/v1/files/{media_type}{path}"
        return asset_url

    async def render_image(self, url: str, token: str, image_id: str = "image") -> str:
        fmt = get_config("app.image_format")
        fmt = fmt.lower() if isinstance(fmt, str) else "url"
        if fmt not in ("base64", "url", "markdown"):
            fmt = "url"
        if fmt == "base64":
            # For Workers, base64 rendering falls back to direct fetch (no cache)
            return await self.resolve_url(url, token, "image")
        final_url = await self.resolve_url(url, token, "image")
        return f"![{image_id}]({final_url})"

    async def render_video(self, video_url: str, token: str, thumbnail_url: str = "") -> str:
        fmt = get_config("app.video_format")
        fmt = fmt.lower() if isinstance(fmt, str) else "url"
        if fmt not in ("url", "markdown", "html"):
            fmt = "url"
        final_video_url = await self.resolve_url(video_url, token, "video")
        final_thumb_url = ""
        if thumbnail_url:
            final_thumb_url = await self.resolve_url(thumbnail_url, token, "image")
        if fmt == "url":
            return f"{final_video_url}\n"
        if fmt == "markdown":
            return f"[video]({final_video_url})"
        import html
        safe_video_url = html.escape(final_video_url)
        safe_thumbnail_url = html.escape(final_thumb_url)
        poster_attr = f' poster="{safe_thumbnail_url}"' if safe_thumbnail_url else ""
        return f"""<video id="video" controls="" preload="none"{poster_attr}>
  <source id="mp4" src="{safe_video_url}" type="video/mp4">
</video>"""

    async def download_file(self, file_path: str, token: str, media_type: str = "image") -> Tuple[Optional[str], str]:
        async with _get_download_semaphore():
            path = self._normalize_path(file_path)
            key = self._key_for(media_type, path)

            existing = await self._bucket.get(key)
            if existing:
                meta = getattr(existing, "http_metadata", None) or {}
                content_type = None
                if isinstance(meta, dict):
                    content_type = meta.get("content_type") or meta.get("contentType")
                else:
                    content_type = getattr(meta, "content_type", None)
                return key, content_type or "application/octet-stream"

            session = await self.create()
            response = await AssetsDownloadReverse.request(session, token, path)
            data = bytearray()
            if hasattr(response, "aiter_content"):
                async for chunk in response.aiter_content():
                    if chunk:
                        data.extend(chunk)
            else:
                data.extend(response.content or b"")

            mime = response.headers.get("content-type", "application/octet-stream").split(";")[0]
            await self._bucket.put(
                key,
                bytes(data),
                http_metadata={"content_type": mime},
            )
            try:
                from app.services.grok.utils.cache_kv import CacheServiceKV

                kv = CacheServiceKV()
                await kv.upsert_index(media_type, path.lstrip("/"), len(data), content_type=mime)
            except Exception:
                pass
            logger.info(f"Downloaded to R2: {path}")
            return key, mime

    async def get_cached(self, media_type: str, name: str) -> Optional[dict]:
        path = self._normalize_path(name)
        key = self._key_for(media_type, path)
        obj = await self._bucket.get(key)
        if not obj:
            return None
        data = await obj.array_buffer()
        if hasattr(data, "to_bytes"):
            raw = data.to_bytes()
        elif hasattr(data, "toArray"):
            try:
                raw = bytes(data.toArray())
            except Exception:
                raw = None
        else:
            raw = bytes(data)
        meta = getattr(obj, "http_metadata", None) or {}
        content_type = None
        if isinstance(meta, dict):
            content_type = meta.get("content_type") or meta.get("contentType")
        else:
            content_type = getattr(meta, "content_type", None)
        return {
            "content": raw,
            "content_type": content_type or "application/octet-stream",
        }


__all__ = ["R2DownloadService"]

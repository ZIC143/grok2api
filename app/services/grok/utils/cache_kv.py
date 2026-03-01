"""KV-backed cache utilities for Cloudflare Workers."""

from __future__ import annotations

from typing import Any, Dict, Iterable, Optional

from app.core.runtime import get_binding
from app.core.logger import logger

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"}


class CacheServiceKV:
    """KV-based cache service."""

    def __init__(self, namespace: str = "KV_CACHE"):
        self._kv = get_binding(namespace)
        if self._kv is None:
            raise RuntimeError("KV binding is required")

    def _index_key(self, media_type: str) -> str:
        return f"cache:{media_type}:index"

    def _cache_key(self, media_type: str, name: str) -> str:
        safe = name.replace("/", "-")
        return f"cache:{media_type}:{safe}"

    def _allowed_exts(self, media_type: str):
        return IMAGE_EXTS if media_type == "image" else VIDEO_EXTS

    async def _load_index(self, media_type: str) -> Dict[str, Dict[str, Any]]:
        key = self._index_key(media_type)
        data = await self._kv.get(key, type="json")
        if not isinstance(data, dict):
            return {}
        return data

    async def _save_index(self, media_type: str, index: Dict[str, Dict[str, Any]]):
        key = self._index_key(media_type)
        await self._kv.put(key, index)

    async def get_stats(self, media_type: str = "image") -> Dict[str, Any]:
        index = await self._load_index(media_type)
        total_size = sum(item.get("size_bytes", 0) for item in index.values())
        return {
            "count": len(index),
            "size_mb": round(total_size / 1024 / 1024, 2),
        }

    async def list_files(
        self, media_type: str = "image", page: int = 1, page_size: int = 1000
    ) -> Dict[str, Any]:
        index = await self._load_index(media_type)
        items = []
        allowed = self._allowed_exts(media_type)
        for name, meta in index.items():
            if allowed and not any(name.lower().endswith(ext) for ext in allowed):
                continue
            items.append(
                {
                    "name": name,
                    "size_bytes": int(meta.get("size_bytes", 0)),
                    "mtime_ms": int(meta.get("mtime_ms", 0)),
                }
            )
        items.sort(key=lambda x: x["mtime_ms"], reverse=True)
        total = len(items)
        start = max(0, (page - 1) * page_size)
        paged = items[start : start + page_size]
        for item in paged:
            item["view_url"] = f"/v1/files/{media_type}/{item['name']}"
        return {"total": total, "page": page, "page_size": page_size, "items": paged}

    async def delete_file(self, media_type: str, name: str) -> Dict[str, Any]:
        key = self._cache_key(media_type, name)
        index = await self._load_index(media_type)
        existed = name in index
        try:
            await self._kv.delete(key)
            if existed:
                index.pop(name, None)
                await self._save_index(media_type, index)
        except Exception as e:
            logger.warning(f"KV cache delete failed: {e}")
            return {"deleted": False}
        return {"deleted": existed}

    async def clear(self, media_type: str = "image") -> Dict[str, Any]:
        index = await self._load_index(media_type)
        total_size = sum(item.get("size_bytes", 0) for item in index.values())
        count = 0
        for name in list(index.keys()):
            key = self._cache_key(media_type, name)
            try:
                await self._kv.delete(key)
                count += 1
            except Exception:
                pass
        await self._save_index(media_type, {})
        return {"count": count, "size_mb": round(total_size / 1024 / 1024, 2)}

    async def put_item(
        self,
        media_type: str,
        name: str,
        data: bytes,
        content_type: Optional[str] = None,
    ) -> None:
        key = self._cache_key(media_type, name)
        await self._kv.put(key, data)
        await self.upsert_index(
            media_type,
            name,
            len(data) if data else 0,
            content_type=content_type,
        )

    async def upsert_index(
        self,
        media_type: str,
        name: str,
        size_bytes: int,
        content_type: Optional[str] = None,
    ) -> None:
        index = await self._load_index(media_type)
        index[name] = {
            "size_bytes": int(size_bytes) if size_bytes is not None else 0,
            "mtime_ms": __import__("time").time_ns() // 1_000_000,
            "content_type": content_type or "application/octet-stream",
        }
        await self._save_index(media_type, index)

    async def get_item(self, media_type: str, name: str) -> Optional[Dict[str, Any]]:
        key = self._cache_key(media_type, name)
        data = await self._kv.get(key, type="arrayBuffer")
        if data is None:
            return None
        index = await self._load_index(media_type)
        meta = index.get(name, {})
        content_type = meta.get("content_type") or "application/octet-stream"
        if hasattr(data, "to_bytes"):
            raw = data.to_bytes()
        elif hasattr(data, "toArray"):
            try:
                raw = bytes(data.toArray())
            except Exception:
                raw = None
        elif isinstance(data, (bytes, bytearray)):
            raw = bytes(data)
        else:
            try:
                raw = bytes(data)
            except Exception:
                raw = None
        if raw is None:
            return None
        return {"content": raw, "content_type": content_type}


__all__ = ["CacheServiceKV"]

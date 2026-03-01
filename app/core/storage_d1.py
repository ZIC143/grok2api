"""D1 storage backend for Cloudflare Workers."""

from __future__ import annotations

import asyncio
import hashlib
import time
from typing import Any, Dict, Optional

from app.core.logger import logger
from app.core.storage import BaseStorage, StorageError, json_dumps, json_loads, json_dumps_sorted


class D1Storage(BaseStorage):
    """D1 storage implementation using Workers D1 binding."""

    def __init__(self, db: Any):
        if db is None:
            raise ValueError("D1 binding is required")
        self.db = db
        self._initialized = False
        self._init_lock = asyncio.Lock()

    async def _ensure_schema(self) -> None:
        if self._initialized:
            return
        async with self._init_lock:
            if self._initialized:
                return
            await self.db.execute(
                """
                CREATE TABLE IF NOT EXISTS tokens (
                    token TEXT PRIMARY KEY,
                    pool_name TEXT NOT NULL,
                    status TEXT,
                    quota INTEGER,
                    created_at INTEGER,
                    last_used_at INTEGER,
                    use_count INTEGER,
                    fail_count INTEGER,
                    last_fail_at INTEGER,
                    last_fail_reason TEXT,
                    last_sync_at INTEGER,
                    tags TEXT,
                    note TEXT,
                    last_asset_clear_at INTEGER,
                    data TEXT,
                    data_hash TEXT,
                    updated_at INTEGER
                )
                """
            )
            await self.db.execute(
                """
                CREATE TABLE IF NOT EXISTS app_config (
                    section TEXT NOT NULL,
                    key_name TEXT NOT NULL,
                    value TEXT,
                    PRIMARY KEY (section, key_name)
                )
                """
            )
            self._initialized = True

    @staticmethod
    def _normalize_status(status: Any) -> Any:
        if isinstance(status, str) and status.startswith("TokenStatus."):
            return status.split(".", 1)[1].lower()
        if hasattr(status, "value"):
            return getattr(status, "value")
        return status

    @staticmethod
    def _normalize_tags(tags: Any) -> Optional[str]:
        if tags is None:
            return None
        if isinstance(tags, str):
            try:
                parsed = json_loads(tags)
                if isinstance(parsed, list):
                    return tags
            except Exception:
                pass
            return json_dumps([tags])
        return json_dumps(tags)

    @staticmethod
    def _parse_tags(tags: Any) -> Optional[list]:
        if tags is None:
            return None
        if isinstance(tags, str):
            try:
                parsed = json_loads(tags)
                if isinstance(parsed, list):
                    return parsed
            except Exception:
                return []
        if isinstance(tags, list):
            return tags
        return []

    def _token_to_row(self, token_data: Dict[str, Any], pool_name: str) -> Dict[str, Any]:
        token_str = token_data.get("token")
        if isinstance(token_str, str) and token_str.startswith("sso="):
            token_str = token_str[4:]

        status = self._normalize_status(token_data.get("status"))
        tags_json = self._normalize_tags(token_data.get("tags"))
        data_json = json_dumps_sorted(token_data)
        data_hash = hashlib.sha256(data_json.encode("utf-8")).hexdigest()
        note = token_data.get("note") or ""

        return {
            "token": token_str,
            "pool_name": pool_name,
            "status": status,
            "quota": token_data.get("quota"),
            "created_at": token_data.get("created_at"),
            "last_used_at": token_data.get("last_used_at"),
            "use_count": token_data.get("use_count"),
            "fail_count": token_data.get("fail_count"),
            "last_fail_at": token_data.get("last_fail_at"),
            "last_fail_reason": token_data.get("last_fail_reason"),
            "last_sync_at": token_data.get("last_sync_at"),
            "tags": tags_json,
            "note": note,
            "last_asset_clear_at": token_data.get("last_asset_clear_at"),
            "data": data_json,
            "data_hash": data_hash,
            "updated_at": int(time.time()),
        }

    async def load_config(self) -> Dict[str, Any]:
        await self._ensure_schema()
        try:
            result = await self.db.prepare(
                "SELECT section, key_name, value FROM app_config"
            ).all()
            rows = result.results if hasattr(result, "results") else result
            if not rows:
                return None
            config: Dict[str, Any] = {}
            for row in rows:
                section = row.get("section")
                key = row.get("key_name")
                val_str = row.get("value")
                if section is None or key is None:
                    continue
                if section not in config:
                    config[section] = {}
                try:
                    val = json_loads(val_str)
                except Exception:
                    val = val_str
                config[section][key] = val
            return config
        except Exception as e:
            logger.error(f"D1Storage: 加载配置失败: {e}")
            return None

    async def save_config(self, data: Dict[str, Any]):
        await self._ensure_schema()
        try:
            await self.db.execute("DELETE FROM app_config")
            params = []
            for section, items in data.items():
                if not isinstance(items, dict):
                    continue
                for key, val in items.items():
                    params.append((section, key, json_dumps(val)))
            if params:
                stmt = self.db.prepare(
                    "INSERT INTO app_config (section, key_name, value) VALUES (?1, ?2, ?3)"
                )
                for section, key, val in params:
                    await stmt.bind(section, key, val).run()
        except Exception as e:
            logger.error(f"D1Storage: 保存配置失败: {e}")
            raise StorageError(f"保存配置失败: {e}")

    async def load_tokens(self) -> Dict[str, Any]:
        await self._ensure_schema()
        try:
            result = await self.db.prepare(
                "SELECT token, pool_name, status, quota, created_at, last_used_at, "
                "use_count, fail_count, last_fail_at, last_fail_reason, last_sync_at, "
                "tags, note, last_asset_clear_at, data FROM tokens"
            ).all()
            rows = result.results if hasattr(result, "results") else result
            if not rows:
                return None
            pools: Dict[str, list] = {}
            for row in rows:
                pool_name = row.get("pool_name")
                if not pool_name:
                    continue
                pools.setdefault(pool_name, [])
                token_data: Dict[str, Any] = {}
                token_data["token"] = row.get("token")
                if row.get("status") is not None:
                    token_data["status"] = self._normalize_status(row.get("status"))
                for field in (
                    "quota",
                    "created_at",
                    "last_used_at",
                    "use_count",
                    "fail_count",
                    "last_fail_at",
                    "last_sync_at",
                    "last_asset_clear_at",
                ):
                    val = row.get(field)
                    if val is not None:
                        try:
                            token_data[field] = int(val)
                        except Exception:
                            token_data[field] = val
                if row.get("last_fail_reason") is not None:
                    token_data["last_fail_reason"] = row.get("last_fail_reason")
                tags = row.get("tags")
                if tags is not None:
                    token_data["tags"] = self._parse_tags(tags)
                if row.get("note") is not None:
                    token_data["note"] = row.get("note")
                legacy_data = row.get("data")
                if legacy_data:
                    try:
                        parsed = json_loads(legacy_data)
                        if isinstance(parsed, dict):
                            for key, val in parsed.items():
                                if key not in token_data or token_data[key] is None:
                                    token_data[key] = val
                    except Exception:
                        pass
                pools[pool_name].append(token_data)
            return pools
        except Exception as e:
            logger.error(f"D1Storage: 加载 Token 失败: {e}")
            return None

    async def save_tokens(self, data: Dict[str, Any]):
        await self._ensure_schema()
        if data is None:
            return
        try:
            await self.db.execute("DELETE FROM tokens")
            if not data:
                return
            stmt = self.db.prepare(
                "INSERT INTO tokens (token, pool_name, status, quota, created_at, "
                "last_used_at, use_count, fail_count, last_fail_at, last_fail_reason, "
                "last_sync_at, tags, note, last_asset_clear_at, data, data_hash, updated_at) "
                "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)"
            )
            for pool_name, tokens in data.items():
                if not isinstance(tokens, list):
                    continue
                for token_data in tokens:
                    if isinstance(token_data, dict):
                        payload = dict(token_data)
                    elif isinstance(token_data, str):
                        payload = {"token": token_data}
                    else:
                        continue
                    row = self._token_to_row(payload, pool_name)
                    if not row.get("token"):
                        continue
                    await stmt.bind(
                        row.get("token"),
                        row.get("pool_name"),
                        row.get("status"),
                        row.get("quota"),
                        row.get("created_at"),
                        row.get("last_used_at"),
                        row.get("use_count"),
                        row.get("fail_count"),
                        row.get("last_fail_at"),
                        row.get("last_fail_reason"),
                        row.get("last_sync_at"),
                        row.get("tags"),
                        row.get("note"),
                        row.get("last_asset_clear_at"),
                        row.get("data"),
                        row.get("data_hash"),
                        row.get("updated_at"),
                    ).run()
        except Exception as e:
            logger.error(f"D1Storage: 保存 Token 失败: {e}")
            raise StorageError(f"保存 Token 失败: {e}")

    async def save_tokens_delta(
        self, updated: list[Dict[str, Any]], deleted: Optional[list[str]] = None
    ):
        await self._ensure_schema()
        try:
            deleted_set = set(deleted or [])
            if deleted_set:
                stmt_delete = self.db.prepare("DELETE FROM tokens WHERE token = ?1")
                for token_str in deleted_set:
                    await stmt_delete.bind(token_str).run()

            if not updated:
                return

            stmt_upsert = self.db.prepare(
                "INSERT INTO tokens (token, pool_name, status, quota, created_at, "
                "last_used_at, use_count, fail_count, last_fail_at, last_fail_reason, "
                "last_sync_at, tags, note, last_asset_clear_at, data, data_hash, updated_at) "
                "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17) "
                "ON CONFLICT(token) DO UPDATE SET "
                "pool_name=excluded.pool_name, "
                "status=excluded.status, "
                "quota=excluded.quota, "
                "created_at=excluded.created_at, "
                "last_used_at=excluded.last_used_at, "
                "use_count=excluded.use_count, "
                "fail_count=excluded.fail_count, "
                "last_fail_at=excluded.last_fail_at, "
                "last_fail_reason=excluded.last_fail_reason, "
                "last_sync_at=excluded.last_sync_at, "
                "tags=excluded.tags, "
                "note=excluded.note, "
                "last_asset_clear_at=excluded.last_asset_clear_at, "
                "data=excluded.data, "
                "data_hash=excluded.data_hash, "
                "updated_at=excluded.updated_at"
            )
            for item in updated or []:
                if not isinstance(item, dict):
                    continue
                pool_name = item.get("pool_name")
                token_str = item.get("token")
                if not pool_name or not token_str:
                    continue
                if token_str in deleted_set:
                    continue
                token_data = {
                    k: v for k, v in item.items() if k not in ("pool_name", "_update_kind")
                }
                row = self._token_to_row(token_data, pool_name)
                if not row.get("token"):
                    continue
                await stmt_upsert.bind(
                    row.get("token"),
                    row.get("pool_name"),
                    row.get("status"),
                    row.get("quota"),
                    row.get("created_at"),
                    row.get("last_used_at"),
                    row.get("use_count"),
                    row.get("fail_count"),
                    row.get("last_fail_at"),
                    row.get("last_fail_reason"),
                    row.get("last_sync_at"),
                    row.get("tags"),
                    row.get("note"),
                    row.get("last_asset_clear_at"),
                    row.get("data"),
                    row.get("data_hash"),
                    row.get("updated_at"),
                ).run()
        except Exception as e:
            logger.error(f"D1Storage: 增量保存 Token 失败: {e}")
            raise StorageError(f"增量保存 Token 失败: {e}")

    async def close(self):
        return None


__all__ = ["D1Storage"]
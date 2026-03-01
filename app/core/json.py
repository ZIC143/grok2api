"""JSON helpers with orjson fast-path and stdlib fallback."""

from __future__ import annotations

from typing import Any

try:
    import orjson  # type: ignore

    def dumps(obj: Any, *, option: int | None = None) -> bytes:
        if option is None:
            return orjson.dumps(obj)
        return orjson.dumps(obj, option=option)

    def loads(data: str | bytes) -> Any:
        return orjson.loads(data)

    def dumps_str(obj: Any, *, option: int | None = None) -> str:
        return dumps(obj, option=option).decode("utf-8")

    def dumps_sorted(obj: Any) -> str:
        return orjson.dumps(obj, option=orjson.OPT_SORT_KEYS).decode("utf-8")

    def json_error() -> type[Exception]:
        return orjson.JSONDecodeError

    HAS_ORJSON = True

except Exception:  # pragma: no cover
    import json

    def dumps(obj: Any, *, option: int | None = None) -> bytes:
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    def loads(data: str | bytes) -> Any:
        if isinstance(data, (bytes, bytearray)):
            data = data.decode("utf-8")
        return json.loads(data)

    def dumps_str(obj: Any, *, option: int | None = None) -> str:
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))

    def dumps_sorted(obj: Any) -> str:
        return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    def json_error() -> type[Exception]:
        return json.JSONDecodeError

    HAS_ORJSON = False


__all__ = [
    "dumps",
    "loads",
    "dumps_str",
    "dumps_sorted",
    "json_error",
    "HAS_ORJSON",
]

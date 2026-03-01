"""Runtime helpers for Cloudflare Workers bindings and request scope."""

from __future__ import annotations

import os
from contextvars import ContextVar
from typing import Any, Optional


_ENV_VAR: ContextVar[Optional[Any]] = ContextVar("workers_env", default=None)


def set_env(env: Any):
    return _ENV_VAR.set(env)


def reset_env(token) -> None:
    _ENV_VAR.reset(token)


def get_env() -> Optional[Any]:
    return _ENV_VAR.get()


def _get_attr(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def get_binding(name: str) -> Any:
    env = get_env()
    if env is None:
        return None
    if isinstance(env, dict) and name in env:
        return env.get(name)
    if hasattr(env, name):
        return getattr(env, name)
    if hasattr(env, "__getitem__"):
        try:
            return env[name]
        except Exception:
            return None
    return None


def get_env_value(name: str, default: Any = None) -> Any:
    value = None
    env = get_env()
    if env is not None:
        value = _get_attr(env, name, None)
        if value is None and isinstance(env, dict):
            value = env.get(name)
    if value is None:
        value = os.getenv(name, default)
    return value if value is not None else default


def is_cloudflare() -> bool:
    platform = get_env_value("PLATFORM")
    return str(platform or "").strip().lower() == "cloudflare"


__all__ = [
    "set_env",
    "reset_env",
    "get_env",
    "get_binding",
    "get_env_value",
    "is_cloudflare",
    "_get_attr",
]

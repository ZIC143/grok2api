"""
Resettable session wrapper for reverse requests.
"""

import asyncio
from typing import Any, Iterable, Optional

from app.core.config import get_config
from app.core.logger import logger
from app.core.runtime import is_cloudflare
from app.core import json as jsonlib

try:
    from curl_cffi.requests import AsyncSession as CurlAsyncSession
    from curl_cffi.requests.errors import RequestsError as CurlRequestsError
except Exception:  # pragma: no cover - optional dependency
    CurlAsyncSession = None
    CurlRequestsError = None

try:
    import httpx
except Exception:  # pragma: no cover - optional dependency
    httpx = None

if CurlAsyncSession is None:
    from typing import Any as AsyncSession
else:
    AsyncSession = CurlAsyncSession

RequestsError = CurlRequestsError or Exception


class HttpxResponseAdapter:
    def __init__(self, response: Any):
        self._response = response

    @property
    def status_code(self) -> int:
        return self._response.status_code

    @property
    def headers(self):
        return self._response.headers

    @property
    def content(self) -> bytes:
        return self._response.content

    async def text(self) -> str:
        if getattr(self._response, "is_stream_consumed", False):
            return self._response.text
        try:
            data = await self._response.aread()
            try:
                return data.decode("utf-8")
            except Exception:
                return self._response.text
        except Exception:
            return self._response.text

    def json(self):
        try:
            return self._response.json()
        except Exception:
            try:
                return jsonlib.loads(self._response.content)
            except Exception:
                return None

    async def aiter_content(self):
        async for chunk in self._response.aiter_bytes():
            yield chunk

    async def aiter_lines(self):
        async for line in self._response.aiter_lines():
            yield line

    async def close(self) -> None:
        try:
            await self._response.aclose()
        except Exception:
            pass


class HttpxSession:
    def __init__(self, **session_kwargs: Any) -> None:
        if httpx is None:
            raise RuntimeError("httpx is required for Cloudflare fallback")
        self._session_kwargs = dict(session_kwargs)
        self._client = httpx.AsyncClient()

    def _strip_kwargs(self, kwargs: dict) -> dict:
        cleaned = dict(kwargs)
        cleaned.pop("impersonate", None)
        cleaned.pop("proxy", None)
        cleaned.pop("proxies", None)
        allow_redirects = cleaned.pop("allow_redirects", None)
        if allow_redirects is not None:
            cleaned["follow_redirects"] = allow_redirects
        stream = cleaned.pop("stream", None)
        if stream is not None:
            cleaned["stream"] = bool(stream)
        return cleaned

    async def _request(self, method: str, *args: Any, **kwargs: Any):
        cleaned = self._strip_kwargs(kwargs)
        response = await self._client.request(method, *args, **cleaned)
        return HttpxResponseAdapter(response)

    async def get(self, *args: Any, **kwargs: Any):
        return await self._request("GET", *args, **kwargs)

    async def post(self, *args: Any, **kwargs: Any):
        return await self._request("POST", *args, **kwargs)

    async def delete(self, *args: Any, **kwargs: Any):
        return await self._request("DELETE", *args, **kwargs)

    async def close(self) -> None:
        try:
            await self._client.aclose()
        except Exception:
            pass


class ResettableSession:
    """AsyncSession wrapper that resets connection on specific HTTP status codes."""

    def __init__(
        self,
        *,
        reset_on_status: Optional[Iterable[int]] = None,
        **session_kwargs: Any,
    ):
        self._session_kwargs = dict(session_kwargs)
        if not self._session_kwargs.get("impersonate"):
            browser = get_config("proxy.browser")
            if browser:
                self._session_kwargs["impersonate"] = browser
        if reset_on_status is None:
            reset_on_status = [403]
        if isinstance(reset_on_status, int):
            reset_on_status = [reset_on_status]
        self._reset_on_status = (
            {int(code) for code in reset_on_status} if reset_on_status else set()
        )
        self._reset_requested = False
        self._reset_lock = asyncio.Lock()
        if is_cloudflare() and httpx is not None:
            self._session = HttpxSession(**self._session_kwargs)
        else:
            if CurlAsyncSession is None:
                raise RuntimeError("curl_cffi is not available")
            self._session = CurlAsyncSession(**self._session_kwargs)

    async def _maybe_reset(self) -> None:
        if not self._reset_requested:
            return
        async with self._reset_lock:
            if not self._reset_requested:
                return
            self._reset_requested = False
            old_session = self._session
            if is_cloudflare() and httpx is not None:
                self._session = HttpxSession(**self._session_kwargs)
            else:
                if CurlAsyncSession is None:
                    raise RuntimeError("curl_cffi is not available")
                self._session = CurlAsyncSession(**self._session_kwargs)
            try:
                await old_session.close()
            except Exception:
                pass
            logger.debug("ResettableSession: session reset")

    async def _request(self, method: str, *args: Any, **kwargs: Any):
        await self._maybe_reset()
        response = await getattr(self._session, method)(*args, **kwargs)
        if self._reset_on_status and response.status_code in self._reset_on_status:
            self._reset_requested = True
        return response

    async def get(self, *args: Any, **kwargs: Any):
        return await self._request("get", *args, **kwargs)

    async def post(self, *args: Any, **kwargs: Any):
        return await self._request("post", *args, **kwargs)

    async def reset(self) -> None:
        self._reset_requested = True
        await self._maybe_reset()

    async def close(self) -> None:
        if self._session is None:
            return
        try:
            await self._session.close()
        finally:
            self._session = None
            self._reset_requested = False

    async def __aenter__(self) -> "ResettableSession":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._session, name)


__all__ = ["ResettableSession", "RequestsError"]

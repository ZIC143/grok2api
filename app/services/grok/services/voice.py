"""
Grok Voice Mode Service
"""

from typing import Any, Dict

from app.core.config import get_config
from app.services.reverse.ws_livekit import LivekitTokenReverse
from app.core.runtime import is_cloudflare
from app.core.exceptions import AppException, ErrorType
from app.services.reverse.utils.session import ResettableSession


class VoiceService:
    """Voice Mode Service (LiveKit)"""

    async def get_token(
        self,
        token: str,
        voice: str = "ara",
        personality: str = "assistant",
        speed: float = 1.0,
    ) -> Dict[str, Any]:
        if is_cloudflare():
            raise AppException(
                message="Voice WebSocket is not supported on Cloudflare Workers",
                error_type=ErrorType.SERVER.value,
                code="ws_not_supported",
                status_code=501,
            )
        browser = get_config("proxy.browser")
        async with ResettableSession(impersonate=browser) as session:
            response = await LivekitTokenReverse.request(
                session,
                token=token,
                voice=voice,
                personality=personality,
                speed=speed,
            )
            return response.json()

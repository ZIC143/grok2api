"""
文件服务 API 路由
"""

import aiofiles.os
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from app.core.logger import logger
from app.core.storage import DATA_DIR
from app.core.runtime import is_cloudflare
from app.services.grok.utils.cache_kv import CacheServiceKV
from app.services.grok.utils.download_r2 import R2DownloadService

router = APIRouter(tags=["Files"])

# 缓存根目录
BASE_DIR = DATA_DIR / "tmp"
IMAGE_DIR = BASE_DIR / "image"
VIDEO_DIR = BASE_DIR / "video"


@router.get("/image/{filename:path}")
async def get_image(filename: str):
    """
    获取图片文件
    """
    if is_cloudflare():
        name = filename.replace("/", "-")
        kv = CacheServiceKV()
        item = await kv.get_item("image", name)
        if item:
            return Response(
                content=item["content"],
                media_type=item["content_type"],
                headers={"Cache-Control": "public, max-age=31536000, immutable"},
            )
        r2 = R2DownloadService()
        cached = await r2.get_cached("image", f"/{filename}")
        if cached:
            return Response(
                content=cached["content"],
                media_type=cached["content_type"],
                headers={"Cache-Control": "public, max-age=31536000, immutable"},
            )
        logger.warning(f"Image not found: {filename}")
        raise HTTPException(status_code=404, detail="Image not found")
    if "/" in filename:
        filename = filename.replace("/", "-")

    file_path = IMAGE_DIR / filename

    if await aiofiles.os.path.exists(file_path):
        if await aiofiles.os.path.isfile(file_path):
            content_type = "image/jpeg"
            if file_path.suffix.lower() == ".png":
                content_type = "image/png"
            elif file_path.suffix.lower() == ".webp":
                content_type = "image/webp"

            # 增加缓存头，支持高并发场景下的浏览器/CDN缓存
            return FileResponse(
                file_path,
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=31536000, immutable"},
            )

    logger.warning(f"Image not found: {filename}")
    raise HTTPException(status_code=404, detail="Image not found")


@router.get("/video/{filename:path}")
async def get_video(filename: str):
    """
    获取视频文件
    """
    if is_cloudflare():
        name = filename.replace("/", "-")
        kv = CacheServiceKV()
        item = await kv.get_item("video", name)
        if item:
            return Response(
                content=item["content"],
                media_type=item["content_type"],
                headers={"Cache-Control": "public, max-age=31536000, immutable"},
            )
        r2 = R2DownloadService()
        cached = await r2.get_cached("video", f"/{filename}")
        if cached:
            return Response(
                content=cached["content"],
                media_type=cached["content_type"],
                headers={"Cache-Control": "public, max-age=31536000, immutable"},
            )
        logger.warning(f"Video not found: {filename}")
        raise HTTPException(status_code=404, detail="Video not found")
    if "/" in filename:
        filename = filename.replace("/", "-")

    file_path = VIDEO_DIR / filename

    if await aiofiles.os.path.exists(file_path):
        if await aiofiles.os.path.isfile(file_path):
            return FileResponse(
                file_path,
                media_type="video/mp4",
                headers={"Cache-Control": "public, max-age=31536000, immutable"},
            )

    logger.warning(f"Video not found: {filename}")
    raise HTTPException(status_code=404, detail="Video not found")

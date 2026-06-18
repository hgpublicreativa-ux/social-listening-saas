import hashlib
from redis.asyncio import Redis

DEDUP_TTL_SECONDS = 7 * 86400  # 7 days


async def is_duplicate(redis: Redis, platform: str, post_id: str) -> bool:
    key = f"dedup:{platform}:{post_id}"
    added = await redis.set(key, 1, nx=True, ex=DEDUP_TTL_SECONDS)
    return added is None


async def is_content_duplicate(redis: Redis, text: str) -> bool:
    """Catch reposts with slightly different IDs but identical text."""
    content_hash = hashlib.sha256(text.strip().encode()).hexdigest()[:16]
    key = f"dedup:content:{content_hash}"
    added = await redis.set(key, 1, nx=True, ex=3600)  # 1h window
    return added is None

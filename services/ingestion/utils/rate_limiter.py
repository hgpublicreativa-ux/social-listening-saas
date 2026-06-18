import asyncio
import time
from redis.asyncio import Redis


class RateLimiter:
    """Token-bucket rate limiter backed by Redis for distributed workers."""

    def __init__(self, redis: Redis, key: str, rate: float, capacity: float):
        self.redis    = redis
        self.key      = f"ratelimit:{key}"
        self.rate     = rate      # tokens added per second
        self.capacity = capacity  # max tokens

    async def acquire(self, tokens: float = 1.0) -> float:
        now = time.monotonic()
        pipe = self.redis.pipeline()
        await pipe.hgetall(self.key)
        result = await pipe.execute()
        bucket = result[0]

        if bucket:
            stored_tokens    = float(bucket.get("tokens", self.capacity))
            last_refill      = float(bucket.get("last", now))
            elapsed          = now - last_refill
            stored_tokens    = min(self.capacity, stored_tokens + elapsed * self.rate)
        else:
            stored_tokens = self.capacity
            last_refill   = now

        if stored_tokens >= tokens:
            stored_tokens -= tokens
            wait = 0.0
        else:
            wait = (tokens - stored_tokens) / self.rate
            stored_tokens = 0

        await self.redis.hset(self.key, mapping={"tokens": stored_tokens, "last": now})
        await self.redis.expire(self.key, 3600)

        if wait > 0:
            await asyncio.sleep(wait)

        return wait

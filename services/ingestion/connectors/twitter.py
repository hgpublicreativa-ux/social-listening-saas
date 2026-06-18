import os
import json
import asyncio
import logging

import httpx
from aiokafka import AIOKafkaProducer
from redis.asyncio import Redis
from tenacity import retry, wait_exponential, stop_after_attempt

from utils.dedup import is_duplicate
from utils.normalizer import normalize_twitter, make_envelope
from utils.rate_limiter import RateLimiter

log = logging.getLogger("ingestion.twitter")

BEARER = os.getenv("TWITTER_BEARER_TOKEN", "")
STREAM_URL = (
    "https://api.twitter.com/2/tweets/search/stream"
    "?tweet.fields=created_at,author_id,public_metrics,lang,geo"
    "&expansions=author_id"
    "&user.fields=username,name,public_metrics,verified"
)
RULES_URL = "https://api.twitter.com/2/tweets/search/stream/rules"
HEADERS   = {"Authorization": f"Bearer {BEARER}"}


class TwitterConnector:
    def __init__(self, producer: AIOKafkaProducer, redis: Redis, project_id: str, keywords: list[str]):
        self.producer   = producer
        self.redis      = redis
        self.project_id = project_id
        self.keywords   = keywords
        self.limiter    = RateLimiter(redis, "twitter:stream", rate=1, capacity=5)

    async def _sync_rules(self):
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(RULES_URL, headers=HEADERS)
            existing = r.json().get("data", [])
            if existing:
                ids = [rule["id"] for rule in existing]
                await client.post(RULES_URL, headers=HEADERS, json={"delete": {"ids": ids}})

            new_rules = [
                {"value": f'"{kw}" lang:es', "tag": kw}
                for kw in self.keywords
            ]
            r = await client.post(RULES_URL, headers=HEADERS, json={"add": new_rules})
            r.raise_for_status()
            log.info("Twitter stream rules set: %s", [kw for kw in self.keywords])

    @retry(wait=wait_exponential(min=5, max=60), stop=stop_after_attempt(10))
    async def run(self):
        if not BEARER:
            log.warning("TWITTER_BEARER_TOKEN not set — skipping Twitter connector")
            return

        await self._sync_rules()

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("GET", STREAM_URL, headers=HEADERS) as resp:
                if resp.status_code != 200:
                    log.error("Twitter stream HTTP %d", resp.status_code)
                    return

                log.info("Twitter filtered stream connected")
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    tweet_id = data.get("data", {}).get("id")
                    if not tweet_id:
                        continue

                    if await is_duplicate(self.redis, "twitter", tweet_id):
                        continue

                    normalized = normalize_twitter(data, self.project_id)
                    envelope   = make_envelope("twitter", normalized, self.project_id)

                    await self.producer.send(
                        "raw-mentions",
                        value=envelope,
                        key=self.project_id.encode(),
                    )

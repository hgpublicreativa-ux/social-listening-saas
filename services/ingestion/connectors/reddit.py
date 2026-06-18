import asyncio
import logging
from datetime import datetime, timezone

import httpx
from streams import StreamProducer
from redis.asyncio import Redis

from utils.dedup import is_duplicate, is_content_duplicate
from utils.normalizer import make_envelope

log = logging.getLogger("ingestion.reddit")

# Reddit's public JSON search — no auth required for read-only public listings.
SEARCH_URL   = "https://www.reddit.com/search.json"
POLL_SECONDS = 300  # 5 minutes
HEADERS      = {"User-Agent": "SocialListenerBot/1.0 (by /u/sociallistener)"}


class RedditConnector:
    def __init__(self, producer: StreamProducer, redis: Redis, project_id: str, keywords: list[str]):
        self.producer   = producer
        self.redis      = redis
        self.project_id = project_id
        self.keywords   = keywords

    async def _fetch(self, client: httpx.AsyncClient, keyword: str) -> list[dict]:
        r = await client.get(SEARCH_URL, params={
            "q":     keyword,
            "sort":  "new",
            "limit": 50,
            "t":     "week",
        })
        r.raise_for_status()
        children = r.json().get("data", {}).get("children", [])
        return [c.get("data", {}) for c in children]

    async def run(self):
        log.info("Reddit connector started, polling every %ds", POLL_SECONDS)
        async with httpx.AsyncClient(timeout=30, headers=HEADERS, follow_redirects=True) as client:
            while True:
                for keyword in self.keywords:
                    try:
                        posts     = await self._fetch(client, keyword)
                        new_count = 0

                        for post in posts:
                            post_id = post.get("id")
                            if not post_id:
                                continue
                            if await is_duplicate(self.redis, "reddit", post_id):
                                continue

                            title = post.get("title", "")
                            body  = post.get("selftext", "") or ""
                            text  = f"{title} {body}".strip()

                            if await is_content_duplicate(self.redis, text):
                                continue

                            created = post.get("created_utc")
                            pub_dt  = (
                                datetime.fromtimestamp(created, tz=timezone.utc).isoformat()
                                if created else datetime.now(timezone.utc).isoformat()
                            )

                            normalized = {
                                "platform":         "reddit",
                                "project_id":       self.project_id,
                                "platform_post_id": post_id,
                                "content_text":     text[:2000],
                                "content_url":      "https://www.reddit.com" + post.get("permalink", ""),
                                "source_domain":    "reddit.com/r/" + post.get("subreddit", ""),
                                "published_at":     pub_dt,
                                "language":         "es",
                                "author": {
                                    "username":     post.get("author"),
                                    "display_name": post.get("author"),
                                    "followers":    0,
                                    "verified":     False,
                                },
                                "metrics": {
                                    "likes":    int(post.get("score", 0)),
                                    "shares":   0,
                                    "comments": int(post.get("num_comments", 0)),
                                    "views":    0,
                                },
                            }
                            envelope = make_envelope("reddit", normalized, self.project_id)
                            await self.producer.send(
                                "raw-mentions",
                                value=envelope,
                                key=self.project_id.encode(),
                            )
                            new_count += 1

                        log.info("Reddit [%s]: %d new posts", keyword, new_count)

                    except httpx.HTTPStatusError as exc:
                        log.warning("Reddit API error for [%s]: %s", keyword, exc)
                    except Exception as exc:
                        log.warning("Reddit error for [%s]: %s", keyword, exc)

                    await asyncio.sleep(2)

                await asyncio.sleep(POLL_SECONDS)

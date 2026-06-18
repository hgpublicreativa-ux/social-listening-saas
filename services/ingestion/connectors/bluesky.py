import asyncio
import logging
from datetime import datetime, timezone

import httpx

from streams import StreamProducer
from redis.asyncio import Redis
from utils.dedup import is_duplicate, is_content_duplicate
from utils.normalizer import make_envelope

log = logging.getLogger("ingestion.bluesky")

POLL_SECONDS = 900  # 15 min
SEARCH_URL   = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts"


class BlueskyConnector:
    """
    Searches Bluesky posts via the public AppView API — no auth required.
    Growing Latin American community; good for political/news keywords.
    """

    def __init__(self, producer: StreamProducer, redis: Redis, project_id: str, keywords: list[str]):
        self.producer   = producer
        self.redis      = redis
        self.project_id = project_id
        self.keywords   = keywords

    async def _search(self, client: httpx.AsyncClient, keyword: str) -> list[dict]:
        r = await client.get(SEARCH_URL, params={"q": keyword, "limit": 25, "lang": "es"}, timeout=20)
        if r.status_code == 404:
            return []
        r.raise_for_status()
        return r.json().get("posts", [])

    async def run(self):
        log.info("Bluesky connector started for project %s", self.project_id)
        async with httpx.AsyncClient(
            headers={"User-Agent": "SocialMonitor/1.0"},
        ) as client:
            while True:
                new_total = 0
                for kw in self.keywords:
                    try:
                        posts = await self._search(client, kw)
                        for post in posts:
                            uri    = post.get("uri", "")
                            record = post.get("record", {})
                            text   = record.get("text", "")

                            if not uri or not text.strip():
                                continue
                            if await is_duplicate(self.redis, "bluesky", uri):
                                continue
                            if await is_content_duplicate(self.redis, text):
                                continue

                            created_at = record.get("createdAt", "")
                            try:
                                pub_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00")).isoformat() if created_at else datetime.now(timezone.utc).isoformat()
                            except Exception:
                                pub_dt = datetime.now(timezone.utc).isoformat()

                            author   = post.get("author", {})
                            handle   = author.get("handle", "")
                            name     = author.get("displayName") or handle
                            likes    = post.get("likeCount", 0) or 0
                            reposts  = post.get("repostCount", 0) or 0
                            replies  = post.get("replyCount", 0) or 0
                            cid      = post.get("cid", "")

                            # Build URL from DID + rkey
                            post_url = f"https://bsky.app/profile/{handle}/post/{uri.split('/')[-1]}" if handle else ""

                            normalized = {
                                "platform":         "bluesky",
                                "project_id":       self.project_id,
                                "platform_post_id": uri,
                                "content_text":     text[:2000],
                                "content_url":      post_url,
                                "source_domain":    "bsky.app",
                                "published_at":     pub_dt,
                                "language":         "es",
                                "author": {
                                    "platform_id":  author.get("did", ""),
                                    "display_name": name,
                                    "followers":    0,
                                    "verified":     author.get("labels") is not None,
                                },
                                "metrics": {
                                    "likes":    int(likes),
                                    "shares":   int(reposts),
                                    "comments": int(replies),
                                    "views":    0,
                                },
                            }
                            envelope = make_envelope("bluesky", normalized, self.project_id)
                            await self.producer.send("raw-mentions", value=envelope, key=self.project_id.encode())
                            new_total += 1

                        await asyncio.sleep(1)
                    except httpx.HTTPStatusError as exc:
                        log.warning("Bluesky HTTP error for keyword '%s': %s", kw, exc)
                    except Exception as exc:
                        log.warning("Bluesky error for keyword '%s': %s", kw, exc)

                log.info("Bluesky [project %s]: %d new posts", self.project_id, new_total)
                await asyncio.sleep(POLL_SECONDS)

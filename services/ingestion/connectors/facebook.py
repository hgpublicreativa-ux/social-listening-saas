import os
import asyncio
import logging
from datetime import datetime, timezone

import httpx
from streams import StreamProducer
from redis.asyncio import Redis

from utils.dedup import is_duplicate, is_content_duplicate
from utils.normalizer import make_envelope

log = logging.getLogger("ingestion.facebook")

# Facebook has no global keyword search (Meta removed it; CrowdTangle shut down).
# This connector reads recent posts from a fixed set of public Pages you specify
# and filters them by the project keywords. Requires a Page/User access token with
# access to those pages (page_public_content_access for pages you don't own).
ACCESS_TOKEN = os.getenv("FACEBOOK_ACCESS_TOKEN", "")
PAGE_IDS     = [p.strip() for p in os.getenv("FACEBOOK_PAGE_IDS", "").split(",") if p.strip()]
GRAPH        = "https://graph.facebook.com/v21.0"
POLL_SECONDS = 600  # 10 minutes
FIELDS       = "id,message,story,created_time,permalink_url,from{id,name},shares,reactions.summary(true),comments.summary(true)"


class FacebookConnector:
    def __init__(self, producer: StreamProducer, redis: Redis, project_id: str, keywords: list[str]):
        self.producer   = producer
        self.redis      = redis
        self.project_id = project_id
        self.keywords   = [kw.lower() for kw in keywords]

    def _matches(self, text: str) -> bool:
        t = text.lower()
        return any(kw in t for kw in self.keywords)

    async def _fetch_page(self, client: httpx.AsyncClient, page_id: str) -> list[dict]:
        r = await client.get(
            f"{GRAPH}/{page_id}/posts",
            params={"fields": FIELDS, "limit": 50, "access_token": ACCESS_TOKEN},
        )
        r.raise_for_status()
        return r.json().get("data", [])

    async def run(self):
        if not ACCESS_TOKEN or not PAGE_IDS:
            log.warning("FACEBOOK_ACCESS_TOKEN/PAGE_IDS not set — skipping Facebook connector")
            return

        log.info("Facebook connector started, %d pages, polling every %ds", len(PAGE_IDS), POLL_SECONDS)
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                for page_id in PAGE_IDS:
                    try:
                        posts     = await self._fetch_page(client, page_id)
                        new_count = 0

                        for post in posts:
                            post_id = post.get("id")
                            text    = post.get("message") or post.get("story") or ""
                            if not post_id or not text.strip():
                                continue
                            if not self._matches(text):
                                continue
                            if await is_duplicate(self.redis, "facebook", post_id):
                                continue
                            if await is_content_duplicate(self.redis, text):
                                continue

                            created = post.get("created_time")
                            try:
                                pub_dt = datetime.fromisoformat(created.replace("Z", "+00:00")).isoformat() if created else datetime.now(timezone.utc).isoformat()
                            except (ValueError, AttributeError):
                                pub_dt = datetime.now(timezone.utc).isoformat()

                            frm        = post.get("from", {}) or {}
                            reactions  = (post.get("reactions", {}) or {}).get("summary", {}).get("total_count", 0)
                            comments   = (post.get("comments", {}) or {}).get("summary", {}).get("total_count", 0)
                            shares     = (post.get("shares", {}) or {}).get("count", 0)

                            normalized = {
                                "platform":         "facebook",
                                "project_id":       self.project_id,
                                "platform_post_id": post_id,
                                "content_text":     text[:2000],
                                "content_url":      post.get("permalink_url", ""),
                                "source_domain":    "facebook.com",
                                "published_at":     pub_dt,
                                "language":         "es",
                                "author": {
                                    "platform_id":  frm.get("id"),
                                    "display_name": frm.get("name"),
                                    "followers":    0,
                                    "verified":     False,
                                },
                                "metrics": {
                                    "likes":    int(reactions),
                                    "shares":   int(shares),
                                    "comments": int(comments),
                                    "views":    0,
                                },
                            }
                            envelope = make_envelope("facebook", normalized, self.project_id)
                            await self.producer.send(
                                "raw-mentions",
                                value=envelope,
                                key=self.project_id.encode(),
                            )
                            new_count += 1

                        log.info("Facebook [page %s]: %d new posts", page_id, new_count)

                    except httpx.HTTPStatusError as exc:
                        code = exc.response.status_code
                        body = exc.response.text[:200]
                        if code in (400, 401, 403):
                            log.error("Facebook auth/permission error (HTTP %d) for page %s: %s", code, page_id, body)
                        else:
                            log.warning("Facebook API error for page %s: %s", page_id, exc)
                    except Exception as exc:
                        log.warning("Facebook error for page %s: %s", page_id, exc)

                    await asyncio.sleep(2)

                await asyncio.sleep(POLL_SECONDS)

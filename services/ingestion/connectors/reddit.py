import os
import asyncio
import base64
import logging
from datetime import datetime, timezone

import httpx
from streams import StreamProducer
from redis.asyncio import Redis

from utils.dedup import is_duplicate, is_content_duplicate
from utils.normalizer import make_envelope

log = logging.getLogger("ingestion.reddit")

# Reddit's public JSON endpoint now 403s datacenter IPs, so we use the free
# OAuth app-only flow (register a "web app" at reddit.com/prefs/apps).
CLIENT_ID     = os.getenv("REDDIT_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET", "")
TOKEN_URL     = "https://www.reddit.com/api/v1/access_token"
SEARCH_URL    = "https://oauth.reddit.com/search"
POLL_SECONDS  = 300  # 5 minutes
USER_AGENT    = "SocialListenerBot/1.0 by social-listening-saas"


class RedditConnector:
    def __init__(self, producer: StreamProducer, redis: Redis, project_id: str, keywords: list[str]):
        self.producer   = producer
        self.redis      = redis
        self.project_id = project_id
        self.keywords   = keywords
        self._token     = None
        self._token_exp = 0.0

    async def _get_token(self, client: httpx.AsyncClient) -> str | None:
        now = asyncio.get_event_loop().time()
        if self._token and now < self._token_exp - 60:
            return self._token

        basic = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
        r = await client.post(
            TOKEN_URL,
            data={"grant_type": "client_credentials"},
            headers={"Authorization": f"Basic {basic}", "User-Agent": USER_AGENT},
        )
        r.raise_for_status()
        data = r.json()
        self._token     = data["access_token"]
        self._token_exp = now + data.get("expires_in", 3600)
        return self._token

    async def _fetch(self, client: httpx.AsyncClient, keyword: str) -> list[dict]:
        token = await self._get_token(client)
        r = await client.get(
            SEARCH_URL,
            params={"q": keyword, "sort": "new", "limit": 50, "t": "week"},
            headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT},
        )
        r.raise_for_status()
        children = r.json().get("data", {}).get("children", [])
        return [c.get("data", {}) for c in children]

    async def run(self):
        if not CLIENT_ID or not CLIENT_SECRET:
            log.warning("REDDIT_CLIENT_ID/SECRET not set — skipping Reddit connector")
            return

        log.info("Reddit connector started, polling every %ds", POLL_SECONDS)
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
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
                        code = exc.response.status_code
                        if code in (401, 403):
                            log.error("Reddit auth failed (HTTP %d) — check REDDIT_CLIENT_ID/SECRET", code)
                            return
                        log.warning("Reddit API error for [%s]: %s", keyword, exc)
                    except Exception as exc:
                        log.warning("Reddit error for [%s]: %s", keyword, exc)

                    await asyncio.sleep(2)

                await asyncio.sleep(POLL_SECONDS)

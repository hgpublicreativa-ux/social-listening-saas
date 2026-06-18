import asyncio
import logging
from datetime import datetime, timezone

import feedparser
import httpx

from streams import StreamProducer
from redis.asyncio import Redis
from utils.dedup import is_duplicate, is_content_duplicate
from utils.normalizer import make_envelope

log = logging.getLogger("ingestion.gnews")

POLL_SECONDS = 1800  # 30 min — news updates slower than social
BASE_URL = "https://news.google.com/rss/search"


class GoogleNewsConnector:
    """
    Fetches Google News RSS dynamically per keyword.
    No API key required. Uses ?q=KEYWORD&hl=es&gl=EC&ceid=EC:es for Spanish/Ecuador results.
    """

    def __init__(self, producer: StreamProducer, redis: Redis, project_id: str, keywords: list[str]):
        self.producer   = producer
        self.redis      = redis
        self.project_id = project_id
        self.keywords   = keywords

    async def _fetch_keyword(self, client: httpx.AsyncClient, keyword: str) -> list[dict]:
        params = {"q": keyword, "hl": "es", "gl": "EC", "ceid": "EC:es"}
        r = await client.get(BASE_URL, params=params, timeout=20)
        r.raise_for_status()
        feed = feedparser.parse(r.content)
        return feed.entries

    async def run(self):
        log.info("Google News connector started for project %s, %d keywords", self.project_id, len(self.keywords))
        async with httpx.AsyncClient(
            headers={"User-Agent": "Mozilla/5.0 (compatible; SocialMonitor/1.0)"},
            follow_redirects=True,
        ) as client:
            while True:
                new_total = 0
                for kw in self.keywords:
                    try:
                        entries = await self._fetch_keyword(client, kw)
                        for entry in entries:
                            post_id = entry.get("id") or entry.get("link", "")
                            text    = entry.get("title", "") + " " + entry.get("summary", "")
                            url     = entry.get("link", "")

                            if not post_id or not text.strip():
                                continue
                            if await is_duplicate(self.redis, "gnews", post_id):
                                continue
                            if await is_content_duplicate(self.redis, text):
                                continue

                            published_raw = entry.get("published", "")
                            try:
                                pub_dt = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat() if entry.get("published_parsed") else datetime.now(timezone.utc).isoformat()
                            except Exception:
                                pub_dt = datetime.now(timezone.utc).isoformat()

                            source = entry.get("source", {})
                            source_name = source.get("title", "Google News") if isinstance(source, dict) else "Google News"

                            normalized = {
                                "platform":         "web",
                                "project_id":       self.project_id,
                                "platform_post_id": post_id,
                                "content_text":     text[:2000],
                                "content_url":      url,
                                "source_domain":    "news.google.com",
                                "published_at":     pub_dt,
                                "language":         "es",
                                "author": {
                                    "platform_id":  source_name,
                                    "display_name": source_name,
                                    "followers":    0,
                                    "verified":     False,
                                },
                                "metrics": {"likes": 0, "shares": 0, "comments": 0, "views": 0},
                            }
                            envelope = make_envelope("web", normalized, self.project_id)
                            await self.producer.send("raw-mentions", value=envelope, key=self.project_id.encode())
                            new_total += 1

                        await asyncio.sleep(1)  # small pause between keywords
                    except Exception as exc:
                        log.warning("Google News error for keyword '%s': %s", kw, exc)

                log.info("Google News [project %s]: %d new articles", self.project_id, new_total)
                await asyncio.sleep(POLL_SECONDS)

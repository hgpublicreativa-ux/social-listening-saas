"""
Ecuadorian media monitor: fetches articles matching project keywords
from a curated list of news sites via Google News site: search.
Runs alongside other connectors, no extra API keys needed.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone

import feedparser
import httpx

from streams import StreamProducer
from redis.asyncio import Redis
from utils.dedup import is_duplicate, is_content_duplicate
from utils.normalizer import make_envelope

log = logging.getLogger("ingestion.media")

POLL_SECONDS = 1800  # 30 min

# Default media domains — override via MEDIA_DOMAINS env var (comma-separated)
DEFAULT_DOMAINS = [
    "ecuavisa.com",
    "teleamazonas.com",
    "extra.ec",
    "primicias.ec",
    "elcomercio.com",
    "eluniverso.com",
]

GNEWS_URL = "https://news.google.com/rss/search"
HEADERS   = {"User-Agent": "Mozilla/5.0 (compatible; SocialMonitor/1.0)"}


def get_domains() -> list[str]:
    env = os.getenv("MEDIA_DOMAINS", "")
    if env.strip():
        return [d.strip() for d in env.split(",") if d.strip()]
    return DEFAULT_DOMAINS


class MediaConnector:
    """
    Monitors Ecuadorian news sites for articles matching project keywords.
    Uses Google News RSS with site: operator → keyword-filtered results per domain.
    """

    def __init__(self, producer: StreamProducer, redis: Redis, project_id: str, keywords: list[str]):
        self.producer   = producer
        self.redis      = redis
        self.project_id = project_id
        self.keywords   = keywords
        self.domains    = get_domains()

    async def _fetch(self, client: httpx.AsyncClient, keyword: str, domain: str) -> list[dict]:
        params = {
            "q":    f"{keyword} site:{domain}",
            "hl":   "es",
            "gl":   "EC",
            "ceid": "EC:es",
        }
        try:
            r = await client.get(GNEWS_URL, params=params, timeout=15)
            r.raise_for_status()
            feed = feedparser.parse(r.text)
            return feed.entries
        except Exception as exc:
            log.warning("Media fetch error [%s / %s]: %s", domain, keyword, exc)
            return []

    async def run(self):
        log.info(
            "Media connector started — project %s, %d domains, %d keywords",
            self.project_id, len(self.domains), len(self.keywords),
        )
        async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
            while True:
                new_total = 0
                for keyword in self.keywords:
                    for domain in self.domains:
                        entries = await self._fetch(client, keyword, domain)
                        for entry in entries:
                            post_id = entry.get("id") or entry.get("link", "")
                            title   = entry.get("title", "")
                            summary = entry.get("summary", "")
                            text    = f"{title} {summary}".strip()
                            url     = entry.get("link", "")

                            if not post_id or not text:
                                continue
                            if await is_duplicate(self.redis, "media", post_id):
                                continue
                            if await is_content_duplicate(self.redis, text):
                                continue

                            try:
                                pub_dt = (
                                    datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat()
                                    if entry.get("published_parsed")
                                    else datetime.now(timezone.utc).isoformat()
                                )
                            except Exception:
                                pub_dt = datetime.now(timezone.utc).isoformat()

                            src = entry.get("source", {})
                            src_name = src.get("title", domain) if isinstance(src, dict) else domain

                            normalized = {
                                "platform":         "media",
                                "project_id":       self.project_id,
                                "platform_post_id": post_id,
                                "content_text":     text[:2000],
                                "content_url":      url,
                                "source_domain":    domain,
                                "published_at":     pub_dt,
                                "language":         "es",
                                "author": {
                                    "platform_id":  domain,
                                    "display_name": src_name,
                                    "followers":    0,
                                    "verified":     True,
                                },
                                "metrics": {"likes": 0, "shares": 0, "comments": 0, "views": 0},
                            }
                            envelope = make_envelope("media", normalized, self.project_id)
                            await self.producer.send(
                                "raw-mentions", value=envelope, key=self.project_id.encode()
                            )
                            new_total += 1

                        await asyncio.sleep(0.5)  # small pause between requests

                log.info("Media [project %s]: %d new articles", self.project_id, new_total)
                await asyncio.sleep(POLL_SECONDS)

import asyncio
import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

import feedparser
import httpx
from streams import StreamProducer
from redis.asyncio import Redis

from utils.dedup import is_duplicate, is_content_duplicate
from utils.normalizer import make_envelope

log = logging.getLogger("ingestion.scraper")

POLL_SECONDS = 600  # 10 minutes

RSS_FEEDS = [
    # Noticias internacionales
    "https://feeds.bbci.co.uk/mundo/rss.xml",
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml",
    "https://feeds.reuters.com/reuters/topNews",
    "https://www.theguardian.com/world/rss",
    # Latinoamérica / Ecuador / política
    "https://www.elcomercio.com/feed",
    "https://www.extra.ec/feed",
    "https://www.primicias.ec/feed/",
    "https://www.infobae.com/feeds/rss/",
    "https://www.clarin.com/rss/mundo/",
    "https://www.larepublica.ec/feed/",
    "https://www.telegrafo.com.ec/feed/",
    # Deportes
    "https://www.espn.com/espn/rss/news",
    "https://www.marca.com/rss/portada.xml",
    "https://e.rpp-noticias.io/rss",
    # Tecnología
    "https://techcrunch.com/feed/",
    "https://www.theverge.com/rss/index.xml",
    # Entretenimiento / música
    "https://www.billboard.com/feed/",
    "https://rollingstone.com/music/feed/",
    # Negocios / economía
    "https://feeds.bloomberg.com/economics/news.rss",
    "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
]


class WebScraperConnector:
    def __init__(self, producer: StreamProducer, redis: Redis, project_id: str, keywords: list[str]):
        self.producer   = producer
        self.redis      = redis
        self.project_id = project_id
        self.keywords   = [kw.lower() for kw in keywords]

    def _matches_keywords(self, text: str) -> bool:
        text_lower = text.lower()
        return any(kw in text_lower for kw in self.keywords)

    async def _process_feed(self, client: httpx.AsyncClient, feed_url: str):
        try:
            r = await client.get(feed_url, follow_redirects=True, timeout=15)
            r.raise_for_status()
            feed    = feedparser.parse(r.text)
            domain  = urlparse(feed_url).netloc
            new_cnt = 0

            for entry in feed.entries:
                title       = entry.get("title", "")
                summary     = entry.get("summary", "")
                content     = f"{title} {summary}"
                entry_link  = entry.get("link", "")
                entry_id    = entry.get("id") or entry_link

                if not self._matches_keywords(content):
                    continue

                if await is_duplicate(self.redis, "web", entry_id):
                    continue

                if await is_content_duplicate(self.redis, content):
                    continue

                published = entry.get("published_parsed")
                pub_dt    = datetime(*published[:6], tzinfo=timezone.utc).isoformat() if published else datetime.now(timezone.utc).isoformat()

                normalized = {
                    "platform":         "web",
                    "project_id":       self.project_id,
                    "platform_post_id": entry_id,
                    "content_text":     content,
                    "content_url":      entry_link,
                    "source_domain":    domain,
                    "published_at":     pub_dt,
                    "author": {
                        "display_name": entry.get("author", domain),
                        "followers":    0,
                        "verified":     False,
                    },
                    "metrics": {
                        "likes": 0, "shares": 0, "comments": 0, "views": 0,
                    },
                }
                envelope = make_envelope("web", normalized, self.project_id)
                await self.producer.send(
                    "raw-mentions",
                    value=envelope,
                    key=self.project_id.encode(),
                )
                new_cnt += 1

            if new_cnt:
                log.info("Web [%s]: %d new articles", domain, new_cnt)

        except Exception as exc:
            log.warning("Feed error [%s]: %s", feed_url, exc)

    async def run(self):
        log.info("Web scraper connector started, %d RSS feeds", len(RSS_FEEDS))
        async with httpx.AsyncClient(headers={"User-Agent": "SocialListenerBot/1.0"}) as client:
            while True:
                tasks = [self._process_feed(client, url) for url in RSS_FEEDS]
                await asyncio.gather(*tasks)
                await asyncio.sleep(POLL_SECONDS)

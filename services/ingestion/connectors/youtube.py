import os
import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx
from streams import StreamProducer
from redis.asyncio import Redis
from tenacity import retry, wait_exponential, stop_after_attempt

from utils.dedup import is_duplicate
from utils.normalizer import normalize_youtube, make_envelope

log = logging.getLogger("ingestion.youtube")

API_KEY      = os.getenv("YOUTUBE_API_KEY", "")
SEARCH_URL   = "https://www.googleapis.com/youtube/v3/search"
VIDEOS_URL   = "https://www.googleapis.com/youtube/v3/videos"
POLL_SECONDS = 300  # 5 minutes


class YouTubeConnector:
    def __init__(self, producer: StreamProducer, redis: Redis, project_id: str, keywords: list[str]):
        self.producer   = producer
        self.redis      = redis
        self.project_id = project_id
        self.keywords   = keywords

    @retry(wait=wait_exponential(min=10, max=120), stop=stop_after_attempt(5))
    async def _fetch_videos(self, client: httpx.AsyncClient, keyword: str) -> list[dict]:
        published_after = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

        r = await client.get(SEARCH_URL, params={
            "key":               API_KEY,
            "q":                 keyword,
            "part":              "snippet",
            "type":              "video",
            "order":             "date",
            "maxResults":        25,
            "relevanceLanguage": "es",
            "publishedAfter":    published_after,
        })
        r.raise_for_status()
        items = r.json().get("items", [])

        if not items:
            return []

        # Enrich with statistics
        video_ids = ",".join(i["id"]["videoId"] for i in items if i.get("id", {}).get("videoId"))
        stats_r   = await client.get(VIDEOS_URL, params={
            "key":  API_KEY,
            "id":   video_ids,
            "part": "statistics,contentDetails",
        })
        stats_r.raise_for_status()

        stats_map = {v["id"]: v for v in stats_r.json().get("items", [])}
        for item in items:
            vid_id = item.get("id", {}).get("videoId")
            if vid_id and vid_id in stats_map:
                item["statistics"] = stats_map[vid_id].get("statistics", {})

        return items

    async def run(self):
        if not API_KEY:
            log.warning("YOUTUBE_API_KEY not set — skipping YouTube connector")
            return

        log.info("YouTube connector started, polling every %ds", POLL_SECONDS)
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                for keyword in self.keywords:
                    try:
                        items = await self._fetch_videos(client, keyword)
                        new_count = 0

                        for item in items:
                            vid_id = item.get("id", {}).get("videoId")
                            if not vid_id:
                                continue
                            if await is_duplicate(self.redis, "youtube", vid_id):
                                continue

                            normalized = normalize_youtube(item, self.project_id)
                            envelope   = make_envelope("youtube", normalized, self.project_id)

                            await self.producer.send(
                                "raw-mentions",
                                value=envelope,
                                key=self.project_id.encode(),
                            )
                            new_count += 1

                        log.info("YouTube [%s]: %d new videos", keyword, new_count)

                    except httpx.HTTPStatusError as exc:
                        log.warning("YouTube API error for [%s]: %s", keyword, exc)

                    await asyncio.sleep(2)  # avoid burst quota

                await asyncio.sleep(POLL_SECONDS)

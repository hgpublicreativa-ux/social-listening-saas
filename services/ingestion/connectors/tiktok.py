import os
import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx
from aiokafka import AIOKafkaProducer
from redis.asyncio import Redis

from utils.dedup import is_duplicate
from utils.normalizer import make_envelope

log = logging.getLogger("ingestion.tiktok")

CLIENT_KEY    = os.getenv("TIKTOK_CLIENT_KEY", "")
CLIENT_SECRET = os.getenv("TIKTOK_CLIENT_SECRET", "")
TOKEN_URL     = "https://open.tiktokapis.com/v2/oauth/token/"
SEARCH_URL    = "https://open.tiktokapis.com/v2/research/video/query/"
POLL_SECONDS  = 600  # 10 minutes (Research API quotas)


class TikTokConnector:
    def __init__(self, producer: AIOKafkaProducer, redis: Redis, project_id: str, keywords: list[str]):
        self.producer    = producer
        self.redis       = redis
        self.project_id  = project_id
        self.keywords    = keywords
        self._token      = None
        self._token_exp  = 0

    async def _get_token(self, client: httpx.AsyncClient) -> str:
        if self._token and datetime.now().timestamp() < self._token_exp - 60:
            return self._token

        r = await client.post(TOKEN_URL, data={
            "client_key":    CLIENT_KEY,
            "client_secret": CLIENT_SECRET,
            "grant_type":    "client_credentials",
        })
        r.raise_for_status()
        data = r.json()
        self._token     = data["access_token"]
        self._token_exp = datetime.now().timestamp() + data.get("expires_in", 7200)
        return self._token

    async def run(self):
        if not CLIENT_KEY or not CLIENT_SECRET:
            log.warning("TIKTOK credentials not set — skipping TikTok connector")
            return

        log.info("TikTok connector started")
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                try:
                    token = await self._get_token(client)
                    now   = datetime.now(timezone.utc)
                    start = int((now - timedelta(days=1)).timestamp())
                    end   = int(now.timestamp())

                    for keyword in self.keywords:
                        r = await client.post(
                            SEARCH_URL,
                            headers={"Authorization": f"Bearer {token}"},
                            params={"fields": "id,create_time,username,like_count,comment_count,share_count,view_count,video_description"},
                            json={
                                "query": {
                                    "and": [{"operation": "IN", "field_name": "keyword", "field_values": [keyword]}]
                                },
                                "start_date": str(start),
                                "end_date":   str(end),
                                "max_count":  20,
                            },
                        )
                        if r.status_code == 200:
                            videos = r.json().get("data", {}).get("videos", [])
                            for video in videos:
                                vid_id = str(video.get("id", ""))
                                if not vid_id or await is_duplicate(self.redis, "tiktok", vid_id):
                                    continue

                                normalized = {
                                    "platform":        "tiktok",
                                    "project_id":      self.project_id,
                                    "platform_post_id": vid_id,
                                    "content_text":    video.get("video_description", ""),
                                    "content_url":     f"https://www.tiktok.com/@{video.get('username')}/video/{vid_id}",
                                    "published_at":    datetime.fromtimestamp(video.get("create_time", 0), tz=timezone.utc).isoformat(),
                                    "author": {
                                        "username":  video.get("username"),
                                        "followers": 0,
                                        "verified":  False,
                                    },
                                    "metrics": {
                                        "likes":    video.get("like_count", 0),
                                        "shares":   video.get("share_count", 0),
                                        "comments": video.get("comment_count", 0),
                                        "views":    video.get("view_count", 0),
                                    },
                                }
                                envelope = make_envelope("tiktok", normalized, self.project_id)
                                await self.producer.send(
                                    "raw-mentions",
                                    value=envelope,
                                    key=self.project_id.encode(),
                                )
                        else:
                            log.warning("TikTok API error: %s %s", r.status_code, r.text[:200])

                except Exception as exc:
                    log.error("TikTok connector error: %s", exc)

                await asyncio.sleep(POLL_SECONDS)

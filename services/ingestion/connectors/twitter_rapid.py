import asyncio
import logging
import os
from datetime import datetime, timezone

import httpx

from streams import StreamProducer
from redis.asyncio import Redis
from utils.dedup import is_duplicate, is_content_duplicate
from utils.normalizer import make_envelope

log = logging.getLogger("ingestion.twitter_rapid")

RAPIDAPI_KEY  = os.getenv("RAPIDAPI_KEY", "")
RAPIDAPI_HOST = "twittr-v2-fastest-twitter-x-api-150k-requests-for-15.p.rapidapi.com"
SEARCH_URL    = f"https://{RAPIDAPI_HOST}/search"
POLL_SECONDS  = 900  # 15 min


def _parse_entry(entry: dict) -> dict | None:
    """Extract tweet data from a single timeline entry."""
    try:
        result = (
            entry.get("content", {})
                 .get("itemContent", {})
                 .get("tweet_results", {})
                 .get("result", {})
        )
        if not result:
            return None
        if result.get("__typename") == "TweetWithVisibilityResults":
            result = result.get("tweet", {})

        legacy = result.get("legacy", {})
        text   = legacy.get("full_text") or legacy.get("text", "")
        if not text:
            return None

        user_legacy = (
            result.get("core", {})
                  .get("user_results", {})
                  .get("result", {})
                  .get("legacy", {})
        )

        return {
            "id":          legacy.get("id_str") or result.get("rest_id", ""),
            "text":        text,
            "created_at":  legacy.get("created_at", ""),
            "likes":       int(legacy.get("favorite_count", 0) or 0),
            "retweets":    int(legacy.get("retweet_count", 0) or 0),
            "replies":     int(legacy.get("reply_count", 0) or 0),
            "screen_name": user_legacy.get("screen_name", ""),
            "name":        user_legacy.get("name", ""),
            "followers":   int(user_legacy.get("followers_count", 0) or 0),
            "user_id":     user_legacy.get("id_str", ""),
        }
    except Exception:
        return None


def _extract_tweets(raw: dict) -> list[dict]:
    """
    Parse response from twittr-v2-fastest (kiddodev).
    Top-level: {"category": "Top", "entries": [{"entries": [...tweet entries...]}]}
    """
    tweets = []
    top_entries = raw.get("entries", [])
    for group in top_entries:
        # Each group has sub-entries (the actual tweets)
        sub_entries = group.get("entries", [])
        if sub_entries:
            for entry in sub_entries:
                tw = _parse_entry(entry)
                if tw:
                    tweets.append(tw)
        else:
            # Some entries are direct tweet entries (not grouped)
            tw = _parse_entry(group)
            if tw:
                tweets.append(tw)
    return tweets


def _parse_twitter_date(date_str: str) -> str:
    try:
        dt = datetime.strptime(date_str, "%a %b %d %H:%M:%S +0000 %Y")
        return dt.replace(tzinfo=timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


class TwitterRapidConnector:
    """
    Twitter search via RapidAPI twittr-v2-fastest (kiddodev).
    Requires RAPIDAPI_KEY env var.
    """

    def __init__(self, producer: StreamProducer, redis: Redis, project_id: str, keywords: list[str]):
        self.producer   = producer
        self.redis      = redis
        self.project_id = project_id
        self.keywords   = keywords

    async def _search(self, client: httpx.AsyncClient, keyword: str) -> list[dict]:
        r = await client.get(
            SEARCH_URL,
            params={"query": keyword, "product": "Latest"},
            timeout=30,
        )
        if r.status_code in (401, 403):
            log.error("RapidAPI Twitter auth failed (HTTP %d) — check RAPIDAPI_KEY subscription", r.status_code)
            raise httpx.HTTPStatusError("auth", request=r.request, response=r)
        if r.status_code == 429:
            log.warning("RapidAPI Twitter rate limited — backing off 60s")
            await asyncio.sleep(60)
            return []
        r.raise_for_status()
        return _extract_tweets(r.json())

    async def run(self):
        if not RAPIDAPI_KEY:
            log.warning("RAPIDAPI_KEY not set — skipping Twitter (RapidAPI) connector")
            return

        log.info("Twitter (RapidAPI) connector started for project %s", self.project_id)
        headers = {
            "X-RapidAPI-Key":  RAPIDAPI_KEY,
            "X-RapidAPI-Host": RAPIDAPI_HOST,
        }
        async with httpx.AsyncClient(headers=headers) as client:
            while True:
                new_total = 0
                for kw in self.keywords:
                    try:
                        tweets = await self._search(client, kw)
                        for tw in tweets:
                            tid  = tw["id"]
                            text = tw["text"]
                            if not tid or not text.strip():
                                continue
                            if text.startswith("RT @"):
                                continue
                            if await is_duplicate(self.redis, "twitter", tid):
                                continue
                            if await is_content_duplicate(self.redis, text):
                                continue

                            normalized = {
                                "platform":         "twitter",
                                "project_id":       self.project_id,
                                "platform_post_id": tid,
                                "content_text":     text[:2000],
                                "content_url":      f"https://x.com/{tw['screen_name']}/status/{tid}",
                                "source_domain":    "x.com",
                                "published_at":     _parse_twitter_date(tw["created_at"]),
                                "language":         "es",
                                "author": {
                                    "platform_id":  tw["user_id"],
                                    "display_name": tw["name"] or tw["screen_name"],
                                    "username":     tw["screen_name"],
                                    "followers":    tw["followers"],
                                    "verified":     False,
                                },
                                "metrics": {
                                    "likes":    tw["likes"],
                                    "shares":   tw["retweets"],
                                    "comments": tw["replies"],
                                    "views":    0,
                                },
                            }
                            envelope = make_envelope("twitter", normalized, self.project_id)
                            await self.producer.send("raw-mentions", value=envelope, key=self.project_id.encode())
                            new_total += 1

                        await asyncio.sleep(2)

                    except httpx.HTTPStatusError as exc:
                        if exc.response.status_code in (401, 403):
                            log.error("RapidAPI Twitter auth failed — disabling connector")
                            return
                        log.warning("RapidAPI Twitter HTTP error for '%s': %s", kw, exc)
                    except Exception as exc:
                        log.warning("RapidAPI Twitter error for '%s': %s", kw, exc)

                log.info("Twitter/RapidAPI [project %s]: %d new tweets", self.project_id, new_total)
                await asyncio.sleep(POLL_SECONDS)

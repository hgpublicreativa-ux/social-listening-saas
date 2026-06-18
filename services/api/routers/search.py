"""
Real-time search endpoint: queries Twitter (RapidAPI), Google News RSS, and Bluesky
in parallel and returns combined results within ~5 seconds.
No background polling needed — results on demand.
"""
import asyncio
import os
import logging
from datetime import datetime, timezone

import feedparser
import httpx
from fastapi import APIRouter, Query
from pydantic import BaseModel

log = logging.getLogger("api.search")

router = APIRouter(prefix="/search", tags=["search"])

RAPIDAPI_KEY  = os.getenv("RAPIDAPI_KEY", "")
RAPIDAPI_HOST = "twittr-v2-fastest-twitter-x-api-150k-requests-for-15.p.rapidapi.com"
TWITTER_URL   = f"https://{RAPIDAPI_HOST}/search"
GNEWS_URL     = "https://news.google.com/rss/search"
BLUESKY_URL   = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts"


class SearchResult(BaseModel):
    platform:    str
    title:       str
    text:        str
    url:         str
    author:      str
    published_at: str
    likes:       int = 0
    shares:      int = 0
    comments:    int = 0
    source:      str = ""


def _parse_tw_date(s: str) -> str:
    try:
        return datetime.strptime(s, "%a %b %d %H:%M:%S +0000 %Y").replace(tzinfo=timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


async def _search_twitter(client: httpx.AsyncClient, q: str) -> list[SearchResult]:
    if not RAPIDAPI_KEY:
        return []
    try:
        r = await client.get(
            TWITTER_URL,
            params={"query": q, "product": "Latest"},
            headers={"X-RapidAPI-Key": RAPIDAPI_KEY, "X-RapidAPI-Host": RAPIDAPI_HOST},
            timeout=10,
        )
        if r.status_code != 200:
            log.warning("Twitter search HTTP %d", r.status_code)
            return []
        results = []
        for group in r.json().get("entries", []):
            entries = group.get("entries", [group])
            for entry in entries:
                try:
                    result = (
                        entry.get("content", {})
                             .get("itemContent", {})
                             .get("tweet_results", {})
                             .get("result", {})
                    )
                    if not result:
                        continue
                    if result.get("__typename") == "TweetWithVisibilityResults":
                        result = result.get("tweet", {})
                    legacy = result.get("legacy", {})
                    text   = legacy.get("full_text") or legacy.get("text", "")
                    if not text or text.startswith("RT @"):
                        continue
                    user = (
                        result.get("core", {})
                              .get("user_results", {})
                              .get("result", {})
                              .get("legacy", {})
                    )
                    tid = legacy.get("id_str") or result.get("rest_id", "")
                    sn  = user.get("screen_name", "")
                    results.append(SearchResult(
                        platform="twitter",
                        title=f"@{sn}",
                        text=text[:500],
                        url=f"https://x.com/{sn}/status/{tid}",
                        author=user.get("name") or sn,
                        published_at=_parse_tw_date(legacy.get("created_at", "")),
                        likes=int(legacy.get("favorite_count", 0) or 0),
                        shares=int(legacy.get("retweet_count", 0) or 0),
                        comments=int(legacy.get("reply_count", 0) or 0),
                        source="x.com",
                    ))
                except Exception:
                    continue
        return results[:25]
    except Exception as exc:
        log.warning("Twitter search error: %s", exc)
        return []


async def _search_gnews(client: httpx.AsyncClient, q: str) -> list[SearchResult]:
    try:
        r = await client.get(
            GNEWS_URL,
            params={"q": q, "hl": "es", "gl": "EC", "ceid": "EC:es"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        feed = feedparser.parse(r.text)
        results = []
        for e in feed.entries[:20]:
            try:
                pub = datetime(*e.published_parsed[:6], tzinfo=timezone.utc).isoformat() if e.get("published_parsed") else datetime.now(timezone.utc).isoformat()
                src = e.get("source", {})
                src_name = src.get("title", "Google News") if isinstance(src, dict) else "Google News"
                results.append(SearchResult(
                    platform="web",
                    title=e.get("title", ""),
                    text=(e.get("summary") or e.get("title", ""))[:500],
                    url=e.get("link", ""),
                    author=src_name,
                    published_at=pub,
                    source="news.google.com",
                ))
            except Exception:
                continue
        return results
    except Exception as exc:
        log.warning("Google News search error: %s", exc)
        return []


async def _search_bluesky(client: httpx.AsyncClient, q: str) -> list[SearchResult]:
    try:
        r = await client.get(
            BLUESKY_URL,
            params={"q": q, "limit": 20, "lang": "es"},
            timeout=10,
        )
        if r.status_code != 200:
            return []
        results = []
        for post in r.json().get("posts", []):
            try:
                record = post.get("record", {})
                text   = record.get("text", "")
                if not text:
                    continue
                author = post.get("author", {})
                handle = author.get("handle", "")
                uri    = post.get("uri", "")
                created = record.get("createdAt", "")
                try:
                    pub = datetime.fromisoformat(created.replace("Z", "+00:00")).isoformat()
                except Exception:
                    pub = datetime.now(timezone.utc).isoformat()
                results.append(SearchResult(
                    platform="bluesky",
                    title=f"@{handle}",
                    text=text[:500],
                    url=f"https://bsky.app/profile/{handle}/post/{uri.split('/')[-1]}",
                    author=author.get("displayName") or handle,
                    published_at=pub,
                    likes=int(post.get("likeCount", 0) or 0),
                    shares=int(post.get("repostCount", 0) or 0),
                    comments=int(post.get("replyCount", 0) or 0),
                    source="bsky.app",
                ))
            except Exception:
                continue
        return results
    except Exception as exc:
        log.warning("Bluesky search error: %s", exc)
        return []


@router.get("", response_model=list[SearchResult])
async def live_search(
    q:       str   = Query(..., min_length=1, description="Keyword to search"),
    sources: str   = Query("twitter,web,bluesky", description="Comma-separated sources"),
    limit:   int   = Query(60, le=100),
):
    """Search Twitter, Google News, and Bluesky in real-time."""
    src_list = [s.strip() for s in sources.split(",")]

    async with httpx.AsyncClient(follow_redirects=True) as client:
        tasks = []
        if "twitter" in src_list:
            tasks.append(_search_twitter(client, q))
        if "web" in src_list:
            tasks.append(_search_gnews(client, q))
        if "bluesky" in src_list:
            tasks.append(_search_bluesky(client, q))

        results_nested = await asyncio.gather(*tasks)

    combined = [r for batch in results_nested for r in batch]
    combined.sort(key=lambda r: r.published_at, reverse=True)
    return combined[:limit]

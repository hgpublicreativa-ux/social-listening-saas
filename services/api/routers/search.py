"""
Real-time search: fetches from Twitter, Google News, Bluesky in parallel,
enriches with GPT-4o-mini sentiment, returns dashboard-style response.
"""
import asyncio
import os
import uuid
import logging
from datetime import datetime, timezone
from collections import defaultdict

import feedparser
import httpx
from fastapi import APIRouter, Query, Depends
from pydantic import BaseModel
from redis.asyncio import Redis

from nlp import enrich_batch
from routers.auth import get_current_user

log = logging.getLogger("api.search")

router = APIRouter(prefix="/search", tags=["search"])

RAPIDAPI_KEY  = os.getenv("RAPIDAPI_KEY", "")
RAPIDAPI_HOST = "twittr-v2-fastest-twitter-x-api-150k-requests-for-15.p.rapidapi.com"
TWITTER_URL   = f"https://{RAPIDAPI_HOST}/search"
GNEWS_URL     = "https://news.google.com/rss/search"
BLUESKY_URL   = "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts"

MEDIA_DOMAINS = [
    "ecuavisa.com",
    "teleamazonas.com",
    "extra.ec",
    "primicias.ec",
    "elcomercio.com",
    "eluniverso.com",
]

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


# ── Models ────────────────────────────────────────────────────────────────────

class RawResult(BaseModel):
    id:          str
    platform:    str
    text:        str
    title:       str = ""
    url:         str = ""
    author:      str = ""
    author_id:   str = ""
    followers:   int = 0
    published_at: str = ""
    likes:       int = 0
    shares:      int = 0
    comments:    int = 0
    source:      str = ""


class EnrichedResult(RawResult):
    sentiment:       str   = "neutral"
    sentiment_score: float = 0.5
    keywords:        list  = []
    entities:        list  = []
    summary:         str   = ""


class TopAccount(BaseModel):
    author:       str
    author_id:    str
    platform:     str
    followers:    int
    mention_count: int
    sentiment:    str


class SearchSummary(BaseModel):
    total:       int
    positive:    int
    negative:    int
    neutral:     int
    reach:       int
    engagement:  int


class SearchResponse(BaseModel):
    query:        str
    summary:      SearchSummary
    top_accounts: list[TopAccount]
    results:      list[EnrichedResult]


# ── Fetchers ──────────────────────────────────────────────────────────────────

def _tw_date(s: str) -> str:
    try:
        return datetime.strptime(s, "%a %b %d %H:%M:%S +0000 %Y").replace(tzinfo=timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


async def _fetch_twitter(client: httpx.AsyncClient, q: str) -> list[RawResult]:
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
            return []
        results = []
        for group in r.json().get("entries", []):
            for entry in group.get("entries", [group]):
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
                    text = legacy.get("full_text") or legacy.get("text", "")
                    if not text or text.startswith("RT @"):
                        continue
                    user = (
                        result.get("core", {}).get("user_results", {})
                              .get("result", {}).get("legacy", {})
                    )
                    tid = legacy.get("id_str") or result.get("rest_id", "")
                    sn  = user.get("screen_name", "")
                    results.append(RawResult(
                        id=tid or str(uuid.uuid4()),
                        platform="twitter",
                        text=text[:1000],
                        title=f"@{sn}",
                        url=f"https://x.com/{sn}/status/{tid}",
                        author=user.get("name") or sn,
                        author_id=sn,
                        followers=int(user.get("followers_count", 0) or 0),
                        published_at=_tw_date(legacy.get("created_at", "")),
                        likes=int(legacy.get("favorite_count", 0) or 0),
                        shares=int(legacy.get("retweet_count", 0) or 0),
                        comments=int(legacy.get("reply_count", 0) or 0),
                        source="x.com",
                    ))
                except Exception:
                    continue
        return results[:30]
    except Exception as exc:
        log.warning("Twitter fetch error: %s", exc)
        return []


async def _fetch_gnews(client: httpx.AsyncClient, q: str) -> list[RawResult]:
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
                pub = (
                    datetime(*e.published_parsed[:6], tzinfo=timezone.utc).isoformat()
                    if e.get("published_parsed")
                    else datetime.now(timezone.utc).isoformat()
                )
                src = e.get("source", {})
                src_name = src.get("title", "Google News") if isinstance(src, dict) else "Google News"
                text = (e.get("summary") or e.get("title", ""))
                results.append(RawResult(
                    id=e.get("id") or e.get("link") or str(uuid.uuid4()),
                    platform="web",
                    text=text[:1000],
                    title=e.get("title", ""),
                    url=e.get("link", ""),
                    author=src_name,
                    author_id=src_name,
                    followers=0,
                    published_at=pub,
                    source="news.google.com",
                ))
            except Exception:
                continue
        return results
    except Exception as exc:
        log.warning("Google News fetch error: %s", exc)
        return []


def _matches_query(text: str, q: str) -> bool:
    """
    Returns True if the query matches the article text.
    - Quoted phrase (e.g. "Daniel Noboa"): exact phrase match in title+text.
    - Multi-word: ALL tokens must appear (AND logic).
    - Single word: token must appear in the title or text.
    Only checks title + summary, never metadata/tags.
    """
    haystack = text.lower()
    q_clean = q.strip()

    # Exact phrase match for quoted queries
    import re
    phrases = re.findall(r'"([^"]+)"', q_clean)
    for phrase in phrases:
        if phrase.lower() not in haystack:
            return False
    if phrases:
        return True

    # Multi/single token: ALL must appear (AND)
    tokens = [t.strip().lower() for t in q_clean.split() if len(t.strip()) > 2]
    if not tokens:
        return False
    return all(tok in haystack for tok in tokens)


async def _fetch_media(client: httpx.AsyncClient, q: str) -> list[RawResult]:
    """Searches all Ecuadorian media domains via Google News site: operator in parallel."""
    async def _one(domain: str) -> list[RawResult]:
        try:
            r = await client.get(
                GNEWS_URL,
                params={"q": f"{q} site:{domain}", "hl": "es", "gl": "EC", "ceid": "EC:es"},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=10,
            )
            feed = feedparser.parse(r.text)
            out  = []
            for e in feed.entries[:15]:
                try:
                    pub = (
                        datetime(*e.published_parsed[:6], tzinfo=timezone.utc).isoformat()
                        if e.get("published_parsed")
                        else datetime.now(timezone.utc).isoformat()
                    )
                    text = f"{e.get('title', '')} {e.get('summary', '')}".strip()
                    # Post-filter: ensure article actually contains the keyword
                    if not _matches_query(text, q):
                        continue
                    out.append(RawResult(
                        id=e.get("id") or e.get("link") or str(uuid.uuid4()),
                        platform="media",
                        text=text[:1000],
                        title=e.get("title", ""),
                        url=e.get("link", ""),
                        author=domain,
                        author_id=domain,
                        followers=0,
                        published_at=pub,
                        source=domain,
                    ))
                except Exception:
                    continue
            return out
        except Exception as exc:
            log.warning("Media fetch error [%s]: %s", domain, exc)
            return []

    batches = await asyncio.gather(*[_one(d) for d in MEDIA_DOMAINS])
    results = [r for batch in batches for r in batch]
    results.sort(key=lambda r: r.published_at, reverse=True)
    return results


async def _fetch_bluesky(client: httpx.AsyncClient, q: str) -> list[RawResult]:
    try:
        r = await client.get(BLUESKY_URL, params={"q": q, "limit": 25}, timeout=10)
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
                results.append(RawResult(
                    id=uri or str(uuid.uuid4()),
                    platform="bluesky",
                    text=text[:1000],
                    title=f"@{handle}",
                    url=f"https://bsky.app/profile/{handle}/post/{uri.split('/')[-1]}",
                    author=author.get("displayName") or handle,
                    author_id=handle,
                    followers=0,
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
        log.warning("Bluesky fetch error: %s", exc)
        return []


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("", response_model=SearchResponse)
async def live_search(
    q:       str = Query(..., min_length=1),
    sources: str = Query("twitter,web,bluesky,media"),
    _user =  Depends(get_current_user),
):
    src_list = [s.strip() for s in sources.split(",")]
    redis    = Redis.from_url(REDIS_URL, decode_responses=True)

    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            tasks = []
            if "twitter" in src_list:
                tasks.append(_fetch_twitter(client, q))
            if "web" in src_list:
                tasks.append(_fetch_gnews(client, q))
            if "bluesky" in src_list:
                tasks.append(_fetch_bluesky(client, q))
            if "media" in src_list:
                tasks.append(_fetch_media(client, q))
            fetched_batches = await asyncio.gather(*tasks)

        raw: list[RawResult] = [r for batch in fetched_batches for r in batch]
        raw.sort(key=lambda r: r.published_at, reverse=True)

        # NLP enrichment
        nlp_map = await enrich_batch(redis, [{"id": r.id, "text": r.text} for r in raw])

        enriched: list[EnrichedResult] = []
        for r in raw:
            nlp = nlp_map.get(r.id, {})
            enriched.append(EnrichedResult(
                **r.model_dump(),
                sentiment=       nlp.get("sentiment", "neutral"),
                sentiment_score= nlp.get("sentiment_score", 0.5),
                keywords=        nlp.get("keywords", []),
                entities=        nlp.get("entities", []),
                summary=         nlp.get("summary", ""),
            ))

        # Aggregate summary
        pos = sum(1 for r in enriched if r.sentiment == "positive")
        neg = sum(1 for r in enriched if r.sentiment == "negative")
        neu = len(enriched) - pos - neg
        reach      = sum(r.followers for r in enriched)
        engagement = sum(r.likes + r.shares + r.comments for r in enriched)

        # Top accounts
        acct_map: dict[str, dict] = defaultdict(lambda: {"count": 0, "followers": 0, "sentiments": []})
        for r in enriched:
            key = f"{r.platform}:{r.author_id}"
            acct_map[key]["author"]    = r.author
            acct_map[key]["author_id"] = r.author_id
            acct_map[key]["platform"]  = r.platform
            acct_map[key]["followers"] = max(acct_map[key]["followers"], r.followers)
            acct_map[key]["count"]    += 1
            acct_map[key]["sentiments"].append(r.sentiment)

        top_accounts = sorted(
            [
                TopAccount(
                    author=       v["author"],
                    author_id=    v["author_id"],
                    platform=     v["platform"],
                    followers=    v["followers"],
                    mention_count=v["count"],
                    sentiment=    max(set(v["sentiments"]), key=v["sentiments"].count),
                )
                for v in acct_map.values()
            ],
            key=lambda a: (a.mention_count, a.followers),
            reverse=True,
        )[:10]

        return SearchResponse(
            query=q,
            summary=SearchSummary(
                total=len(enriched),
                positive=pos,
                negative=neg,
                neutral=neu,
                reach=reach,
                engagement=engagement,
            ),
            top_accounts=top_accounts,
            results=enriched,
        )
    finally:
        await redis.aclose()

"""
Real-time search: fetches from Twitter, Google News, Bluesky in parallel,
enriches with GPT-4o-mini sentiment, returns dashboard-style response.
"""
import asyncio
import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
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


MEDIA_DOMAINS = [
    # ── TV nacional ──
    "ecuavisa.com",
    "teleamazonas.com",
    "tctelevision.com",
    "ecuadortv.ec",
    "gamavision.com.ec",
    # ── Prensa escrita ──
    "eluniverso.com",
    "elcomercio.com",
    "primicias.ec",
    "expreso.ec",
    "extra.ec",
    "vistazo.com",
    "eltelegrafo.com.ec",
    "lahora.com.ec",
    "laposta.ec",
    # ── Radios ──
    "publicafm.ec",
    "radiosucesos.fm",
    "ecuadoradio.ec",
    "radiocentro.com.ec",
    "kchcomunicacion.com",
    "radiosucre.com.ec",
    "fmmundo.com",
    "cre.com.ec",
    "primeraplana.com.ec",
    "radioforever925.com",
    "wqradio.com",
    # ── Internacional (cobertura de Ecuador) ──
    "efe.com",
    "infobae.com",
    "swissinfo.ch",
    "dw.com",
    "elpais.com",
    "prensa-latina.cu",
]

# Whitelist of Ecuadorian news outlets — used to filter Google News EC results
EC_MEDIA_DOMAINS = {
    "eluniverso.com", "elcomercio.com", "primicias.ec", "ecuavisa.com",
    "teleamazonas.com", "extra.ec", "expreso.ec", "lahora.com.ec",
    "eltelegrafo.com.ec", "metroecuador.com.ec", "vistazo.com", "gk.city",
    "ecuadorinmediato.com", "elmercurio.com.ec", "eldiario.ec", "cronica.com.ec",
    "larepublica.ec", "elnorte.ec", "planv.com.ec", "4pelagatos.com",
    "wambra.ec", "pichinchacomunicaciones.com.ec", "radiopichincha.com",
    "ecuadorenvivo.com", "ecuadoruniversitario.com", "lagacetaecuador.com",
    "diariocorreo.com.ec", "elproductor.com", "elcomercio.com.ec",
    "ecuador.com", "ecuavisa.tv", "rts.com.ec", "tctelevision.com",
    "ecuadortv.ec", "elobservador.ec", "surtidordenoticias.com",
    "primicias.com.ec", "edicionmedica.ec", "revistagestion.ec",
    "elcomercio", "diarioextra.ec",
    # Medios añadidos para monitoreo
    "ecuadortv.ec", "gamavision.com.ec", "laposta.ec", "publicafm.ec",
    "radiosucesos.fm", "ecuadoradio.ec", "radiocentro.com.ec",
    "kchcomunicacion.com", "radiosucre.com.ec", "fmmundo.com",
    "cre.com.ec", "primeraplana.com.ec", "radioforever925.com", "wqradio.com",
}

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


def _source_domain(entry) -> str:
    """Extracts publisher domain from a Google News RSS entry's <source> tag."""
    src = entry.get("source", {})
    href = ""
    if isinstance(src, dict):
        href = src.get("href", "") or src.get("url", "")
    if not href:
        return ""
    from urllib.parse import urlparse
    netloc = urlparse(href).netloc.lower()
    return netloc[4:] if netloc.startswith("www.") else netloc


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
        return results[:40]
    except Exception as exc:
        log.warning("Twitter fetch error: %s", exc)
        return []


async def _fetch_gnews(
    client: httpx.AsyncClient,
    q: str,
    platform: str = "web",
    ec_only: bool = False,
    worldwide: bool = False,
    limit: int = 40,
) -> list[RawResult]:
    # Worldwide → broad Latin-American Spanish locale; EC → Ecuador locale
    if worldwide:
        params: dict = {"q": q, "hl": "es-419", "gl": "US", "ceid": "US:es-419"}
    else:
        params = {"q": q, "hl": "es", "gl": "EC", "ceid": "EC:es"}
    try:
        r = await client.get(
            GNEWS_URL,
            params=params,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        feed = feedparser.parse(r.content)
        results = []
        for e in feed.entries:
            if len(results) >= limit:
                break
            try:
                dom = _source_domain(e)
                # EC-only: keep whitelisted outlets OR any .ec domain (Ecuadorian)
                if ec_only and not (dom in EC_MEDIA_DOMAINS or dom.endswith(".ec")):
                    continue
                # Exact phrase filter for quoted queries
                entry_text = f"{e.get('title', '')} {e.get('summary', '')}".strip()
                if not _matches_query(entry_text, q):
                    continue
                pub = (
                    datetime(*e.published_parsed[:6], tzinfo=timezone.utc).isoformat()
                    if e.get("published_parsed")
                    else datetime.now(timezone.utc).isoformat()
                )
                src = e.get("source", {})
                src_name = src.get("title", "Google News") if isinstance(src, dict) else "Google News"
                import re as _re
                # Google News RSS summaries are raw <a href>…</a> HTML — strip tags
                raw_summary = _re.sub(r"<[^>]+>", " ", e.get("summary", "")).strip()
                text = raw_summary or e.get("title", "")
                results.append(RawResult(
                    id=e.get("id") or e.get("link") or str(uuid.uuid4()),
                    platform=platform,
                    text=text[:1000],
                    title=e.get("title", ""),
                    url=e.get("link", ""),
                    author=src_name,
                    author_id=src_name,
                    followers=0,
                    published_at=pub,
                    source=dom or "news.google.com",
                ))
            except Exception:
                continue
        return results
    except Exception as exc:
        log.warning("Google News fetch error: %s", exc)
        return []


def _normalize(s: str) -> str:
    """Strip accents/diacritics for accent-insensitive matching."""
    import unicodedata
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode("ascii").lower()


def _matches_query(text: str, q: str) -> bool:
    """
    Returns True if the article text is relevant to the query.
    - Quoted phrase: exact phrase match required.
    - Multi/single word: at least ONE significant token (≥4 chars) must appear.
    Accent-insensitive: "futbol" matches "fútbol", etc.
    """
    import re
    haystack = _normalize(text)
    q_clean = q.strip()

    # Exact phrase for quoted terms
    phrases = re.findall(r'"([^"]+)"', q_clean)
    for phrase in phrases:
        if _normalize(phrase) not in haystack:
            return False
    if phrases:
        return True

    # Any significant token must appear (OR, min 4 chars to skip stop words)
    tokens = [_normalize(t.strip()) for t in re.sub(r'"[^"]*"', '', q_clean).split() if len(t.strip()) >= 4]
    if not tokens:
        tokens = [_normalize(t.strip()) for t in q_clean.split() if len(t.strip()) >= 2]
    return any(tok in haystack for tok in tokens)


# Sites that support WordPress-style search RSS (most reliable — own index)
SITE_SEARCH_RSS: dict[str, str] = {
    "eluniverso.com":    "https://www.eluniverso.com/?s={q}&feed=rss2",
    "elcomercio.com":    "https://www.elcomercio.com/?s={q}&feed=rss2",
    "primicias.ec":      "https://www.primicias.ec/?s={q}&feed=rss2",
    "extra.ec":          "https://www.extra.ec/?s={q}&feed=rss2",
    "teleamazonas.com":  "https://www.teleamazonas.com/?s={q}&feed=rss2",
    "ecuavisa.com":      "https://www.ecuavisa.com/?s={q}&feed=rss2",
    "expreso.ec":        "https://www.expreso.ec/?s={q}&feed=rss2",
    "vistazo.com":       "https://www.vistazo.com/?s={q}&feed=rss2",
    "lahora.com.ec":     "https://www.lahora.com.ec/?s={q}&feed=rss2",
    "eltelegrafo.com.ec":"https://www.eltelegrafo.com.ec/?s={q}&feed=rss2",
    "laposta.ec":        "https://www.laposta.ec/?s={q}&feed=rss2",
    "cre.com.ec":        "https://www.cre.com.ec/?s={q}&feed=rss2",
    "primeraplana.com.ec": "https://primeraplana.com.ec/?s={q}&feed=rss2",
    "radioforever925.com": "https://www.radioforever925.com/?s={q}&feed=rss2",
    "wqradio.com":       "https://wqradio.com/?s={q}&feed=rss2",
}

# Static section feeds (no query param) — fetched always, filtered locally by _matches_query
# Format: (domain_label, rss_url)
STATIC_SECTION_FEEDS: list[tuple[str, str]] = [
    ("extra.ec",  "https://www.extra.ec/farandula/feed/"),
]

HEADERS_MEDIA = {
    "User-Agent": "Mozilla/5.0 (compatible; SocialMonitor/1.0; +https://socialmonitor.app)",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}


async def _fetch_media(client: httpx.AsyncClient, q: str) -> list[RawResult]:
    """
    Fetches from Ecuadorian media using two strategies per domain (in parallel):
    1. Site's own search RSS (?s=q&feed=rss2) — most accurate, own index
    2. Google News RSS (site:domain q) — fallback, broader coverage
    Deduplicates by URL. No post-keyword filter — both sources already filter by query.
    """
    seen_urls: set[str] = set()

    def _parse_entries(entries, domain: str, limit: int = 15) -> list[RawResult]:
        out = []
        for e in entries[:limit]:
            try:
                url = e.get("link", "")
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                pub = (
                    datetime(*e.published_parsed[:6], tzinfo=timezone.utc).isoformat()
                    if e.get("published_parsed")
                    else datetime.now(timezone.utc).isoformat()
                )
                title   = e.get("title", "")
                summary = e.get("summary", "")
                # Strip HTML tags from summary
                import re as _re
                summary = _re.sub(r"<[^>]+>", " ", summary).strip()
                text = f"{title} {summary}".strip()
                if not title:
                    continue
                out.append(RawResult(
                    id=e.get("id") or url or str(uuid.uuid4()),
                    platform="media",
                    text=text[:1000],
                    title=title,
                    url=url,
                    author=domain,
                    author_id=domain,
                    followers=0,
                    published_at=pub,
                    source=domain,
                ))
            except Exception:
                continue
        return out

    async def _fetch_site_rss(domain: str) -> list[RawResult]:
        """Try site's own search RSS first."""
        template = SITE_SEARCH_RSS.get(domain)
        if not template:
            return []
        url = template.format(q=q.replace(" ", "+"))
        try:
            r = await client.get(url, headers=HEADERS_MEDIA, timeout=12)
            if r.status_code != 200:
                return []
            feed = feedparser.parse(r.content)
            return _parse_entries(feed.entries, domain, limit=30)
        except Exception as exc:
            log.debug("Site RSS error [%s]: %s", domain, exc)
            return []

    async def _fetch_gnews_site(domain: str) -> list[RawResult]:
        """Google News site: fallback."""
        try:
            r = await client.get(
                GNEWS_URL,
                params={"q": f"{q} site:{domain}", "hl": "es", "gl": "EC", "ceid": "EC:es"},
                headers=HEADERS_MEDIA,
                timeout=12,
            )
            feed = feedparser.parse(r.content)
            return _parse_entries(feed.entries, domain, limit=20)
        except Exception as exc:
            log.debug("GNews site error [%s]: %s", domain, exc)
            return []

    # Cap concurrency so many domains don't trigger Google News rate-limiting (429)
    sem = asyncio.Semaphore(8)

    async def _one(domain: str) -> list[RawResult]:
        async with sem:
            # Run both in parallel, merge (dedup by URL via seen_urls set)
            site_results, gnews_results = await asyncio.gather(
                _fetch_site_rss(domain),
                _fetch_gnews_site(domain),
            )
        return site_results + gnews_results

    async def _fetch_static_section(domain: str, url: str) -> list[RawResult]:
        """Fetch a static section RSS feed (no query param), filter locally."""
        try:
            r = await client.get(url, headers=HEADERS_MEDIA, timeout=12)
            if r.status_code != 200:
                return []
            feed = feedparser.parse(r.content)
            raw = _parse_entries(feed.entries, domain, limit=30)
            return [item for item in raw if _matches_query(item.text, q)]
        except Exception as exc:
            log.debug("Static section RSS error [%s]: %s", domain, exc)
            return []

    batches = await asyncio.gather(*[_one(d) for d in MEDIA_DOMAINS])
    results = [r for batch in batches for r in batch]

    # Static section feeds (filtered locally)
    section_batches = await asyncio.gather(*[_fetch_static_section(d, u) for d, u in STATIC_SECTION_FEEDS])
    for batch in section_batches:
        results.extend(batch)

    results.sort(key=lambda r: r.published_at, reverse=True)
    return results[:60]


async def _fetch_reddit(client: httpx.AsyncClient, q: str) -> list[RawResult]:
    """Fetches Reddit posts via public RSS search — no auth needed."""
    try:
        r = await client.get(
            "https://www.reddit.com/search.rss",
            params={"q": q, "sort": "new", "t": "month", "limit": 60},
            headers={"User-Agent": "SocialMonitor/1.0 (compatible; news aggregator)"},
            timeout=12,
        )
        if r.status_code != 200:
            return []
        feed = feedparser.parse(r.content)
        results = []
        import re as _re
        for e in feed.entries[:40]:
            try:
                pub = (
                    datetime(*e.published_parsed[:6], tzinfo=timezone.utc).isoformat()
                    if e.get("published_parsed")
                    else datetime.now(timezone.utc).isoformat()
                )
                title   = e.get("title", "")
                summary = _re.sub(r"<[^>]+>", " ", e.get("summary", "")).strip()
                text    = f"{title} {summary}".strip()
                if not _matches_query(text, q):
                    continue
                author  = e.get("author", "").replace("/u/", "").strip()
                url     = e.get("link", "")
                subreddit = ""
                if "/r/" in url:
                    subreddit = url.split("/r/")[1].split("/")[0]
                results.append(RawResult(
                    id=e.get("id") or url or str(uuid.uuid4()),
                    platform="reddit",
                    text=text[:1000],
                    title=title,
                    url=url,
                    author=f"u/{author}" if author else "Reddit",
                    author_id=author,
                    followers=0,
                    published_at=pub,
                    source=f"r/{subreddit}" if subreddit else "reddit.com",
                ))
            except Exception:
                continue
        return results
    except Exception as exc:
        log.warning("Reddit fetch error: %s", exc)
        return []


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("", response_model=SearchResponse)
async def live_search(
    q:       str = Query(..., min_length=1),
    sources: str = Query("twitter,web,bluesky,media"),
    _user =  Depends(get_current_user),
):
    # Parse category filter from query: "categoria: XXX" (accent-insensitive)
    category = None
    query_for_search = q
    q_norm = _normalize(q)
    if "categoria:" in q_norm:
        parts = q_norm.split("categoria:", 1)
        category = parts[1].strip().split()[0] if len(parts) > 1 else None
        # Preserve original query text minus the categoria clause
        orig_lower = q.lower()
        cat_idx = orig_lower.find("categoria:")
        query_for_search = q[:cat_idx].strip() if cat_idx > 0 else ""
        if not query_for_search:
            query_for_search = category  # fall back to category as search term

    src_list = [s.strip() for s in sources.split(",")]
    redis    = Redis.from_url(REDIS_URL, decode_responses=True)

    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            tasks = []
            if "twitter" in src_list:
                tasks.append(_fetch_twitter(client, query_for_search))
            if "web" in src_list:
                tasks.append(_fetch_gnews(client, query_for_search, platform="web", worldwide=True, limit=60))
            if "gnews_ec" in src_list:
                tasks.append(_fetch_gnews(client, query_for_search, platform="gnews_ec", ec_only=True, limit=60))
            if "reddit" in src_list:
                tasks.append(_fetch_reddit(client, query_for_search))
            if "media" in src_list:
                tasks.append(_fetch_media(client, query_for_search))
            fetched_batches = await asyncio.gather(*tasks)

        raw: list[RawResult] = [r for batch in fetched_batches for r in batch]
        # Limit to last 60 days
        cutoff_60d = datetime.now(timezone.utc) - timedelta(days=60)
        def _within_60d(r: RawResult) -> bool:
            try:
                dt = datetime.fromisoformat(r.published_at.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt >= cutoff_60d
            except Exception:
                return True
        raw = [r for r in raw if _within_60d(r)]
        raw.sort(key=lambda r: r.published_at, reverse=True)

        # NLP enrichment
        nlp_map = await enrich_batch(redis, [{"id": r.id, "text": r.text} for r in raw], category=category)

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

        # Filter by category if requested (confidence >= 0.6, accent-insensitive)
        if category:
            enriched = [
                r for r in enriched
                if _normalize(nlp_map.get(r.id, {}).get("category", "")) == _normalize(category)
                and nlp_map.get(r.id, {}).get("category_confidence", 0) >= 0.6
            ]

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

from datetime import datetime, timezone


def make_envelope(platform: str, raw: dict, project_id: str) -> dict:
    return {
        "schema_version": "1.0",
        "platform":       platform,
        "project_id":     project_id,
        "ingested_at":    datetime.now(timezone.utc).isoformat(),
        "raw":            raw,
    }


def normalize_twitter(raw: dict, project_id: str) -> dict:
    tweet  = raw.get("data", {})
    users  = {u["id"]: u for u in raw.get("includes", {}).get("users", [])}
    author = users.get(tweet.get("author_id"), {})
    pm     = tweet.get("public_metrics", {})

    return {
        "platform":        "twitter",
        "project_id":      project_id,
        "platform_post_id": tweet.get("id"),
        "content_text":    tweet.get("text"),
        "published_at":    tweet.get("created_at"),
        "author": {
            "platform_id":   author.get("id"),
            "username":      author.get("username"),
            "display_name":  author.get("name"),
            "followers":     author.get("public_metrics", {}).get("followers_count", 0),
            "verified":      author.get("verified", False),
        },
        "metrics": {
            "likes":    pm.get("like_count", 0),
            "shares":   pm.get("retweet_count", 0),
            "comments": pm.get("reply_count", 0),
            "views":    pm.get("impression_count", 0),
        },
    }


def normalize_youtube(raw: dict, project_id: str) -> dict:
    snippet  = raw.get("snippet", {})
    stats    = raw.get("statistics", {})
    vid_id   = raw.get("id", {}).get("videoId") or raw.get("id")

    return {
        "platform":        "youtube",
        "project_id":      project_id,
        "platform_post_id": vid_id,
        "content_text":    f"{snippet.get('title','')} {snippet.get('description','')}".strip(),
        "content_url":     f"https://www.youtube.com/watch?v={vid_id}",
        "published_at":    snippet.get("publishedAt"),
        "author": {
            "platform_id":  snippet.get("channelId"),
            "display_name": snippet.get("channelTitle"),
            "followers":    0,
            "verified":     False,
        },
        "metrics": {
            "likes":    int(stats.get("likeCount", 0)),
            "shares":   0,
            "comments": int(stats.get("commentCount", 0)),
            "views":    int(stats.get("viewCount", 0)),
        },
    }

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from db.connection import get_db, es
from models.schemas import MentionOut
from routers.auth import get_current_user

router = APIRouter(prefix="/projects/{project_id}/mentions", tags=["mentions"])


@router.get("", response_model=list[MentionOut])
async def list_mentions(
    project_id: str,
    platform:   str | None = Query(None),
    sentiment:  str | None = Query(None),
    q:          str | None = Query(None, description="Full-text search"),
    limit:      int = Query(50, le=200),
    offset:     int = Query(0),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Use Elasticsearch when full-text query is present
    if q:
        must = [{"multi_match": {"query": q, "fields": ["content_text", "keywords", "entities.name"]}}]
        filters = [{"term": {"project_id": project_id}}]
        if platform:
            filters.append({"term": {"platform": platform}})
        if sentiment:
            filters.append({"term": {"sentiment": sentiment}})

        resp = await es.search(index="mentions", body={
            "query": {"bool": {"must": must, "filter": filters}},
            "sort":  [{"published_at": "desc"}],
            "from":  offset,
            "size":  limit,
        })
        ids = [hit["_id"] for hit in resp["hits"]["hits"]]
        if not ids:
            return []

        result = await db.execute(text("""
            SELECT id, platform, platform_post_id, content_text, content_url,
                   published_at, sentiment, sentiment_score, keywords,
                   entities, summary, likes, shares, comments, views
            FROM mentions WHERE platform_post_id = ANY(:ids)
            ORDER BY published_at DESC
        """), {"ids": ids})
    else:
        clauses = ["project_id = :pid"]
        params  = {"pid": project_id, "limit": limit, "offset": offset}
        if platform:
            clauses.append("platform = :platform")
            params["platform"] = platform
        if sentiment:
            clauses.append("sentiment = :sentiment")
            params["sentiment"] = sentiment

        result = await db.execute(text(f"""
            SELECT id, platform, platform_post_id, content_text, content_url,
                   published_at, sentiment, sentiment_score, keywords,
                   entities, summary, likes, shares, comments, views
            FROM mentions
            WHERE {' AND '.join(clauses)}
            ORDER BY published_at DESC
            LIMIT :limit OFFSET :offset
        """), params)

    return [dict(r._mapping) for r in result.fetchall()]

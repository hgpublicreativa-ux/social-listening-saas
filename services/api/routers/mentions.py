from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from db.connection import get_db
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
    clauses = ["project_id = :pid"]
    params  = {"pid": project_id, "limit": limit, "offset": offset}

    if platform:
        clauses.append("platform = :platform")
        params["platform"] = platform
    if sentiment:
        clauses.append("sentiment = :sentiment")
        params["sentiment"] = sentiment
    if q:
        clauses.append("to_tsvector('simple', coalesce(content_text,'')) @@ plainto_tsquery('simple', :q)")
        params["q"] = q

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

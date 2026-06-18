from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from db.connection import get_db
from models.schemas import MetricsHourly
from routers.auth import get_current_user

router = APIRouter(prefix="/projects/{project_id}/metrics", tags=["metrics"])


@router.get("/timeseries", response_model=list[MetricsHourly])
async def timeseries(
    project_id: str,
    platform:   str | None = Query(None),
    from_date:  str = Query(..., description="ISO date e.g. 2024-01-01"),
    to_date:    str = Query(..., description="ISO date e.g. 2024-01-31"),
    granularity: str = Query("hour", description="hour | day"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    table = "metrics_daily" if granularity == "day" else "metrics_hourly"
    col   = "day" if granularity == "day" else "bucket"
    clauses = ["project_id = :pid", f"{col} >= :from_date", f"{col} <= :to_date"]
    params  = {"pid": project_id, "from_date": from_date, "to_date": to_date}

    if platform:
        clauses.append("platform = :platform")
        params["platform"] = platform

    result = await db.execute(text(f"""
        SELECT {col} AS bucket, platform, mention_count,
               positive_count, negative_count, neutral_count,
               total_reach, total_engagement
        FROM {table}
        WHERE {' AND '.join(clauses)}
        ORDER BY {col} ASC
    """), params)
    return [dict(r._mapping) for r in result.fetchall()]


@router.get("/summary")
async def summary(
    project_id: str,
    from_date:  str = Query(...),
    to_date:    str = Query(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(text("""
        SELECT
            SUM(mention_count)     AS total_mentions,
            SUM(positive_count)    AS total_positive,
            SUM(negative_count)    AS total_negative,
            SUM(neutral_count)     AS total_neutral,
            SUM(total_reach)       AS total_reach,
            SUM(total_engagement)  AS total_engagement,
            platform
        FROM metrics_hourly
        WHERE project_id = :pid
          AND bucket >= :from_date
          AND bucket <= :to_date
        GROUP BY platform
    """), {"pid": project_id, "from_date": from_date, "to_date": to_date})
    return [dict(r._mapping) for r in result.fetchall()]


@router.get("/creators")
async def top_creators(
    project_id: str,
    limit: int = Query(10, le=50),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(text("""
        SELECT cr.rank, cr.mention_count, cr.total_reach, cr.engagement_rate, cr.influence_score,
               sp.username, sp.display_name, sp.platform, sp.followers, sp.verified
        FROM creator_rankings cr
        JOIN social_profiles sp ON sp.id = cr.profile_id
        WHERE cr.project_id = :pid
          AND cr.period_start >= date_trunc('week', now())
        ORDER BY cr.influence_score DESC
        LIMIT :limit
    """), {"pid": project_id, "limit": limit})
    return [dict(r._mapping) for r in result.fetchall()]

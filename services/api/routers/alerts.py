from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from db.connection import get_db
from models.schemas import AlertRuleCreate, AlertRuleOut
from routers.auth import get_current_user

router = APIRouter(prefix="/projects/{project_id}/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertRuleOut])
async def list_rules(
    project_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(text("""
        SELECT id, name, trigger_type, threshold, window_minutes,
               webhook_url, webhook_secret, active, created_at
        FROM alert_rules WHERE project_id = :pid ORDER BY created_at DESC
    """), {"pid": project_id})
    return [dict(r._mapping) for r in result.fetchall()]


@router.post("", response_model=AlertRuleOut, status_code=201)
async def create_rule(
    project_id: str,
    body: AlertRuleCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(text("""
        INSERT INTO alert_rules(project_id, name, trigger_type, threshold,
            window_minutes, webhook_url, webhook_secret)
        VALUES (:pid, :name, :type, :threshold, :window, :webhook_url, :secret)
        RETURNING id, name, trigger_type, threshold, window_minutes,
                  webhook_url, webhook_secret, active, created_at
    """), {
        "pid":         project_id,
        "name":        body.name,
        "type":        body.trigger_type,
        "threshold":   body.threshold,
        "window":      body.window_minutes,
        "webhook_url": body.webhook_url,
        "secret":      body.webhook_secret,
    })
    await db.commit()
    return dict(result.fetchone()._mapping)


@router.delete("/{rule_id}", status_code=204)
async def delete_rule(
    project_id: str,
    rule_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(text("DELETE FROM alert_rules WHERE id = :id AND project_id = :pid"),
                     {"id": rule_id, "pid": project_id})
    await db.commit()

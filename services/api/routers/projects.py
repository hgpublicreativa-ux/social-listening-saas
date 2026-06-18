from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from db.connection import get_db
from models.schemas import ProjectCreate, ProjectOut
from routers.auth import get_current_user

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(text("""
        SELECT id, name, keywords, sources, language, active, created_at
        FROM projects WHERE org_id = (SELECT org_id FROM users WHERE id = :uid)
        ORDER BY created_at DESC
    """), {"uid": current_user["id"]})
    return [dict(r._mapping) for r in result.fetchall()]


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    body: ProjectCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(text("""
        INSERT INTO projects(org_id, name, keywords, sources, language)
        VALUES ((SELECT org_id FROM users WHERE id = :uid), :name, :keywords, :sources, :lang)
        RETURNING id, name, keywords, sources, language, active, created_at
    """), {
        "uid":      current_user["id"],
        "name":     body.name,
        "keywords": body.keywords,
        "sources":  body.sources,
        "lang":     body.language,
    })
    await db.commit()
    row = result.fetchone()
    return dict(row._mapping)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(text("DELETE FROM projects WHERE id = :id"), {"id": project_id})
    await db.commit()

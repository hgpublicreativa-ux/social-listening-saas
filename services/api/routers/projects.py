from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from db.connection import get_db
from models.schemas import ProjectCreate, ProjectOut
from routers.auth import get_current_user


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    keywords: Optional[list[str]] = None
    sources: Optional[list[str]] = None
    language: Optional[str] = None
    active: Optional[bool] = None

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


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    fields = body.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    sets   = ", ".join(f"{k} = :{k}" for k in fields)
    params = {"id": project_id, **fields}
    result = await db.execute(text(f"""
        UPDATE projects SET {sets}
        WHERE id = :id
        RETURNING id, name, keywords, sources, language, active, created_at
    """), params)
    await db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    return dict(row._mapping)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(text("DELETE FROM projects WHERE id = :id"), {"id": project_id})
    await db.commit()

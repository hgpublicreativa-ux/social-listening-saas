from datetime import datetime
from typing import Any
from uuid import UUID
from pydantic import BaseModel, EmailStr


class OrgCreate(BaseModel):
    name: str

class OrgOut(BaseModel):
    id: UUID
    name: str
    plan: str
    created_at: datetime
    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: UUID
    email: str
    role: str
    model_config = {"from_attributes": True}

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ProjectCreate(BaseModel):
    name: str
    keywords: list[str]
    sources: list[str] = ["twitter", "youtube"]
    language: str = "es"

class ProjectOut(BaseModel):
    id: UUID
    name: str
    keywords: list[str]
    sources: list[str]
    language: str
    active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class MentionOut(BaseModel):
    id: UUID
    platform: str
    platform_post_id: str
    content_text: str | None
    content_url: str | None
    published_at: datetime
    sentiment: str | None
    sentiment_score: float | None
    keywords: list[str]
    entities: list[dict]
    summary: str | None
    likes: int
    shares: int
    comments: int
    views: int
    model_config = {"from_attributes": True}


class MetricsHourly(BaseModel):
    bucket: datetime
    platform: str
    mention_count: int
    positive_count: int
    negative_count: int
    neutral_count: int
    total_reach: int
    total_engagement: int


class AlertRuleCreate(BaseModel):
    name: str
    trigger_type: str
    threshold: float | None = None
    window_minutes: int = 60
    webhook_url: str | None = None
    webhook_secret: str | None = None

class AlertRuleOut(AlertRuleCreate):
    id: UUID
    active: bool
    created_at: datetime
    model_config = {"from_attributes": True}

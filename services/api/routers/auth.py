import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from db.connection import get_db
from models.schemas import Token, UserCreate, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

SECRET_KEY  = os.getenv("SECRET_KEY", "change-me-32-chars")
ALGORITHM   = os.getenv("JWT_ALGORITHM", "HS256")
EXPIRE_MIN  = int(os.getenv("JWT_EXPIRE_MINUTES", "1440"))

pwd_ctx  = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2   = OAuth2PasswordBearer(tokenUrl="/auth/login")


def create_token(data: dict) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=EXPIRE_MIN)
    return jwt.encode({**data, "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(token: str = Depends(oauth2), db: AsyncSession = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(text("SELECT id, email, role FROM users WHERE id = :id"), {"id": user_id})
    user   = result.fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return dict(user._mapping)


@router.post("/register", response_model=UserOut, status_code=201)
async def register(body: UserCreate, db: AsyncSession = Depends(get_db)):
    hashed = pwd_ctx.hash(body.password)
    try:
        result = await db.execute(text("""
            INSERT INTO users(org_id, email, hashed_password, role)
            VALUES ((SELECT id FROM organizations LIMIT 1), :email, :pw, 'admin')
            RETURNING id, email, role
        """), {"email": body.email, "pw": hashed})
        await db.commit()
        row = result.fetchone()
        return dict(row._mapping)
    except Exception:
        raise HTTPException(status_code=400, detail="Email already registered")


@router.post("/login", response_model=Token)
async def login(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("SELECT id, hashed_password FROM users WHERE email = :email"),
        {"email": form.username}
    )
    user = result.fetchone()
    if not user or not pwd_ctx.verify(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    return {"access_token": create_token({"sub": str(user.id)})}

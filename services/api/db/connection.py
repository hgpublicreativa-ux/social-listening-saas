import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from elasticsearch import AsyncElasticsearch
from redis.asyncio import Redis

DATABASE_URL = os.getenv("DATABASE_URL")
ES_URL       = os.getenv("ES_URL", "http://localhost:9200")
REDIS_URL    = os.getenv("REDIS_URL", "redis://localhost:6379")

engine            = create_async_engine(DATABASE_URL, pool_size=10, max_overflow=20)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

es    = AsyncElasticsearch([ES_URL])
redis = Redis.from_url(REDIS_URL, decode_responses=True)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

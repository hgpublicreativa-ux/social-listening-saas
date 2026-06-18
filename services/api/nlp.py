"""Lightweight NLP batch processor for on-demand search enrichment."""
import asyncio
import hashlib
import json
import logging
import os

from openai import AsyncOpenAI
from redis.asyncio import Redis

log = logging.getLogger("api.nlp")

_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))

PROMPT = """\
You are a social media analyst. Analyze the following texts and return ONLY a valid JSON array.
For each item include:
- "id": the same id provided
- "sentiment": "positive" | "negative" | "neutral"
- "sentiment_score": float 0-1
- "keywords": array of up to 5 relevant keywords
- "entities": array of {{"name": str, "type": "PERSON"|"BRAND"|"PLACE"|"EVENT"|"OTHER"}}
- "summary": one-sentence summary in the same language as the text

Texts:
{texts_json}

Return ONLY the JSON array, no markdown, no explanation."""

PROMPT_WITH_CATEGORY = """\
You are a social media analyst. Analyze the following texts and return ONLY a valid JSON array.
For each item include:
- "id": the same id provided
- "sentiment": "positive" | "negative" | "neutral"
- "sentiment_score": float 0-1
- "keywords": array of up to 5 relevant keywords
- "entities": array of {{"name": str, "type": "PERSON"|"BRAND"|"PLACE"|"EVENT"|"OTHER"}}
- "summary": one-sentence summary in the same language as the text
- "category": if the text belongs to category "{category}", set to "{category}", otherwise "other"
- "category_confidence": float 0-1 indicating confidence the text matches the requested category

Target category: {category}

Texts:
{texts_json}

Return ONLY the JSON array, no markdown, no explanation."""


def _cache_key(text: str) -> str:
    return "nlp:cache:" + hashlib.sha256(text[:400].encode()).hexdigest()


def _fallback(item_id: str, text: str) -> dict:
    return {
        "id": item_id,
        "sentiment": "neutral",
        "sentiment_score": 0.5,
        "keywords": [],
        "entities": [],
        "summary": text[:120],
        "nlp_tier": "fallback",
    }


async def enrich_batch(redis: Redis, items: list[dict], category: str = None) -> dict[str, dict]:
    """
    items: list of {"id": str, "text": str}
    category: optional category name to classify texts into
    returns: dict mapping id -> nlp result
    """
    results: dict[str, dict] = {}
    uncached: list[dict] = []

    for item in items:
        key = _cache_key(item["text"])
        raw = await redis.get(key)
        if raw:
            results[item["id"]] = json.loads(raw)
        else:
            uncached.append(item)

    async def _process_batch(batch: list[dict]) -> None:
        payload = [{"id": x["id"], "text": x["text"][:300]} for x in batch]
        try:
            prompt = PROMPT_WITH_CATEGORY.format(category=category) if category else PROMPT
            resp = await _client.chat.completions.create(
                model="gpt-4o-mini",
                max_tokens=4096,
                temperature=0,
                messages=[{"role": "user", "content": prompt.format(
                    texts_json=json.dumps(payload, ensure_ascii=False)
                )}],
            )
            content = resp.choices[0].message.content or ""
            content = content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            parsed = json.loads(content)
            for r in parsed:
                rid = r.get("id")
                if not rid:
                    continue
                data = {k: v for k, v in r.items() if k != "id"}
                data["nlp_tier"] = "gpt"
                results[rid] = data
                orig = next((x["text"] for x in batch if x["id"] == rid), None)
                if orig:
                    await redis.set(_cache_key(orig), json.dumps(data), ex=86400 * 7)
        except Exception as exc:
            log.error("GPT batch failed: %s", exc)
            for item in batch:
                results[item["id"]] = _fallback(item["id"], item["text"])

    batches = [uncached[i:i + 8] for i in range(0, len(uncached), 8)]
    await asyncio.gather(*[_process_batch(b) for b in batches])

    # Fallback for any missing
    for item in items:
        if item["id"] not in results:
            results[item["id"]] = _fallback(item["id"], item["text"])

    return results

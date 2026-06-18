#!/usr/bin/env bash
set -euo pipefail

echo "==> Social Listening Platform — Setup"

# 1. Copy env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    .env created. Edit your API keys before continuing."
  echo "    Required: TWITTER_BEARER_TOKEN, YOUTUBE_API_KEY, ANTHROPIC_API_KEY"
fi

# 2. Start infra first
echo "==> Starting infrastructure (kafka, redis, postgres, elasticsearch)..."
docker compose up -d zookeeper kafka redis postgres elasticsearch

# 3. Wait for postgres
echo "==> Waiting for PostgreSQL..."
until docker compose exec postgres pg_isready -U social -d socialdb &>/dev/null; do
  sleep 1
done
echo "    PostgreSQL ready."

# 4. Wait for elasticsearch
echo "==> Waiting for Elasticsearch..."
until curl -sf http://localhost:9200/_cluster/health &>/dev/null; do
  sleep 2
done
echo "    Elasticsearch ready."

# 5. Create Kafka topics
echo "==> Creating Kafka topics..."
bash scripts/kafka_topics.sh

# 6. Create ES index
echo "==> Creating Elasticsearch mention index..."
curl -s -X PUT http://localhost:9200/mentions -H "Content-Type: application/json" -d '{
  "mappings": {
    "properties": {
      "project_id":      {"type": "keyword"},
      "platform":        {"type": "keyword"},
      "content_text":    {"type": "text", "analyzer": "spanish"},
      "sentiment":       {"type": "keyword"},
      "keywords":        {"type": "keyword"},
      "entities":        {"type": "nested", "properties": {"name": {"type": "keyword"}, "type": {"type": "keyword"}}},
      "published_at":    {"type": "date"},
      "reach_score":     {"type": "float"}
    }
  }
}' && echo " Done."

# 7. Build & start services
echo "==> Building application services..."
docker compose build api ingestion nlp_worker metrics_worker alert_engine frontend

echo "==> Starting all services..."
docker compose up -d

echo ""
echo "Platform running:"
echo "  Dashboard:   http://localhost:3000"
echo "  API docs:    http://localhost:8000/docs"
echo "  Kafka UI:    http://localhost:9092 (native)"
echo ""
echo "Logs: docker compose logs -f nlp_worker ingestion"

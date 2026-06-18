#!/usr/bin/env bash
set -euo pipefail

KAFKA="docker compose exec kafka kafka-topics.sh --bootstrap-server localhost:9092"

TOPICS=(
  "raw-mentions:4:1"
  "enriched-mentions:4:1"
  "alerts:1:1"
  "metrics:2:1"
)

for spec in "${TOPICS[@]}"; do
  topic="${spec%%:*}"
  rest="${spec#*:}"
  partitions="${rest%%:*}"
  replicas="${rest##*:}"

  if $KAFKA --list 2>/dev/null | grep -q "^${topic}$"; then
    echo "  topic '${topic}' already exists — skip"
  else
    $KAFKA --create \
      --topic "$topic" \
      --partitions "$partitions" \
      --replication-factor "$replicas"
    echo "  created topic '${topic}' (p=${partitions} r=${replicas})"
  fi
done

echo "Kafka topics ready."

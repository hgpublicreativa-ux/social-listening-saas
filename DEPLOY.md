# Deploy en Railway — Guía Paso a Paso

## Servicios externos necesarios (todos tienen free tier)

| Servicio | Para qué | Free tier |
|---|---|---|
| **Railway PostgreSQL** | Base de datos principal | incluido en Railway |
| **Railway Redis** | Cache + dedup + pubsub | incluido en Railway |
| **Upstash Kafka** | Cola de mensajes | 10k msgs/day gratis |
| **Elastic Cloud** | Full-text search | 14 días trial / Bonsai.io free |

---

## Paso 1 — Crea el proyecto en Railway

1. Ve a [railway.app](https://railway.app) → **New Project**
2. Elige **"Deploy from GitHub repo"**
3. Selecciona `hgpublicreativa-ux/social-listening-saas`

---

## Paso 2 — Agrega PostgreSQL y Redis

En tu proyecto Railway:
- Clic **+ New** → **Database** → **PostgreSQL**
- Clic **+ New** → **Database** → **Redis**

Railway genera automáticamente las variables `DATABASE_URL` y `REDIS_URL`.

---

## Paso 3 — Configura Upstash Kafka

1. Ve a [upstash.com/kafka](https://upstash.com/kafka) → **Create Cluster**
2. Región: `us-east-1` o la más cercana
3. Copia el **Bootstrap URL** (formato: `pkc-xxx.upstash.io:9092`)
4. Copia **SASL Username** y **SASL Password**

En Railway, en cada servicio Python, agrega:
```
KAFKA_BOOTSTRAP=pkc-xxx.upstash.io:9092
KAFKA_SASL_USERNAME=tu-username
KAFKA_SASL_PASSWORD=tu-password
```

---

## Paso 4 — Despliega cada servicio

Crea **6 servicios** en Railway, cada uno desde el mismo repo con diferente **Root Directory**:

| Servicio Railway | Root Directory | Puerto |
|---|---|---|
| `api` | `services/api` | 8000 |
| `frontend` | `frontend` | 80 |
| `ingestion` | `services/ingestion` | — |
| `nlp-worker` | `services/nlp_worker` | — |
| `metrics-worker` | `services/metrics_worker` | — |
| `alert-engine` | `services/alert_engine` | — |

Para cada uno:
1. **+ New** → **GitHub Repo** → selecciona el repo
2. En **Settings** → **Source** → cambia **Root Directory**
3. Railway detecta el `Dockerfile` automáticamente

---

## Paso 5 — Variables de entorno por servicio

### `api` service
```env
DATABASE_URL=         # auto-inyectado por Railway PostgreSQL
REDIS_URL=            # auto-inyectado por Railway Redis
KAFKA_BOOTSTRAP=      # de Upstash
ES_URL=               # de Elastic Cloud / Bonsai.io
SECRET_KEY=           # genera con: openssl rand -hex 32
FRONTEND_URL=         # URL del frontend Railway (ej. https://frontend-xxx.railway.app)
JWT_EXPIRE_MINUTES=1440
```

### `frontend` service
```env
VITE_API_URL=https://api-xxx.railway.app   # URL del servicio api
PORT=80
```

### `ingestion` / `nlp_worker` / `metrics_worker` / `alert_engine`
```env
DATABASE_URL=         # mismo que api
REDIS_URL=            # mismo que api
KAFKA_BOOTSTRAP=      # de Upstash
ANTHROPIC_API_KEY=    # para NLP worker
TWITTER_BEARER_TOKEN= # para ingestion
YOUTUBE_API_KEY=      # para ingestion
```

---

## Paso 6 — Temas Kafka (crear en Upstash dashboard)

Crea estos temas en Upstash → tu cluster → **Topics**:
- `raw-mentions` (4 partitions)
- `enriched-mentions` (4 partitions)
- `alerts` (1 partition)
- `metrics` (2 partitions)

---

## Paso 7 — Elasticsearch (Bonsai.io gratis)

1. Ve a [bonsai.io](https://bonsai.io) → **Sign Up** → plan Sandbox (gratis)
2. Crea un cluster
3. Copia la URL con credenciales: `https://user:pass@cluster.bonsai.io`
4. Úsala como `ES_URL` en los servicios que la necesiten

Crea el índice `mentions` (puedes hacerlo con curl o desde el API docs):
```bash
curl -X PUT $ES_URL/mentions \
  -H "Content-Type: application/json" \
  -d '{
    "mappings": {
      "properties": {
        "project_id":   {"type": "keyword"},
        "platform":     {"type": "keyword"},
        "content_text": {"type": "text", "analyzer": "spanish"},
        "sentiment":    {"type": "keyword"},
        "keywords":     {"type": "keyword"},
        "published_at": {"type": "date"},
        "reach_score":  {"type": "float"}
      }
    }
  }'
```

---

## Paso 8 — Actualiza SASL en servicios Python para Upstash

Upstash Kafka requiere SASL/SSL. Agrega esto al inicio de cada worker que use Kafka:

```python
# En main.py de cada servicio, reemplaza AIOKafkaConsumer/Producer config:
import os
ssl_context = None
sasl_user = os.getenv("KAFKA_SASL_USERNAME")
sasl_pass = os.getenv("KAFKA_SASL_PASSWORD")

if sasl_user:
    import ssl
    ssl_context = ssl.create_default_context()
    extra = dict(
        security_protocol="SASL_SSL",
        sasl_mechanism="SCRAM-SHA-256",
        sasl_plain_username=sasl_user,
        sasl_plain_password=sasl_pass,
        ssl_context=ssl_context,
    )
else:
    extra = {}

# Pasa **extra a AIOKafkaConsumer/Producer junto a bootstrap_servers
```

---

## URLs finales esperadas

```
Frontend:   https://frontend-xxx.railway.app
API:        https://api-xxx.railway.app
API Docs:   https://api-xxx.railway.app/docs
```

---

## Troubleshooting

| Error | Causa | Fix |
|---|---|---|
| `relation "mentions" does not exist` | Migración no corrió | Verifica logs del servicio `api` al arrancar |
| `Connection refused kafka` | Upstash SASL no configurado | Agrega las vars SASL_USERNAME y SASL_PASSWORD |
| `NLP worker OOM` | Modelos HuggingFace pesados | Agrega `SKIP_LOCAL_NLP=true` para usar solo Claude |
| CORS error frontend | FRONTEND_URL no seteada | Agrégala al servicio `api` |

FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y gcc postgresql-client && rm -rf /var/lib/apt/lists/*
COPY services/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY infra/migrations /app/migrations
COPY services/api/ .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

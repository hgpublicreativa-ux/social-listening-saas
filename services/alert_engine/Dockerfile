FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y gcc && rm -rf /var/lib/apt/lists/*
COPY services/alert_engine/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/alert_engine/ .
CMD ["python", "main.py"]

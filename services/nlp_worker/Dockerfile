FROM python:3.12-slim

WORKDIR /app
RUN apt-get update && apt-get install -y gcc g++ && rm -rf /var/lib/apt/lists/*

COPY services/nlp_worker/requirements.txt .
# Install torch CPU-only to keep image small; swap for cuda variant on GPU hosts
RUN pip install --no-cache-dir torch==2.3.0+cpu --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

COPY services/nlp_worker/ .

# Pre-download models at build time so container starts fast
RUN python -c "from transformers import pipeline; pipeline('text-classification', model='cardiffnlp/twitter-xlm-roberta-base-sentiment'); pipeline('ner', model='dslim/bert-base-NER', aggregation_strategy='simple')"

CMD ["python", "main.py"]

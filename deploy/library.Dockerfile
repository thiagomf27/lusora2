# broll-engine (library/, a submodule — D71). Its own code, own deps, own
# pgvector database; lusora reaches it only over HTTP (D11).
FROM python:3.12-slim-bookworm

# ffmpeg is not optional here: it cuts every clip, detects scene changes, and
# grabs the frames the perceptual hash and the drift check compare.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY library/broll-engine/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY library/broll-engine .

# Clip bytes and staged uploads must NOT land in /tmp: sources are deleted
# after tagging, so anything cleared on restart is footage lost with rows left
# pointing at nothing. Both are volumes in docker-compose.yml.
ENV BROLL_STORAGE_ROOT=/broll-data/clips \
    BROLL_UPLOAD_ROOT=/broll-data/uploads

EXPOSE 8321
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8321"]

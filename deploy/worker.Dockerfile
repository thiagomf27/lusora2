FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg nodejs npm && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY contracts contracts
COPY engine engine
COPY worker worker
WORKDIR /app/worker
RUN uv sync --frozen --no-dev
ENV ENGINE_CLI=/app/engine/src/cli.ts
CMD ["uv", "run", "python", "-m", "lusora_worker"]

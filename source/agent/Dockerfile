FROM public.ecr.aws/docker/library/python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

RUN pip install uv

COPY pyproject.toml .
RUN uv pip install --system -e .

# AWS_REGION / AWS_DEFAULT_REGION are injected by the AgentCore Runtime at
# deploy time (see AgentRuntime environmentVariables in deploy/src/app-stack.ts).
# They are deliberately not baked into the image so the container cannot silently
# run against the wrong region.
ENV UV_NO_SYNC=1

COPY . .

RUN rm -rf .venv

RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["opentelemetry-instrument", "python", "-m", "main"]

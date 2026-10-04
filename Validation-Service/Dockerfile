FROM ghcr.io/astral-sh/uv:0.10.0 AS uv

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/workspace/Validation-Service/.venv/bin:${PATH}"

RUN apt-get update \
    && apt-get install --no-install-recommends -y libodbc2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=uv /uv /uvx /bin/
WORKDIR /workspace
COPY Validation-Service/pyproject.toml Validation-Service/uv.lock Validation-Service/README.md ./Validation-Service/
COPY Validation-Service/src ./Validation-Service/src
COPY contracts ./contracts
RUN uv sync --frozen --no-dev --project /workspace/Validation-Service \
    && useradd --system --uid 10001 --create-home dqengine \
    && chown -R dqengine:dqengine /workspace

USER dqengine
EXPOSE 8000
ENTRYPOINT ["dq-engine"]
CMD ["api"]

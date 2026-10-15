# The worker is the only component that talks to the public internet, so it runs
# as a non-root user with no build toolchain in the final image.
FROM python:3.12-slim-bookworm AS build
WORKDIR /src
COPY worker/pyproject.toml ./
COPY worker/tcescan ./tcescan
RUN python -m venv /venv \
 && /venv/bin/pip install --no-cache-dir --upgrade pip \
 && /venv/bin/pip install --no-cache-dir .

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/venv/bin:$PATH" \
    BRAND_LOGO_PATH=/brand/tcecure-logo-white.png
# WeasyPrint renders the PDF copy of the briefing through these native
# libraries; without them it imports but cannot render, and every scan logs a
# warning instead of producing a PDF.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libfribidi0 \
      libgdk-pixbuf-2.0-0 libffi8 fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 10002 worker \
 && useradd --system --uid 10002 --gid worker --home /worker worker
COPY --from=build /venv /venv
# The report templates ship inside the installed package; only the brand asset
# comes from the web tree.
COPY --chown=worker:worker web/public/brand/tcecure-logo-white.png /brand/
WORKDIR /worker
USER worker
CMD ["python", "-m", "tcescan"]

# Multi-stage build: Bun builder, nginx runtime (MPA static site).

FROM oven/bun:1.4.0 AS builder

WORKDIR /app

ARG ASTRO_BASE=/
ARG ASTRO_SITE=https://opencloudmesh.org
ARG SITE_PROFILE=default
ARG SITE_PAGES=
ARG VALIDATOR_CONTACT=

ENV ASTRO_BASE=${ASTRO_BASE}
ENV ASTRO_SITE=${ASTRO_SITE}
ENV SITE_PROFILE=${SITE_PROFILE}
# SITE_PAGES is ARG-only: Docker exposes ARG SITE_PAGES="" in RUN, so the build step unsets it when empty so SITE_PROFILE applies; non-empty values are exported as overrides.
ENV VALIDATOR_CONTACT=${VALIDATOR_CONTACT}

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN if [ -n "$SITE_PAGES" ]; then export SITE_PAGES="$SITE_PAGES"; else unset SITE_PAGES; fi && bun run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080

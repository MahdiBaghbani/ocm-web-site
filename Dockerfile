# Multi-stage build: Bun builder, nginx runtime (MPA static site).
# Generic image: default profile, no baked deployment URLs or contact.
# Optional SITE_* / VALIDATOR_CONTACT at build time write dist/config.json
# (Pages). Leave them unset so deployments mount their own config.json.

FROM oven/bun:1.4.0 AS builder

WORKDIR /app

ARG ASTRO_BASE=/
ARG ASTRO_SITE=
ARG SITE_PROFILE=default
ARG SITE_PAGES=
ARG SITE_PRIMARY_PAGE=
ENV ASTRO_BASE=${ASTRO_BASE}
ENV ASTRO_SITE=${ASTRO_SITE}
ENV SITE_PROFILE=${SITE_PROFILE}
ENV SITE_PRIMARY_PAGE=${SITE_PRIMARY_PAGE}
# Empty SITE_PAGES must be unset so SITE_PROFILE applies (Docker ARG defaults to "").

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN if [ -n "$SITE_PAGES" ]; then export SITE_PAGES="$SITE_PAGES"; else unset SITE_PAGES; fi && bun run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080

ARG BUILD_FROM

# Stage 1: Install Node.js dependencies and compile native modules (node-pty)
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 2: Runtime on HA base image
FROM ${BUILD_FROM}

# Install Node.js 20 and runtime dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends \
        nodejs \
        nginx \
        git \
        tmux \
        openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy pre-built node_modules from builder (includes compiled node-pty)
COPY --from=builder /build/node_modules ./node_modules

# Copy application files
COPY server.js package.json ./
COPY public/ ./public/

# Copy s6-overlay and nginx config
COPY deploy/ha-addon/rootfs/ /

# Ensure s6 scripts are executable
RUN chmod +x /etc/s6-overlay/s6-rc.d/init-loom/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/svc-loom/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/svc-loom/finish \
    && chmod +x /etc/s6-overlay/s6-rc.d/svc-nginx/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/svc-nginx/finish

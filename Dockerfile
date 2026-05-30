FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

RUN npm ci

COPY client ./client
COPY server ./server

RUN npm run build --workspace client

ENV INSTALL_PUPPETEER_CHROME=1
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
RUN npm run install:chrome --workspace server

FROM node:20-bookworm-slim AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/client/build ./client/build
COPY --from=build /app/server ./server
COPY --from=build /app/.cache/puppeteer ./.cache/puppeteer

CMD ["node", "server/server.js"]

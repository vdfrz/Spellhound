FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN mkdir -p /data/spellhound && chown node:node /data/spellhound
COPY --from=build /app/dist ./dist
COPY server/*.mjs ./server/
USER node
EXPOSE 8080
CMD ["node","server/start.mjs"]

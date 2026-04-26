FROM node:20-slim

WORKDIR /app

# Install all deps (including dev) for build, then prune
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Remove dev dependencies after build
RUN npm prune --omit=dev

CMD ["node", "dist/index.js"]

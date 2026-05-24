# Sahhaonline API — déploiement EasyPanel / Docker
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat

# --- Étape 1 : installation complète des dépendances (dev + prod) pour le build ---
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Étape 2 : compilation TypeScript ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# --- Étape 3 : installation des dépendances de production uniquement ---
FROM base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Étape 4 : image finale ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S -g 1001 nodejs \
  && adduser -S -u 1001 -G nodejs api

COPY --from=prod-deps --chown=api:nodejs /app/node_modules ./node_modules
COPY --from=builder   --chown=api:nodejs /app/dist ./dist
COPY --chown=api:nodejs package.json ./package.json
COPY --chown=api:nodejs migrations ./migrations

USER api
EXPOSE 4000
CMD ["node", "dist/index.js"]

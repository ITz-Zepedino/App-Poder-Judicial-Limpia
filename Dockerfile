# =============================================================================
# STAGE 1: Builder - (Esta parte queda igual)
# =============================================================================
FROM node:20-slim AS builder
# ... (todo lo de la etapa 1 se mantiene)
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# =============================================================================
# STAGE 2: Runtime - Imagen de producción
# =============================================================================
# --- CORRECCIÓN CLAVE AQUÍ ---
# Actualiza la versión de la imagen para que coincida con tu package.json
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

WORKDIR /app

# (El resto del archivo queda exactamente igual)
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.js ./server.js

RUN npm ci --omit=dev

RUN groupadd -r appuser && useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app
USER appuser

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]

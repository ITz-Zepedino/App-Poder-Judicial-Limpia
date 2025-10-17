# =============================================================================
# STAGE 1: Builder - Instalar dependencias y compilar
# =============================================================================
FROM node:20-slim AS builder

# Instalar dependencias del sistema para la compilación
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# =============================================================================
# STAGE 2: Runtime - Imagen de producción
# =============================================================================
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Copiar solo los artefactos de compilación y producción necesarios
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.js ./server.js

# Instalar solo dependencias de PRODUCCIÓN
RUN npm ci --omit=dev

# Crear y usar un usuario no-root
RUN groupadd -r appuser && useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app
USER appuser

# Variables de entorno
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]

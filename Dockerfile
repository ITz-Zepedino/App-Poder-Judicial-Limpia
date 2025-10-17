# =============================================================================
# STAGE 1: Builder - Instalar dependencias y compilar
# =============================================================================
FROM node:20-slim AS builder

# Instalar dependencias del sistema para Playwright y la compilación
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar archivos de dependencias primero (mejor cache de Docker)
COPY package*.json ./

# Instalar todas las dependencias para la compilación
RUN npm ci

# Copiar el resto del código fuente
COPY . .

# Construir la aplicación
RUN npm run build

# =============================================================================
# STAGE 2: Runtime - Imagen base de Playwright + App compilada
# =============================================================================
# Usar la imagen oficial de Playwright que incluye navegadores y dependencias
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Copiar solo lo necesario desde la etapa de construcción
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.js ./server.js

# Instalar solo dependencias de PRODUCCIÓN
RUN npm ci --omit=dev

# Crear un usuario no-root para mayor seguridad
RUN groupadd -r appuser && useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app

# Cambiar a usuario no-root
USER appuser

# Variables de entorno
ENV NODE_ENV=production
ENV HOST=0.0.0.0
# Render establece el puerto dinámicamente, pero es bueno tener un fallback
ENV PORT=3000

# Puerto que la aplicación escuchará
EXPOSE 3000

# Comando de inicio
CMD ["node", "server.js"]

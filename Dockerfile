# =============================================================================
# STAGE 1: Builder - Instalar dependencias y compilar
# =============================================================================
FROM node:20-slim AS builder

# Instalar dependencias del sistema necesarias para el build
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar archivos de dependencias primero (mejor cache de Docker)
COPY package*.json ./

# Instalar dependencias de producción y desarrollo
RUN npm ci

# Copiar el resto del código fuente
COPY . .

# Construir la aplicación
RUN npm run build

# =============================================================================
# STAGE 2: Runtime - Imagen base de Playwright + App compilada
# =============================================================================
# Usar la imagen oficial de Playwright que incluye navegadores Chromium
# Coincide con la versión en package.json (playwright@1.56.1)
FROM mcr.microsoft.com/playwright:v1.56.0-jammy

WORKDIR /app

# Copiar solo lo necesario desde builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Instalar solo Playwright browsers (ya vienen en la imagen pero por si acaso)
# RUN npx playwright install chromium --with-deps

# Crear usuario no-root para mayor seguridad
RUN groupadd -r appuser && useradd -r -g appuser appuser && \
    chown -R appuser:appuser /app

# Cambiar a usuario no-root
USER appuser

# Variables de entorno para optimización
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Puerto expuesto (Render asigna dinámicamente via $PORT)
EXPOSE 3000

# Health check para Render
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Comando de inicio
CMD ["node", "server.js"]
/**
 * Servidor Node.js para despliegue en Render
 * Utiliza @hono/node-server para ejecutar la aplicación Hono
 */

import { serve } from '@hono/node-server';
import app from './dist/_worker.js';

const port = parseInt(process.env.PORT || '3000', 10);

console.log(`🚀 Justicia Clara iniciando...`);
console.log(`📍 Puerto: ${port}`);
console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);

serve({
  fetch: app.fetch,
  port
});

console.log(`✅ Servidor corriendo en http://localhost:${port}`);
console.log(`📖 Documentación: https://github.com/tu-repo/justicia-clara`);

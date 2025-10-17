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
  /**
   * --- ADAPTADOR DE ENTORNO ---
   * Esta función intercepta cada solicitud.
   * Crea un objeto `env` que imita al de Cloudflare y le pasa la
   * GEMINI_API_KEY desde el `process.env` de Node.js.
   * La aplicación Hono ahora podrá acceder a ella a través de `c.env`.
   */
  fetch: (req, env, ctx) => {
    const honoEnv = {
      ...env,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY
    };
    return app.fetch(req, honoEnv, ctx);
  },
  port
});

console.log(`✅ Servidor corriendo en http://localhost:${port}`);
console.log(`📖 Documentación: https://github.com/tu-repo/justicia-clara`);

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { renderer } from './renderer'
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import playwright from 'playwright';
import { serveStatic } from '@hono/node-server/serve-static'

// Importar constantes desde archivo separado para mejor mantenibilidad
import { CORTES_MAP, TRIBUNALES_MAP, COMPETENCIA_MAP } from './tribunales';

const app = new Hono()

app.use('/static/*', serveStatic({ root: './dist' }))
app.use(renderer)
app.use('/api/*', cors())

// API especializada en búsqueda por nombre con web scraping real
app.post('/api/buscar-nombre', async (c) => {
  try {
    const requestData = await c.req.json()
    const { 
      tipoPersona, // 'natural' o 'juridica'
      nombres,
      apellidoPaterno, 
      apellidoMaterno,
      nombrePersonaJuridica,
      año,
      competencia,
      tribunal,
      corte
    } = requestData

    console.log('Datos recibidos:', requestVERDE)

    // Validaciones (estas ya funcionan bien)
    if (!tipoPersona || !['natural', 'juridica'].includes(tipoPersona)) {
      return c.json({ error: 'Debe especificar tipo de persona: natural o jurídica' }, 400)
    }
    if (tipoPersona === 'natural') {
      if (!nombres && !apellidoPaterno && !apellidoMaterno) {
        return c.json({ error: 'Para persona natural debe ingresar al menos: nombres, apellido paterno o apellido materno' }, 400)
      }
    } else if (tipoPersona === 'juridica') {
      if (!nombrePersonaJuridica) {
        return c.json({ error: 'Para persona jurídica debe ingresar el nombre de la empresa/organización' }, 400)
      }
    }
    if (!año || !competencia) {
      return c.json({ error: 'Año y competencia son obligatorios' }, 400)
    }
    if (competencia !== 'Corte Suprema') {
      if (!tribunal || !corte) {
        return c.json({ error: `Para ${competencia} se requiere tribunal y corte` }, 400)
      }
    }

    console.log(`Realizando búsqueda por nombre: ${tipoPersona} - Competencia: ${competencia}`)

    // El scraping que ya está funcionando correctamente
    const rawData = await performRealWebScraping(requestData)
    
    if (!rawData) {
      return c.json({ error: 'No se encontró información para los criterios especificados' }, 404)
    }

    // --- LÍNEA CLAVE REVERTIDA ---
    // Leemos la clave de API desde el contexto `c.env` que nuestro `server.js` modificado está proveyendo.
    const translation = await translateLegalText(rawData, (c.env as any)?.GEMINI_API_KEY)

    const searchInfo = tipoPersona === 'natural' 
      ? `${apellidoPaterno || ''} ${apellidoMaterno || ''} ${nombres || ''}`.trim()
      : nombrePersonaJuridica

    return c.json({
      success: true,
      tipoPersona,
      searchInfo,
      competencia,
      tribunal: tribunal || 'Corte Suprema',
      corte: corte || 'Corte Suprema',
      año,
      rawData,
      translation,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Error en búsqueda por nombre:', error)
    return c.json({ 
      error: 'Error interno del servidor',
      details: error instanceof Error ? error.message : 'Error desconocido'
    }, 500)
  }
})

// ============================================
// FUNCIONES DE WEB SCRAPING REAL AL PODER JUDICIAL
// ============================================

// Función principal de web scraping para búsqueda por nombre
async function performRealWebScraping(searchData: any): Promise<string | null> {
  console.log('Iniciando web scraping (Estrategia: Unificada)...');
  let browser: playwright.Browser | null = null; 
  try {
    browser = await playwright.chromium.launch({ headless: true }); 
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    // --- PASOS 1-6: NAVEGACIÓN Y BÚSQUEDA (SIN CAMBIOS) ---
    const url = 'https://oficinajudicialvirtual.pjud.cl/indexN.php';
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    console.log(`Navegando a: ${url}`);
    
    const consultaButtonSelector = 'button.dropbtn[onclick*="accesoConsultaCausas"]';
    await page.waitForSelector(consultaButtonSelector);
    const navigationPromise1 = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
    await page.click(consultaButtonSelector);
    await navigationPromise1;
    console.log('Clic en "Consulta causas".');

    const nombreTabSelector = 'a[href="#BusNombre"]';
    await page.waitForSelector(nombreTabSelector);
    await page.click(nombreTabSelector);
    console.log('Clic en la pestaña "Búsqueda por Nombre".');
    
    const codigoCorte = CORTES_MAP[searchData.corte] || '';
    const codigoTribunal = TRIBUNALES_MAP[searchData.tribunal] || '';
    const codigoCompetencia = COMPETENCIA_MAP[searchData.competencia] || '1';
    await page.selectOption('select#nomCompetencia', codigoCompetencia);
    await page.waitForTimeout(500);
    if (searchData.competencia !== 'Corte Suprema') {
      if (codigoCorte) {
        await page.selectOption('select#corteNom', codigoCorte);
        await page.waitForResponse(response => response.url().includes('/nomTribunal.php'));
      }
      if (codigoTribunal) {
        await page.waitForSelector(`select#nomTribunal option[value="${codigoTribunal}"]`);
        await page.selectOption('select#nomTribunal', codigoTribunal);
      }
    }
    if (searchData.tipoPersona === 'natural') {
      await page.click('input#radioPerNatural');
      await page.fill('input#nomNombre', searchData.nombres || '');
      await page.fill('input#nomApePaterno', (searchData.apellidoPaterno || '').trim());
      await page.fill('input#nomApeMaterno', (searchData.apellidoMaterno || '').trim());
      await page.fill('input#nomEra', searchData.año);
    } else {
      await page.click('input#radioPerJuridica');
      await page.fill('input#nomNombreJur', searchData.nombrePersonaJuridica || '');
      await page.fill('input#nomEraJur', searchData.año);
    }
    
    await page.click('button#btnConConsultaNom');
    console.log('Clic en "Buscar". Esperando resultados...');
    const tablaResultadosSelector = 'table#dtaTableDetalleNombre';
    await page.waitForSelector(tablaResultadosSelector, { state: 'visible' });
    console.log('Tabla de resultados visible.');

    const rows = page.locator('tbody#verDetalleNombre tr');
    const rowCount = await rows.count();

    if (rowCount <= 1) {
        console.log('La búsqueda no arrojó resultados.');
        return null;
    }

    let allDetailsText = "";
    console.log(`Se procesarán ${rowCount - 1} causas.`);

    for (let i = 0; i < rowCount - 1; i++) {
        const row = rows.nth(i);
        
        // --- ¡NUEVA LÓGICA DE EXTRACCIÓN! ---
        // 1. Extraemos los datos del RESUMEN de la tabla principal
        const rol = await row.locator('td').nth(1).innerText();
        const tipoRecurso = await row.locator('td').nth(2).innerText();
        const caratulado = await row.locator('td').nth(3).innerText();
        const fechaIngreso = await row.locator('td').nth(4).innerText();
        const estadoCausa = await row.locator('td').nth(5).innerText();
        const corte = await row.locator('td').nth(6).innerText();

        console.log(`--- Procesando Causa #${i + 1} (ROL: ${rol}) ---`);

        // Construimos la primera parte del texto que le enviaremos a la IA
        let CausaText = `RESUMEN DE LA CAUSA\nROL: ${rol}\nTipo Recurso: ${tipoRecurso}\nCaratulado: ${caratulado}\nFecha Ingreso: ${fechaIngreso}\nEstado Causa: ${estadoCausa}\nCorte: ${corte}\n`;

        // 2. Abrimos el MODAL para obtener el historial detallado
        const detailLink = row.locator('td:first-child a.toggle-modal');
        const onclickCommand = await detailLink.getAttribute('onclick');
        if (!onclickCommand) {
            console.error('No se pudo encontrar el comando onclick. Saltando fila.');
            continue;
        }
            
        await page.evaluate(onclickCommand);
        console.log('Comando JavaScript "onclick" ejecutado.');

        const modalSelector = '#modalDetalleSuprema';
        await page.waitForSelector(modalSelector, { state: 'visible' });
        console.log('Modal de detalle abierto.');
        await page.waitForTimeout(2000);

        // 3. Extraemos solo el HISTORIAL de movimientos del modal
        const modalBodyHTML = await page.locator(`${modalSelector} .modal-body`).innerHTML();
        const $ = cheerio.load(modalBodyHTML);

        CausaText += `\nHISTORIAL DE MOVIMIENTOS:\n`;

        $('#movimientosSup table tbody tr').each((_, element) => {
            const celdas = $(element).find('td');
            const fecha = $(celdas[4]).text().trim();
            const tramite = $(celdas[5]).text().trim();
            const descTramite = $(celdas[6]).text().trim();
            if (fecha && tramite) {
                CausaText += `- ${fecha}: ${tramite} - ${descTramite}\n`;
            }
        });
        
        allDetailsText += `\n\n═════════ Causa ROL: ${rol} ═════════\n\n${CausaText}`;

        // 4. Cerramos el modal
        const closeModalButtonSelector = `${modalSelector} button[data-dismiss="modal"]`;
        await page.click(closeModalButtonSelector);
        await page.waitForSelector(modalSelector, { state: 'hidden' });
        console.log('Modal cerrado.');
    }
    
    if (allDetailsText) {
        console.log('¡ÉXITO DEFINITIVO! Todos los detalles fueron extraídos de forma unificada.');
        return allDetailsText.trim();
    }
    return null;

  } catch (error) {
    console.error('Error durante el web scraping con Playwright:', error);
    if (browser) {
        const page = (await browser.contexts()[0]?.pages())?.[0];
        if (page) await page.screenshot({ path: 'error_screenshot.png' });
    }
    return null;
  } finally {
    if (browser) {
      console.log('Pausa de 10 segundos para revisión antes de cerrar...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      await browser.close();
      console.log('Navegador de Playwright cerrado.');
    }
  }
}
// Parser HTML especializado para resultados del Poder Judicial
function parseJudicialHTML(html: string): any[] | null {
  try {
    const $ = cheerio.load(html);

    // Buscamos la tabla de resultados por su ID específico: 'dtaTableDetalleNombre'
    const tablaResultados = $('table#dtaTableDetalleNombre');

    if (tablaResultados.length === 0) {
      console.log('Parser: No se encontró la tabla de resultados con id "dtaTableDetalleNombre".');
      return null;
    }

    const resultados: { rol: string; caratula: string; estado: string }[] = [];

    // Buscamos el cuerpo de la tabla y recorremos cada fila (<tr>)
    tablaResultados.find('tbody#verDetalleNombre tr').each((index, element) => {
      const celdas = $(element).find('td');

      // IMPORTANTE: Omitimos la última fila que contiene la paginación.
      // La identificamos porque tiene una sola celda con 'colspan'.
      if ($(celdas[0]).attr('colspan')) {
        return; // 'return' aquí es como 'continue' en un bucle forEach de Cheerio
      }

      // Verificamos que la fila tenga suficientes columnas (al menos 7)
      if (celdas.length >= 7) {
        // Extraemos el texto de cada celda según su posición (índice)
        const rol = $(celdas[1]).text().trim();
        const tipoRecurso = $(celdas[2]).text().trim();
        const caratulado = $(celdas[3]).text().trim();
        const estado = $(celdas[5]).text().trim();
        
        // Combinamos el tipo de recurso con el caratulado para tener más contexto
        const caratulaCompleta = `${tipoRecurso} ${caratulado}`;

        if (rol && caratulaCompleta) {
          resultados.push({ 
            rol: rol, 
            caratula: caratulaCompleta, 
            estado: estado 
          });
        }
      }
    });

    if (resultados.length > 0) {
      console.log(`Parser: Se extrajeron ${resultados.length} causas exitosamente.`);
      return resultados;
    }

    console.log('Parser: La tabla de resultados estaba vacía.');
    return null;

  } catch (error) {
    console.error('Error crítico durante el parseo del HTML:', error);
    return null;
  }
}

// Función auxiliar para extraer texto limpio del HTML
function extractTextFromHTML(htmlString: string): string {
  return htmlString
    .replace(/<[^>]*>/g, '') // Remover tags HTML
    .replace(/&nbsp;/g, ' ') // Reemplazar espacios no-break
    .replace(/&amp;/g, '&')  // Decodificar entidades
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

// Formatear resultados múltiples
function formatJudicialResults(resultados: any[], searchData: any): string {
  const searchInfo = searchData.tipoPersona === 'natural' 
    ? `${searchData.apellidoPaterno || ''} ${searchData.apellidoMaterno || ''} ${searchData.nombres || ''}`.trim()
    : searchData.nombrePersonaJuridica

  let formatted = `╔════════════════════════════════════════════════════════════════╗
║          PODER JUDICIAL DE CHILE                               ║
║          RESULTADOS DE BÚSQUEDA POR NOMBRE                     ║
╚════════════════════════════════════════════════════════════════╝

BÚSQUEDA REALIZADA:
Tipo: ${searchData.tipoPersona === 'natural' ? 'Persona Natural' : 'Persona Jurídica'}
${searchData.tipoPersona === 'natural' ? `Nombre: ${searchInfo}` : `Razón Social: ${searchInfo}`}
Año: ${searchData.año}
Competencia: ${searchData.competencia}
${searchData.tribunal ? `Tribunal: ${searchData.tribunal}` : ''}
${searchData.corte ? `Corte: ${searchData.corte}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CAUSAS ENCONTRADAS: ${resultados.length}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`

  resultados.forEach((resultado, index) => {
    formatted += `${index + 1}. ROL: ${resultado.rol}
   CARÁTULA: ${resultado.caratula}
   ESTADO: ${resultado.estado}

`
  })

  formatted += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Información actualizada al: ${new Date().toLocaleString('es-CL')}
Fuente: Poder Judicial de Chile - Oficina Judicial Virtual`

  return formatted
}

// Formatear resultado único
function formatSingleResult(html: string, searchData: any): string {
  const text = extractTextFromHTML(html)
  
  return `╔════════════════════════════════════════════════════════════════╗
║          PODER JUDICIAL DE CHILE                               ║
║          DETALLE DE CAUSA                                      ║
╚════════════════════════════════════════════════════════════════╝

${text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Información actualizada al: ${new Date().toLocaleString('es-CL')}
Fuente: Poder Judicial de Chile`
}

// Función de datos simulados mejorada para búsqueda por nombre
function generateSimulatedSearchByName(searchData: any): string {
  const searchInfo = searchData.tipoPersona === 'natural' 
    ? `${searchData.apellidoPaterno || ''} ${searchData.apellidoMaterno || ''} ${searchData.nombres || ''}`.trim()
    : searchData.nombrePersonaJuridica

  // Generar entre 1-3 resultados simulados
  const numResultados = Math.floor(Math.random() * 3) + 1
  const causaTypes = {
    'Civil': ['INDEMNIZACIÓN DE PERJUICIOS', 'COBRO DE PESOS', 'INCUMPLIMIENTO DE CONTRATO', 'NULIDAD DE COMPRAVENTA'],
    'Laboral': ['DESPIDO INJUSTIFICADO', 'COBRO DE REMUNERACIONES', 'ACCIDENTE LABORAL', 'TÉRMINO DE RELACIÓN LABORAL'],
    'Cobranza': ['COBRO PREVISIONAL', 'COBRO COTIZACIONES', 'IMPOSICIONES IMPAGAS']
  }
  
  const estados = ['En tramitación', 'Terminada', 'Suspendida', 'Archivada']
  const competenciaKey = searchData.competencia === 'Corte de Apelaciones' ? 'Civil' : searchData.competencia
  const caratulas = causaTypes[competenciaKey as keyof typeof causaTypes] || causaTypes['Civil']

  let resultadosSimulados = []
  
  for (let i = 0; i < numResultados; i++) {
    const rolPrefix = competenciaKey === 'Laboral' ? 'L' : competenciaKey === 'Cobranza' ? 'CB' : 'C'
    const rolNumero = Math.floor(Math.random() * 9000) + 1000
    
    resultadosSimulados.push({
      rol: `${rolPrefix}-${rolNumero}-${searchData.año}`,
      caratula: caratulas[Math.floor(Math.random() * caratulas.length)],
      estado: estados[Math.floor(Math.random() * estados.length)]
    })
  }

  return formatJudicialResults(resultadosSimulados, searchData)
}

// Función principal para extraer datos por RIT (ROL) - COMENTADA PARA ENFOQUE
/* 
============================================
FUNCIONES COMENTADAS - NO USADAS EN ESTA VERSIÓN
============================================
Estas funciones están disponibles pero comentadas para enfocar 
la aplicación únicamente en búsqueda por nombre

async function extractJudicialDataByRIT(
  rol: string, 
  tribunal: string, 
  competencia: string,
  tipo?: string,
  libro?: string
): Promise<string | null> {
  try {
    // Simular demora de red (eliminar cuando se implemente web scraping real)
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000))

    // IMPLEMENTACIÓN SIMULADA - Reemplazar con web scraping real
    const simulatedData = generateSimulatedJudicialData(rol, tribunal, competencia)
    
    // ============================================
    // IMPLEMENTACIÓN REAL CON WEB SCRAPING
    // ============================================
    
    El Poder Judicial de Chile SÍ permite consultas programáticas a través de su sitio web oficial.
    No existe API REST pública, pero el sitio web tiene formularios accesibles para consultas.
    
    URL Base: https://oficinajudicialvirtual.pjud.cl/
    
    Método 1: Consulta Unificada (Recomendado)
    - URL: https://oficinajudicialvirtual.pjud.cl/CIVILWEB/busqueda.do
    - Método: POST
    - Headers requeridos:
      * Content-Type: application/x-www-form-urlencoded
      * User-Agent: Mozilla/5.0 (compatible; JusticiaClara/1.0)
      * Referer: https://oficinajudicialvirtual.pjud.cl/
    
    Parámetros del formulario:
    {
      competencia: 'CIVIL' | 'FAMILIA' | 'LABORAL' | 'COBRANZA' | 'PENAL' | 'GARANTIA',
      tribunal: código del tribunal (ej: 'C.A.STGO'),
      rolNumero: número del ROL (ej: '1234'),
      rolAnio: año del ROL (ej: '2024'),
      tipo: tipo de causa (opcional),
      libro: libro/tipo (opcional)
    }
    
    Ejemplo de implementación:
    
    const response = await fetch('https://oficinajudicialvirtual.pjud.cl/CIVILWEB/busqueda.do', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; JusticiaClara/1.0)',
        'Referer': 'https://oficinajudicialvirtual.pjud.cl/'
      },
      body: new URLSearchParams({
        competencia: competencia.toUpperCase(),
        tribunal: tribunal,
        rolNumero: rol.split('-')[1] || rol,
        rolAnio: rol.split('-')[2] || new Date().getFullYear().toString()
      })
    })
    
    const html = await response.text()
    
    // Parsear HTML para extraer información
    // Buscar patrones comunes:
    // - <div class="detalleCausa">
    // - <table class="tablaCausas">
    // - Información de litigantes, carátula, estado procesal, etc.
    
    return parseJudicialHTML(html)
    
    // ============================================
    // IMPORTANTE: Web Scraping Responsable
    // ============================================
    // 1. Respetar robots.txt del sitio
    // 2. Implementar rate limiting (máximo 1 request por segundo)
    // 3. Usar User-Agent identificable
    // 4. Cachear resultados cuando sea posible
    // 5. Manejar errores gracefully
    // 6. No saturar el servidor con múltiples requests simultáneos
    
    return simulatedData

  } catch (error) {
    console.error('Error extrayendo datos judiciales:', error)
    return null
  }
}

// Función para extraer datos por nombre de litigante
async function extractJudicialDataByName(
  nombres: string | undefined,
  apellidoPaterno: string | undefined,
  apellidoMaterno: string | undefined,
  tribunal: string,
  competencia: string
): Promise<string | null> {
  try {
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000))

    // IMPLEMENTACIÓN SIMULADA
    const fullName = `${apellidoPaterno || ''} ${apellidoMaterno || ''} ${nombres || ''}`.trim()
    const simulatedData = generateSimulatedJudicialDataByName(fullName, tribunal, competencia)
    
    // IMPLEMENTACIÓN REAL:
    
    const response = await fetch('https://oficinajudicialvirtual.pjud.cl/CIVILWEB/busquedaPorNombre.do', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; JusticiaClara/1.0)',
        'Referer': 'https://oficinajudicialvirtual.pjud.cl/'
      },
      body: new URLSearchParams({
        competencia: competencia.toUpperCase(),
        tribunal: tribunal,
        nombres: nombres || '',
        apellidoPaterno: apellidoPaterno || '',
        apellidoMaterno: apellidoMaterno || ''
      })
    })
    
    const html = await response.text()
    return parseJudicialHTML(html)
    
    return simulatedData

  } catch (error) {
    console.error('Error extrayendo datos por nombre:', error)
    return null
  }
}

// Función para extraer datos por fecha
async function extractJudicialDataByDate(
  fechaDesde: string | undefined,
  fechaHasta: string | undefined,
  tribunal: string,
  competencia: string
): Promise<string | null> {
  try {
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000))

    // IMPLEMENTACIÓN SIMULADA
    const simulatedData = generateSimulatedJudicialDataByDate(fechaDesde, fechaHasta, tribunal, competencia)
    
    // IMPLEMENTACIÓN REAL:
    
    const response = await fetch('https://oficinajudicialvirtual.pjud.cl/CIVILWEB/busquedaPorFecha.do', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; JusticiaClara/1.0)',
        'Referer': 'https://oficinajudicialvirtual.pjud.cl/'
      },
      body: new URLSearchParams({
        competencia: competencia.toUpperCase(),
        tribunal: tribunal,
        fechaDesde: fechaDesde || '',
        fechaHasta: fechaHasta || ''
      })
    })
    
    const html = await response.text()
    return parseJudicialHTML(html)
    
    return simulatedData

  } catch (error) {
    console.error('Error extrayendo datos por fecha:', error)
    return null
  }
}

// Función para extraer datos por RUC
async function extractJudicialDataByRUC(
  ruc: string,
  tribunal: string
): Promise<string | null> {
  try {
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000))

    // IMPLEMENTACIÓN SIMULADA
    const simulatedData = generateSimulatedJudicialDataByRUC(ruc, tribunal)
    
    // IMPLEMENTACIÓN REAL:
    
    const response = await fetch('https://oficinajudicialvirtual.pjud.cl/CIVILWEB/busquedaPorRUC.do', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; JusticiaClara/1.0)',
        'Referer': 'https://oficinajudicialvirtual.pjud.cl/'
      },
      body: new URLSearchParams({
        tribunal: tribunal,
        ruc: ruc
      })
    })
    
    const html = await response.text()
    return parseJudicialHTML(html)
    
    return simulatedData

  } catch (error) {
    console.error('Error extrayendo datos por RUC:', error)
    return null
  }
}

// ============================================
// FUNCIONES DE GENERACIÓN DE DATOS SIMULADOS
// ============================================

function generateSimulatedJudicialData(rol: string, tribunal: string, competencia: string): string {
  const causaTypes = {
    'civil': ['INDEMNIZACIÓN DE PERJUICIOS', 'COBRO DE PESOS', 'INCUMPLIMIENTO DE CONTRATO', 'NULIDAD DE COMPRAVENTA'],
    'laboral': ['DESPIDO INJUSTIFICADO', 'COBRO DE REMUNERACIONES', 'ACCIDENTE LABORAL', 'TÉRMINO DE RELACIÓN LABORAL'],
    'familia': ['ALIMENTOS', 'TUICIÓN', 'RÉGIMEN COMUNICACIONAL', 'VIOLENCIA INTRAFAMILIAR'],
    'penal': ['LESIONES MENOS GRAVES', 'ROBO CON INTIMIDACIÓN', 'ESTAFA', 'HURTO SIMPLE'],
    'cobranza': ['COBRO PREVISIONAL', 'COBRO COTIZACIONES', 'IMPOSICIONES IMPAGAS'],
    'garantia': ['AUDIENCIA DE CONTROL DE DETENCIÓN', 'MEDIDAS CAUTELARES', 'PRISIÓN PREVENTIVA']
  }
  
  const estados = ['En tramitación', 'Terminada', 'Suspendida', 'Archivada']
  const randomEstado = estados[Math.floor(Math.random() * estados.length)]
  
  const comp = competencia.toLowerCase()
  const caratulas = causaTypes[comp as keyof typeof causaTypes] || causaTypes['civil']
  const randomCaratula = caratulas[Math.floor(Math.random() * caratulas.length)]
  
  return `╔════════════════════════════════════════════════════════════════╗
║          PODER JUDICIAL DE CHILE                               ║
║          ${tribunal.padEnd(58)}║
╚════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INFORMACIÓN DE LA CAUSA

ROL: ${rol}
COMPETENCIA: ${competencia.toUpperCase()}
CARÁTULA: ${randomCaratula}
ESTADO PROCESAL: ${randomEstado}
FECHA INGRESO: ${new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toLocaleDateString('es-CL')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PARTES DEL PROCESO

DEMANDANTE / QUERELLANTE:
  • Nombre: JUAN CARLOS PÉREZ GONZÁLEZ
  • RUT: 12.345.678-9
  • Representante Legal: MARÍA FERNANDA TORRES VALDÉS
  • Domicilio: Av. Libertador Bernardo O'Higgins 1234, Santiago

DEMANDADO / QUERELLADO:
  • Nombre: ${comp === 'laboral' ? 'EMPRESA CONSTRUCTORA ABC LTDA' : 
              comp === 'familia' ? 'MARÍA ELENA SILVA CASTRO' : 
              'PEDRO ANTONIO RAMÍREZ LÓPEZ'}
  • RUT: ${comp === 'laboral' ? '76.543.210-K' : '15.678.432-1'}
  • Representante Legal: CARLOS EDUARDO MUÑOZ SÁEZ
  • Domicilio: Calle Principal 567, Santiago

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ÚLTIMA ACTUACIÓN

FECHA: ${new Date().toLocaleDateString('es-CL')} - ${new Date().toLocaleTimeString('es-CL')}

ACTUACIÓN:
${randomEstado === 'En tramitación' 
  ? 'Se cita a las partes a audiencia de juicio para el día 15 de noviembre de 2024 a las 09:00 horas en la Sala N° 3 del tribunal. Se requiere la comparecencia personal de las partes con sus respectivos medios de prueba.' 
  : randomEstado === 'Terminada'
  ? 'Se pronuncia sentencia definitiva acogiendo parcialmente la demanda. Se condena al demandado al pago de la suma de $5.000.000 (cinco millones de pesos) más reajustes e intereses. Costas por el demandado.'
  : randomEstado === 'Suspendida'
  ? 'Se decreta suspensión del procedimiento por común acuerdo de las partes según solicitud presentada el día de hoy. Se fija nueva fecha de audiencia para dentro de 60 días hábiles.'
  : 'Se archiva la causa por inactividad de las partes según lo dispuesto en el artículo 153 del Código de Procedimiento Civil. Sin costas.'}

MINISTRO DE FE: PATRICIA ANDREA CONTRERAS ROJAS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RESOLUCIONES IMPORTANTES

1. Resolución N° 1 (${new Date(2024, 0, 15).toLocaleDateString('es-CL')}):
   Se tiene por interpuesta la demanda. Se confiere traslado al demandado
   por el término legal para que conteste la demanda.

2. Resolución N° 3 (${new Date(2024, 2, 10).toLocaleDateString('es-CL')}):
   AUTO DE PRUEBA - Se reciben las siguientes probanzas:
   • Prueba testimonial (3 testigos)
   • Prueba documental (15 documentos)
   • Prueba pericial (1 perito contable)

3. Resolución N° 5 (${new Date(2024, 4, 20).toLocaleDateString('es-CL')}):
   Se acepta solicitud de medida cautelar. Se decreta prohibición de
   celebrar actos y contratos sobre bien raíz ubicado en...

4. Resolución N° 7 (${new Date(2024, 6, 5).toLocaleDateString('es-CL')}):
   CITACIÓN A AUDIENCIA - Se cita a las partes para audiencia de juicio
   el día 15/11/2024 a las 09:00 hrs.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PRÓXIMAS DILIGENCIAS

${randomEstado === 'En tramitación' 
  ? `• Audiencia de juicio: 15/11/2024 a las 09:00 hrs (Sala N° 3)
• Presentación de alegatos escritos: hasta el 10/11/2024
• Ratificación de pericias: 08/11/2024 a las 15:00 hrs` 
  : 'No hay diligencias pendientes'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ESTADO ACTUAL

La causa se encuentra ${randomEstado.toLowerCase()} según el registro oficial
del tribunal. Última actualización: ${new Date().toLocaleString('es-CL')}

Para más información, puede consultar directamente en las oficinas del
tribunal o a través del sitio web oficial del Poder Judicial.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMPORTANTE: Esta consulta es referencial. Para efectos legales, siempre
verifique la información directamente en el tribunal correspondiente.`
}

function generateSimulatedJudicialDataByName(
  fullName: string,
  tribunal: string,
  competencia: string
): string {
  return `╔════════════════════════════════════════════════════════════════╗
║          PODER JUDICIAL DE CHILE                               ║
║          RESULTADOS DE BÚSQUEDA POR NOMBRE                     ║
╚════════════════════════════════════════════════════════════════╝

CRITERIO DE BÚSQUEDA: ${fullName}
TRIBUNAL: ${tribunal}
COMPETENCIA: ${competencia.toUpperCase()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CAUSAS ENCONTRADAS: 2

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CAUSA N° 1

ROL: C-${Math.floor(Math.random() * 9000) + 1000}-2024
CARÁTULA: COBRO DE PESOS
ESTADO: En tramitación
CALIDAD: Demandante
FECHA INGRESO: ${new Date(2024, 3, 15).toLocaleDateString('es-CL')}

ÚLTIMA ACTUACIÓN:
Se cita a audiencia preparatoria para el 20/11/2024 a las 10:00 hrs.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CAUSA N° 2

ROL: C-${Math.floor(Math.random() * 9000) + 1000}-2023
CARÁTULA: INDEMNIZACIÓN DE PERJUICIOS
ESTADO: Terminada
CALIDAD: Demandado
FECHA INGRESO: ${new Date(2023, 8, 10).toLocaleDateString('es-CL')}

ÚLTIMA ACTUACIÓN:
Se pronuncia sentencia definitiva rechazando la demanda. Sin costas.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Información actualizada al: ${new Date().toLocaleString('es-CL')}`
}

function generateSimulatedJudicialDataByDate(
  fechaDesde: string | undefined,
  fechaHasta: string | undefined,
  tribunal: string,
  competencia: string
): string {
  return `╔════════════════════════════════════════════════════════════════╗
║          PODER JUDICIAL DE CHILE                               ║
║          RESULTADOS DE BÚSQUEDA POR FECHA                      ║
╚════════════════════════════════════════════════════════════════╝

PERÍODO: ${fechaDesde || 'Sin fecha inicio'} - ${fechaHasta || 'Sin fecha término'}
TRIBUNAL: ${tribunal}
COMPETENCIA: ${competencia.toUpperCase()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CAUSAS ENCONTRADAS EN EL PERÍODO: 3

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ROL: C-${Math.floor(Math.random() * 9000) + 1000}-2024
   CARÁTULA: COBRO DE PESOS
   ESTADO: En tramitación
   FECHA: ${fechaDesde || new Date().toLocaleDateString('es-CL')}

2. ROL: C-${Math.floor(Math.random() * 9000) + 1000}-2024
   CARÁTULA: INDEMNIZACIÓN DE PERJUICIOS
   ESTADO: En tramitación
   FECHA: ${fechaDesde || new Date().toLocaleDateString('es-CL')}

3. ROL: L-${Math.floor(Math.random() * 9000) + 1000}-2024
   CARÁTULA: DESPIDO INJUSTIFICADO
   ESTADO: Archivada
   FECHA: ${fechaDesde || new Date().toLocaleDateString('es-CL')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Información actualizada al: ${new Date().toLocaleString('es-CL')}`
}

function generateSimulatedJudicialDataByRUC(ruc: string, tribunal: string): string {
  return `╔════════════════════════════════════════════════════════════════╗
║          PODER JUDICIAL DE CHILE                               ║
║          CONSULTA POR RUC                                      ║
╚════════════════════════════════════════════════════════════════╝

RUC: ${ruc}
TRIBUNAL: ${tribunal}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INFORMACIÓN DE LA CAUSA

ROL: C-${Math.floor(Math.random() * 9000) + 1000}-2024
RUC: ${ruc}
CARÁTULA: INCUMPLIMIENTO DE CONTRATO
ESTADO PROCESAL: En tramitación
FECHA INGRESO: ${new Date(2024, 1, 20).toLocaleDateString('es-CL')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PARTES DEL PROCESO

DEMANDANTE: COMERCIAL DISTRIBUIDORA XYZ LTDA
RUT: 77.123.456-7

DEMANDADO: IMPORTADORA NACIONAL ABC S.A.
RUT: 88.765.432-1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ÚLTIMA ACTUACIÓN

FECHA: ${new Date().toLocaleDateString('es-CL')}
ACTUACIÓN: Se ordena la comparecencia de ambas partes para audiencia
de conciliación el día 25/11/2024 a las 11:00 hrs.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Información actualizada al: ${new Date().toLocaleString('es-CL')}`
}

*/ // FIN DE FUNCIONES COMENTADAS

// Función para traducir texto legal con Gemini
async function translateLegalText(legalText: string, apiKey?: string): Promise<string> {
  if (!apiKey) {
    // Fallback sin AI - respuesta básica
    return generateBasicTranslation(legalText)
  }

  try {
    // Importar Gemini dinámicamente (compatible con Cloudflare Workers)
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `
Eres un traductor jurídico especializado. Tu tarea es traducir información judicial técnica a lenguaje simple y comprensible para el ciudadano común.

Instrucciones:
1. Mantén la información factual exacta
2. Explica términos jurídicos en lenguaje simple
3. Estructura la respuesta de forma clara
4. Incluye una explicación de qué significa cada estado procesal
5. Sugiere posibles próximos pasos

Formato de respuesta requerido:
**RESUMEN DE TU CAUSA**

**¿Qué tipo de caso es?**
[Explicación simple del tipo de causa]

**¿Quiénes están involucrados?**
[Explicación de las partes]

**¿En qué estado se encuentra?**
[Estado actual explicado en lenguaje simple]

**¿Qué ha pasado hasta ahora?**
[Resumen de actuaciones importantes]

**¿Qué viene después?**
[Próximos pasos explicados]

**¿Qué significa esto para ti?**
[Implicaciones prácticas]

---

TEXTO LEGAL A TRADUCIR:
${legalText}
`

    const result = await model.generateContent(prompt)
    const response = await result.response
    return response.text()

  } catch (error) {
    console.error('Error con Gemini AI:', error)
    return generateBasicTranslation(legalText)
  }
}

// Traducción básica sin IA (fallback)
function generateBasicTranslation(legalText: string): string {
  const lines = legalText.split('\n')
  
  // Extraer información básica
  const rol = lines.find(l => l.includes('ROL:'))?.split(':')[1]?.trim() || 'No disponible'
  const caratula = lines.find(l => l.includes('CARÁTULA:'))?.split(':')[1]?.trim() || 'No disponible'
  const estado = lines.find(l => l.includes('ESTADO PROCESAL:'))?.split(':')[1]?.trim() || 'No disponible'
  
  return `**RESUMEN DE TU CAUSA**

**¿Qué tipo de caso es?**
Tu causa "${caratula}" es un proceso judicial que se está tramitando en los tribunales.

**Estado actual: ${estado}**
${estado === 'En tramitación' ? 'Tu causa está siendo procesada y aún no ha terminado.' :
  estado === 'Terminada' ? 'Tu causa ya fue resuelta por el tribunal.' :
  estado === 'Suspendida' ? 'Tu causa está temporalmente detenida.' :
  'Tu causa está archivada en el tribunal.'}

**¿Qué significa esto?**
- Si está "en tramitación": El proceso judicial está avanzando
- Si está "terminada": Ya hay una resolución final
- Si está "suspendida": Hay una pausa temporal en el proceso
- Si está "archivada": El expediente está guardado sin movimiento

**Información importante:**
Esta es una explicación básica. Para entender completamente tu situación legal, es recomendable consultar con un abogado que pueda revisar los detalles específicos de tu caso.

**Próximos pasos sugeridos:**
1. Revisa regularmente el estado de tu causa
2. Mantén contacto con tu representante legal
3. Cumple con las citaciones y requerimientos del tribunal`
}

// Página principal con diseño mejorado
app.get('/', (c) => {
  return c.render(
    <div className="container mx-auto px-4 max-w-7xl">
      {/* Header moderno */}
      <header className="main-header">
        <h1>
          <i className="fas fa-balance-scale"></i> Justicia Clara
        </h1>
        <p>Comprende el estado de tu causa judicial en lenguaje simple</p>
      </header>

      {/* Título de búsqueda enfocada */}
      <div className="search-header">
        <h2>
          <i className="fas fa-user-search"></i>
          Búsqueda por Nombre de Litigante
        </h2>
        <p className="search-description">
          Encuentra causas judiciales buscando por el nombre de personas naturales o jurídicas involucradas
        </p>
      </div>

      {/* Formulario de búsqueda por nombre */}
      <div className="search-container">
        <form id="form-busqueda-nombre">
          {/* Selector de tipo de persona */}
          <div className="form-group">
            <label className="form-label-large">
              <i className="fas fa-user-tag"></i>
              Tipo de Persona
            </label>
            <div className="radio-group">
              <label className="radio-option">
                <input type="radio" name="tipo-persona" value="natural" checked />
                <span className="radio-text">
                  <i className="fas fa-user"></i>
                  Persona Natural
                </span>
              </label>
              <label className="radio-option">
                <input type="radio" name="tipo-persona" value="juridica" />
                <span className="radio-text">
                  <i className="fas fa-building"></i>
                  Persona Jurídica
                </span>
              </label>
            </div>
          </div>

          {/* Campos para Persona Natural */}
          <div id="campos-persona-natural">
            <div className="form-section">
              <h3><i className="fas fa-user-circle"></i> Datos de Persona Natural</h3>
              <div className="form-row">
                <div className="form-group">
                  <label>Nombres</label>
                  <input
                    type="text"
                    name="nombres"
                    className="form-input"
                    placeholder="Ej: Juan Carlos"
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Apellido Paterno</label>
                  <input
                    type="text"
                    name="apellido-paterno"
                    className="form-input"
                    placeholder="Ej: González"
                  />
                </div>

                <div className="form-group">
                  <label>Apellido Materno</label>
                  <input
                    type="text"
                    name="apellido-materno"
                    className="form-input"
                    placeholder="Ej: Pérez"
                  />
                </div>
              </div>
              <div className="help-text-large">
                <i className="fas fa-info-circle"></i>
                Para persona natural debe completar al menos un campo (nombres, apellido paterno o apellido materno)
              </div>
            </div>
          </div>

          {/* Campos para Persona Jurídica */}
          <div id="campos-persona-juridica" style="display: none;">
            <div className="form-section">
              <h3><i className="fas fa-building"></i> Datos de Persona Jurídica</h3>
              <div className="form-group">
                <label>Nombre de la Persona Jurídica</label>
                <input
                  type="text"
                  name="nombre-persona-juridica"
                  className="form-input"
                  placeholder="Ej: EMPRESA CONSTRUCTORA ABC LTDA"
                />
                <span className="help-text">Razón social completa de la empresa u organización</span>
              </div>
            </div>
          </div>

          {/* Campos comunes */}
          <div className="form-section">
            <h3><i className="fas fa-cog"></i> Parámetros de Búsqueda</h3>
            
            <div className="form-row">
              <div className="form-group">
                <label>Año *</label>
                <select name="año" className="form-input" required>
                  <option value="">Seleccione Año</option>
                  <option value="2025">2025</option>
                  <option value="2024">2024</option>
                  <option value="2023">2023</option>
                  <option value="2022">2022</option>
                  <option value="2021">2021</option>
                  <option value="2020">2020</option>
                  <option value="2019">2019</option>
                  <option value="2018">2018</option>
                </select>
              </div>

              <div className="form-group">
                <label>Competencia *</label>
                <select name="competencia" className="form-input" id="competencia-select" required>
                  <option value="">Seleccione Competencia</option>
                  <option value="Corte Suprema">Corte Suprema</option>
                  <option value="Corte de Apelaciones">Corte de Apelaciones</option>
                  <option value="Civil">Civil</option>
                  <option value="Laboral">Laboral</option>
                  <option value="Cobranza">Cobranza</option>
                  <option value="Penal">Penal</option>
                </select>
              </div>
            </div>

            {/* Campos dependientes - se habilitan según competencia */}
            <div id="campos-dependientes" style="display: none;">
              <div className="form-row">
                <div className="form-group">
                  <label>Tribunal</label>
                  <select name="tribunal" className="form-input" id="tribunal-select" disabled>
                    <option value="">Seleccione primero Competencia</option>
                  </select>
                  <span className="help-text">Apartado 3 - Dependiente de Competencia</span>
                </div>

                <div className="form-group">
                  <label>Corte</label>
                  <select name="corte" className="form-input" id="corte-select" disabled>
                    <option value="">Seleccione primero Competencia</option>
                  </select>
                  <span className="help-text">Apartado 4 - Dependiente de Competencia</span>
                </div>
              </div>
            </div>

            <div className="info-box">
              <i className="fas fa-lightbulb"></i>
              <div>
                <strong>Dependencias del formulario:</strong>
                <ul>
                  <li><strong>Corte Suprema:</strong> No requiere tribunal ni corte</li>
                  <li><strong>Otras competencias:</strong> Requieren seleccionar tribunal y corte</li>
                  <li><strong>Tribunales y cortes</strong> se cargan automáticamente según la competencia</li>
                </ul>
              </div>
            </div>
          </div>

          <button type="submit" className="btn-primary btn-large">
            <i className="fas fa-search"></i>
            Realizar Búsqueda por Nombre
          </button>
        </form>
      </div>

      {/* Loading indicator mejorado */}
      <div id="loading" className="loading-container hidden">
        <div className="loading-spinner"></div>
        <p className="loading-text">Consultando información del Poder Judicial...</p>
        <p className="loading-subtext">Esto puede tomar hasta 20 segundos</p>
      </div>

      {/* Error display mejorado */}
      <div id="error" className="alert alert-error hidden">
        <i className="fas fa-exclamation-circle"></i>
        <div className="alert-content">
          <h3>Error en la Consulta</h3>
          <p>Error message here</p>
        </div>
      </div>

      {/* Results section */}
      <div id="results" className="hidden">
        {/* Content will be populated by JavaScript */}
      </div>

      {/* Features section mejorado */}
      <div className="features-grid">
        <div className="feature-card">
          <div className="feature-icon blue">
            <i className="fas fa-sync-alt"></i>
          </div>
          <h3>Información Actualizada</h3>
          <p>Datos extraídos directamente del portal oficial del Poder Judicial de Chile</p>
        </div>

        <div className="feature-card">
          <div className="feature-icon green">
            <i className="fas fa-robot"></i>
          </div>
          <h3>Traducción con IA</h3>
          <p>Inteligencia artificial traduce términos legales complejos a lenguaje simple y comprensible</p>
        </div>

        <div className="feature-card">
          <div className="feature-icon purple">
            <i className="fas fa-shield-alt"></i>
          </div>
          <h3>Privacidad Total</h3>
          <p>No almacenamos ninguna información personal ni registros de sus consultas</p>
        </div>
      </div>

      {/* Legal disclaimer mejorado */}
      <div className="alert alert-warning">
        <i className="fas fa-exclamation-triangle"></i>
        <div className="alert-content">
          <h3>Aviso Legal Importante</h3>
          <p>
            Esta herramienta es solo de apoyo informativo y <strong>no reemplaza la asesoría de un abogado profesional</strong>. 
            La información proporcionada puede contener errores o estar desactualizada. 
            Para decisiones legales importantes, siempre consulte con un profesional del derecho.
          </p>
        </div>
      </div>


    </div>
  )
})

export default app

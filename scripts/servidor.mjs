#!/usr/bin/env node
// Servidor local para la página de arrastrar y soltar. Solo escucha en 127.0.0.1:
// la solicitud se procesa en el navegador y nunca sale del ordenador.
// Uso: npm run app  →  http://localhost:5174
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PUERTO = Number(process.env.PUERTO || 5174);
const PERMITIDOS = ['web/', 'src/', 'packs/', 'ejemplos/', 'node_modules/pdfjs-dist/build/', 'node_modules/pdfjs-dist/standard_fonts/', 'node_modules/docx/dist/'];
const TIPOS = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.map': 'application/json' };

createServer(async (req, res) => {
  try {
    let ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    if (ruta === '' ) ruta = 'web/index.html';
    const rel = normalize(ruta).replace(/\\/g, '/');
    if (rel.startsWith('..') || !PERMITIDOS.some((p) => rel.startsWith(p))) { res.writeHead(404).end('No encontrado'); return; }
    const abs = join(RAIZ, rel);
    if (!(await stat(abs)).isFile()) throw new Error('no es un fichero');
    res.writeHead(200, { 'Content-Type': TIPOS[extname(abs)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(await readFile(abs));
  } catch {
    res.writeHead(404).end('No encontrado');
  }
}).listen(PUERTO, '127.0.0.1', () => console.log(`Abra http://localhost:${PUERTO} en su navegador (Ctrl+C para cerrar).`));

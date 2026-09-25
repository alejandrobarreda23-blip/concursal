#!/usr/bin/env node
// Construye la versión estática de la página en dist/ (para Netlify u otro alojamiento estático).
// Reproduce la misma estructura de rutas que sirve scripts/servidor.mjs, con index.html en la raíz.
// La solicitud se sigue leyendo en el navegador: el sitio no recibe ni guarda ningún PDF.
// Uso: npm run build
import { cp, mkdir, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(RAIZ, 'dist');

const DIRECTORIOS = ['web', 'src', 'packs', 'node_modules/pdfjs-dist/standard_fonts'];
const FICHEROS = [
  'node_modules/pdfjs-dist/build/pdf.mjs',
  'node_modules/pdfjs-dist/build/pdf.worker.mjs',
  'node_modules/docx/dist/index.mjs',
];

await rm(DIST, { recursive: true, force: true });
for (const d of DIRECTORIOS) await cp(join(RAIZ, d), join(DIST, d), { recursive: true });
for (const f of FICHEROS) {
  await mkdir(join(DIST, f, '..'), { recursive: true });
  await copyFile(join(RAIZ, f), join(DIST, f));
}
await copyFile(join(RAIZ, 'web/index.html'), join(DIST, 'index.html'));
console.log('Sitio estático generado en dist/');

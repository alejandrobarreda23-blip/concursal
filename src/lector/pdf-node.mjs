// Solo Node: lectura de un PDF del disco con pdf.js (build legacy).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extraerTextoPdf } from './texto-pdf.mjs';

export async function textoDePdf(ruta) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const require = createRequire(import.meta.url);
  GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const fuentes = require.resolve('pdfjs-dist/package.json').replace('package.json', 'standard_fonts/');
  const conFuentes = (opts) => getDocument({ ...opts, standardFontDataUrl: fuentes, verbosity: 0 });
  return extraerTextoPdf(new Uint8Array(readFileSync(ruta)), conFuentes);
}

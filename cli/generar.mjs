#!/usr/bin/env node
// Uso: node cli/generar.mjs <expediente.json> [--salida carpeta] [--docx]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { generarAuto } from '../src/index.mjs';

const args = process.argv.slice(2);
const ruta = args.find((a) => !a.startsWith('--'));
if (!ruta) { console.error('Uso: node cli/generar.mjs <expediente.json> [--salida carpeta] [--docx]'); process.exit(2); }
const iSal = args.indexOf('--salida');
const salida = iSal >= 0 ? args[iSal + 1] : 'salida';
const quiereDocx = args.includes('--docx');

const expediente = JSON.parse(readFileSync(ruta, 'utf8'));
const r = generarAuto(expediente);
const base = basename(ruta, '.json');
mkdirSync(salida, { recursive: true });

console.log(`Estado: ${r.estado}${r.variante ? ` · variante: ${r.variante}` : ''}`);
for (const m of r.errores || r.motivos || []) console.log(`  - ${m}`);
if (r.controles) {
  for (const f of r.controles.fallos) console.log(`  ✗ ${f}`);
  for (const a of r.controles.avisos) console.log(`  ! ${a}`);
}
if (r.ir) writeFileSync(join(salida, `${base}.ir.json`), JSON.stringify(r.ir, null, 2));
if (!r.texto) process.exit(1);

writeFileSync(join(salida, `${base}.txt`), r.texto);
console.log(`Texto: ${join(salida, `${base}.txt`)}  (hash IR ${r.ir.hash_ir.slice(0, 12)})`);
if (quiereDocx) {
  const { aDocx } = await import('../src/docx.mjs');
  writeFileSync(join(salida, `${base}.docx`), await aDocx(r.documento));
  console.log(`Word:  ${join(salida, `${base}.docx`)}`);
}

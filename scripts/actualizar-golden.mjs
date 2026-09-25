#!/usr/bin/env node
// Regenera los textos de referencia (golden) a partir de los ejemplos.
// Solo debe usarse cuando un cambio en el texto es intencionado y revisado.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { generarAuto } from '../src/index.mjs';

mkdirSync('test/golden', { recursive: true });
for (const f of readdirSync('ejemplos').filter((x) => x.endsWith('.json'))) {
  const r = generarAuto(JSON.parse(readFileSync(`ejemplos/${f}`, 'utf8')));
  const nombre = f.replace('.json', '');
  writeFileSync(`test/golden/${nombre}.json`, JSON.stringify({ estado: r.estado, variante: r.variante ?? null, hash_ir: r.ir?.hash_ir ?? null, motivos: r.motivos ?? [] }, null, 2) + '\n');
  if (r.texto) writeFileSync(`test/golden/${nombre}.txt`, r.texto);
  console.log(`${nombre}: ${r.estado}`);
}

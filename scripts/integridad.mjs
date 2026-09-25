#!/usr/bin/env node
// Manifiesto de integridad (patrón integrity-manifest de justicia_aeroport):
// hash SHA-256 de cada fichero del motor, del paquete de bloques y de los golden.
// `--escribir` lo regenera; `--comprobar` falla si algo ha cambiado sin actualizar el manifiesto.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '../src/util.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const CARPETAS = ['src', 'packs', 'web', 'test/golden'];
const MANIFIESTO = join(RAIZ, 'integridad', 'manifiesto.json');

function ficheros(dir) {
  return readdirSync(join(RAIZ, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? ficheros(join(dir, d.name)) : [join(dir, d.name)]);
}

const actual = Object.fromEntries(CARPETAS.flatMap(ficheros).sort()
  .map((f) => [relative(RAIZ, join(RAIZ, f)).replaceAll('\\', '/'), hash(readFileSync(join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n'))]));

if (process.argv.includes('--escribir')) {
  writeFileSync(MANIFIESTO, JSON.stringify({ version: 1, ficheros: actual }, null, 2) + '\n');
  console.log(`Manifiesto actualizado: ${Object.keys(actual).length} ficheros.`);
} else {
  const guardado = JSON.parse(readFileSync(MANIFIESTO, 'utf8')).ficheros;
  const dif = [...new Set([...Object.keys(actual), ...Object.keys(guardado)])].filter((f) => actual[f] !== guardado[f]);
  if (dif.length) {
    console.error(`Integridad: ${dif.length} fichero(s) cambiados sin actualizar el manifiesto:\n- ${dif.join('\n- ')}\nSi el cambio es intencionado: npm run integridad`);
    process.exit(1);
  }
  console.log(`Integridad correcta (${Object.keys(actual).length} ficheros).`);
}

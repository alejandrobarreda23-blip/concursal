// Solo Node: carga de paquetes de bloques desde disco.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepararPack } from './bloques.mjs';

export const PACK_POR_DEFECTO = fileURLToPath(new URL('../packs/concurso-sin-masa.v1.json', import.meta.url));
export const PACK_DECLARACION = fileURLToPath(new URL('../packs/declaracion-sin-masa.v1.json', import.meta.url));
export const PACKS = Object.freeze({ conclusion: PACK_POR_DEFECTO, declaracion: PACK_DECLARACION });

export const cargarPack = (ruta) => prepararPack(JSON.parse(readFileSync(ruta, 'utf8')));

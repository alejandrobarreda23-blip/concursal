#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { generarAuto, generarDeclaracion } from '../src/index.mjs';

const NOMBRES = [
  '01-epi-sin-oposicion',
  '02-con-oposicion',
  '03-persona-juridica-sin-epi',
  '04-garantia-real-y-publico',
  '10-declaracion-desde-solicitud'
];

for (const nombre of NOMBRES) {
  const expediente = JSON.parse(readFileSync(new URL(`../ejemplos/${nombre}.json`, import.meta.url), 'utf8'));
  const resultado = expediente.solicitud ? generarDeclaracion(expediente) : generarAuto(expediente);
  console.log(JSON.stringify({
    nombre,
    estado: resultado.estado,
    variante: resultado.variante ?? null,
    hash_ir: resultado.ir?.hash_ir ?? null,
    texto: Boolean(resultado.texto)
  }));
}

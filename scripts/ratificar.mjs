#!/usr/bin/env node
// Ratificación humana de perfiles de redacción dentro del Knowledge Pack.
// Uso: npm run ratificar -- "Nombre"                     (conclusión)
//      npm run ratificar -- --pack declaracion "Nombre"
import { readFileSync, writeFileSync } from 'node:fs';
import { hashBloques, validarPack } from '../src/bloques.mjs';
import { KNOWLEDGE_CONCURSAL_CSM } from '../src/core/knowledge/node-loader.mjs';
import { prepareKnowledgeRuntime } from '../src/core/knowledge/runtime.mjs';

const args = process.argv.slice(2);
const iPack = args.indexOf('--pack');
const cual = iPack >= 0 ? args[iPack + 1] : 'conclusion';
if (!['declaracion', 'conclusion'].includes(cual)) {
  console.error(`Perfil desconocido: ${cual}. Opciones: declaracion, conclusion`);
  process.exit(2);
}
const nombre = args.filter((_, i) => i !== iPack && i !== iPack + 1).join(' ').trim();
if (!nombre) {
  console.error('Uso: npm run ratificar -- [--pack declaracion] "Nombre del magistrado"');
  process.exit(2);
}

const source = JSON.parse(readFileSync(KNOWLEDGE_CONCURSAL_CSM, 'utf8'));
const runtime = prepareKnowledgeRuntime(source);
const pack = runtime.redactionPack(cual);
const errores = validarPack(pack);
if (errores.length) {
  console.error(`No se puede ratificar:\n- ${errores.join('\n- ')}`);
  process.exit(1);
}
const pendientes = pack.bloques.filter((b) => b.verificar);
if (pendientes.length) {
  console.log('Bloques con notas de verificación (revíselos antes de ratificar):');
  for (const b of pendientes) console.log(`  · ${b.id}: ${b.verificar}`);
}

source.gobernanza.redaccion[cual].ratificacion = {
  ...source.gobernanza.redaccion[cual].ratificacion,
  estado: 'ratificado',
  ratificado_por: nombre,
  fecha: new Date().toISOString().slice(0, 10),
  hash_bloques: hashBloques(pack)
};
writeFileSync(KNOWLEDGE_CONCURSAL_CSM, JSON.stringify(source, null, 2) + '\n');
console.log(`Perfil ${cual} de ${source.pack_id} v${source.version} ratificado por ${nombre}. Hash: ${source.gobernanza.redaccion[cual].ratificacion.hash_bloques}`);
console.log('Recuerde ejecutar `npm run integridad` y hacer commit del cambio.');

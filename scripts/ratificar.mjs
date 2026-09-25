#!/usr/bin/env node
// Ratificación humana del paquete de bloques (patrón criterion-ratification de justicia_aeroport).
// Uso: npm run ratificar -- "Nombre del magistrado"
// Registra quién ratifica, cuándo y el hash exacto de los bloques. Si después se cambia
// una sola coma de un bloque, el hash deja de coincidir y los borradores vuelven a salir
// como NO RATIFICADOS hasta una nueva ratificación.
import { readFileSync, writeFileSync } from 'node:fs';
import { hashBloques, validarPack } from '../src/bloques.mjs';
import { PACK_POR_DEFECTO } from '../src/index.mjs';

const nombre = process.argv.slice(2).join(' ').trim();
if (!nombre) { console.error('Uso: npm run ratificar -- "Nombre del magistrado"'); process.exit(2); }
const pack = JSON.parse(readFileSync(PACK_POR_DEFECTO, 'utf8'));
const errores = validarPack(pack);
if (errores.length) { console.error(`No se puede ratificar:\n- ${errores.join('\n- ')}`); process.exit(1); }
const pendientes = pack.bloques.filter((b) => b.verificar);
if (pendientes.length) {
  console.log('Bloques con notas de verificación (revíselos antes de ratificar):');
  for (const b of pendientes) console.log(`  · ${b.id}: ${b.verificar}`);
}
pack.ratificacion = {
  ...pack.ratificacion,
  estado: 'ratificado',
  ratificado_por: nombre,
  fecha: new Date().toISOString().slice(0, 10),
  hash_bloques: hashBloques(pack)
};
writeFileSync(PACK_POR_DEFECTO, JSON.stringify(pack, null, 2) + '\n');
console.log(`Paquete ${pack.pack_id} v${pack.version} ratificado por ${nombre}. Hash: ${pack.ratificacion.hash_bloques}`);
console.log('Recuerde ejecutar `npm run integridad` y hacer commit del cambio.');

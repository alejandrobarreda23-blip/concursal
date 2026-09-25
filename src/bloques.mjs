// Catálogo de bloques de redacción (patrón writing-block-catalog de justicia_aeroport):
// cada bloque tiene id único, texto sin ambigüedad y hash; el paquete entero se ratifica por hash.
import { arr, text, hash, deepFreeze } from './util.mjs';

export const VARIABLES_PERMITIDAS = Object.freeze([
  'fecha_declaracion', 'fecha_solicitud', 'deudor',
  'total_pasivo', 'total_exonerado', 'total_no_exonerado', 'detalle_credito_publico',
  // auto de declaración
  'nif', 'domicilio', 'insolvencia', 'supuesto', 'supuesto_texto'
]);

const SECCIONES = ['antecedentes', 'fundamentos', 'dispositiva', 'pie'];

export function hashBloques(pack) {
  return hash(arr(pack?.bloques).map((b) => ({
    id: text(b.id), seccion: text(b.seccion), variantes: arr(b.variantes).slice().sort(),
    solo_si: text(b.solo_si) || null, titulo: text(b.titulo) || null, texto: text(b.texto), tabla: text(b.tabla) || null
  })));
}

export function validarPack(pack) {
  const errores = [];
  const vistos = new Set();
  for (const [i, b] of arr(pack?.bloques).entries()) {
    const id = text(b?.id);
    if (!id) { errores.push(`bloques[${i}]: sin id.`); continue; }
    if (vistos.has(id)) errores.push(`${id}: id duplicado.`);
    vistos.add(id);
    if (!SECCIONES.includes(b.seccion)) errores.push(`${id}: sección desconocida (${b.seccion}).`);
    if (!text(b.texto)) errores.push(`${id}: texto vacío.`);
    if (!arr(b.variantes).length) errores.push(`${id}: sin variantes.`);
    for (const m of text(b.texto).matchAll(/\{\{([^}]+)\}\}/g)) {
      if (!VARIABLES_PERMITIDAS.includes(m[1])) errores.push(`${id}: variable no permitida {{${m[1]}}}.`);
    }
    if (/\[[^\]]*\/[^\]]*\]/.test(b.texto)) errores.push(`${id}: contiene alternativas sin resolver entre corchetes.`);
  }
  return errores;
}

export function estadoRatificacion(pack) {
  const r = pack?.ratificacion || {};
  const actual = hashBloques(pack);
  if (r.estado !== 'ratificado') return { ratificado: false, motivo: 'Paquete de bloques pendiente de ratificación.', hash_actual: actual };
  if (r.hash_bloques !== actual) return { ratificado: false, motivo: 'Los bloques han cambiado desde la ratificación: hay que volver a ratificarlos.', hash_actual: actual };
  return { ratificado: true, motivo: null, hash_actual: actual, ratificado_por: r.ratificado_por, fecha: r.fecha };
}

// Valida un paquete ya parseado (sirve igual en Node y en el navegador).
export function prepararPack(pack) {
  const errores = validarPack(pack);
  if (errores.length) throw new Error(`Paquete de bloques inválido:\n- ${errores.join('\n- ')}`);
  return deepFreeze(pack);
}

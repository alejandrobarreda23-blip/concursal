// Representación intermedia de la resolución (patrón resolution-ir de justicia_aeroport):
// todo lo que el auto va a decir, en estructura, antes de convertirse en texto.
// Es inmutable y lleva hash: con el mismo expediente y el mismo paquete, el IR es idéntico.
import { arr, text, hash, deepFreeze, formatoEuros, fechaLarga } from './util.mjs';
import { estadoRatificacion, hashBloques } from './bloques.mjs';

export const MOTOR_VERSION = 'autos-concurso-sin-masa/0.1.0'; // no cambiar sin regenerar los golden (forma parte del hash del IR)
export const IR_VERSION = 'csm-ir-v1';

function condicionCumplida(cond, ctx) {
  if (!cond) return true;
  return Boolean(ctx[cond]);
}

function detallePublico(publico) {
  const nombres = { publico_aeat: 'la Agencia Estatal de Administración Tributaria', publico_tgss: 'la Seguridad Social' };
  const partes = Object.entries(publico).map(([clase, d]) =>
    `Con ${nombres[clase]}, sobre una deuda de ${formatoEuros(d.total)}, se exoneran ${formatoEuros(d.exonerable)} y no se exoneran ${formatoEuros(d.no_exonerable)}.`);
  return partes.join(' ');
}

export function cabeceraIR(exp) {
  return {
    tribunal: text(exp.organo.tribunal),
    seccion: text(exp.organo.seccion),
    plaza: exp.organo.plaza,
    denominacion_historica: text(exp.organo.denominacion_historica) || null,
    localidad: text(exp.organo.localidad),
    procedimiento: `Concurso sin masa ${text(exp.procedimiento.numero)}`,
    nig: text(exp.procedimiento.nig),
    numero_resolucion: text(exp.numero_resolucion) || null,
    fecha: exp.fecha_resolucion,
    fecha_larga: fechaLarga(exp.fecha_resolucion),
    juez: { nombre: text(exp.juez.nombre), cargo: text(exp.juez.cargo) },
    deudor: { nombre: text(exp.deudor.nombre), tipo: exp.deudor.tipo },
    representacion: exp.representacion ?? null
  };
}

export function construirIR({ expediente, fase, clasificacion, pack, knowledge = null }) {
  const exp = expediente;
  const ctx = {
    persona_juridica: exp.deudor.tipo === 'persona_juridica',
    hay_no_exonerados: clasificacion.totales.no_exonerado > 0,
    hay_credito_publico_limitado: Object.keys(clasificacion.publico).length > 0
  };

  const variables = {
    deudor: text(exp.deudor.nombre),
    fecha_declaracion: fechaLarga(exp.tramite.auto_declaracion_sin_masa.fecha),
    fecha_solicitud: exp.tramite.solicitud_epi ? fechaLarga(exp.tramite.solicitud_epi.fecha) : null,
    total_pasivo: formatoEuros(clasificacion.totales.pasivo),
    total_exonerado: formatoEuros(clasificacion.totales.exonerado),
    total_no_exonerado: formatoEuros(clasificacion.totales.no_exonerado),
    detalle_credito_publico: ctx.hay_credito_publico_limitado ? detallePublico(clasificacion.publico) : null
  };

  const bloques = arr(pack.bloques)
    .filter((b) => b.variantes.includes(fase.variante) && condicionCumplida(b.solo_si, ctx))
    .map((b) => ({ id: b.id, seccion: b.seccion, titulo: b.titulo ?? null, texto: b.texto, tabla: b.tabla ?? null }));

  const ratificacion = estadoRatificacion(pack);

  const ir = {
    version: IR_VERSION,
    estado: 'estructurado_sin_redactar',
    variante: fase.variante,
    cabecera: cabeceraIR(exp),
    decision_judicial: exp.decision_judicial,
    creditos: clasificacion.filas,
    totales: clasificacion.totales,
    credito_publico: clasificacion.publico,
    variables,
    bloques,
    procedencia: {
      motor: MOTOR_VERSION,
      ...(knowledge ? {
        knowledge_pack_id: knowledge.pack_id,
        knowledge_version: knowledge.version,
        knowledge_hash: knowledge.pack_hash
      } : {}),
      pack_id: pack.pack_id,
      pack_version: pack.version,
      hash_bloques: hashBloques(pack),
      bloques_ratificados: ratificacion.ratificado,
      aviso_ratificacion: ratificacion.motivo,
      hash_expediente: hash(exp)
    }
  };
  ir.hash_ir = hash(ir);
  return deepFreeze(ir);
}

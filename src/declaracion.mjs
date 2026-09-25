// Auto de DECLARACIÓN de concurso sin masa (art. 37 ter TRLC) a partir de la solicitud del deudor.
// Mismo flujo que el auto de conclusión: validar → fase → IR con hash → redactar → controles.
import { arr, obj, text, hash, deepFreeze, aCentimos, fechaValida, fechaLarga, formatoEuros } from './util.mjs';
import { CLASES_CREDITO } from './validar-expediente.mjs';
import { estadoRatificacion, hashBloques } from './bloques.mjs';
import { cabeceraIR, MOTOR_VERSION } from './resolucion-ir.mjs';
import { redactar, aTextoPlano } from './render.mjs';
import { controlesCalidad } from './controles-calidad.mjs';

// Supuestos del art. 37 bis.1 TRLC (texto para el fundamento; el juez elige cuál aprecia).
export const SUPUESTOS_37_BIS = Object.freeze({
  '1': 'el deudor carece de bienes y derechos legalmente embargables',
  '2': 'el coste de realización de sus bienes y derechos sería manifiestamente desproporcionado respecto de su previsible valor venal',
  '3': 'sus bienes y derechos libres de cargas son de valor inferior al previsible coste del procedimiento',
  '4': 'los gravámenes y cargas que pesan sobre sus bienes y derechos superan su valor de mercado'
});

const DOCUMENTOS_ART_7 = ['poder', 'memoria', 'inventario', 'relacion_acreedores'];

export function validarExpedienteDeclaracion(exp) {
  const e = [];
  const push = (r, m) => e.push(`${r}: ${m}`);
  if (!obj(exp)) return ['expediente: debe ser un objeto JSON.'];
  for (const k of ['tribunal', 'seccion', 'localidad']) if (!text(exp.organo?.[k])) push(`organo.${k}`, 'falta.');
  if (!Number.isInteger(exp.organo?.plaza) || exp.organo.plaza < 1) push('organo.plaza', 'debe ser un entero ≥ 1.');
  for (const k of ['numero', 'nig']) if (!text(exp.procedimiento?.[k])) push(`procedimiento.${k}`, 'falta.');
  if (!text(exp.juez?.nombre)) push('juez.nombre', 'falta.');
  if (!['Magistrado', 'Magistrada', 'Juez', 'Jueza'].includes(text(exp.juez?.cargo))) push('juez.cargo', 'debe ser Magistrado, Magistrada, Juez o Jueza.');
  if (!fechaValida(exp.fecha_resolucion)) push('fecha_resolucion', 'fecha ISO (AAAA-MM-DD) inválida.');
  for (const k of ['nombre', 'nif', 'domicilio']) if (!text(exp.deudor?.[k])) push(`deudor.${k}`, 'falta.');
  if (!['persona_natural', 'persona_juridica'].includes(text(exp.deudor?.tipo))) push('deudor.tipo', 'debe ser persona_natural o persona_juridica.');
  const s = exp.solicitud;
  if (!obj(s)) push('solicitud', 'falta.');
  else {
    if (!fechaValida(s.fecha)) push('solicitud.fecha', 'fecha inválida.');
    if (!['actual', 'inminente'].includes(s.insolvencia)) push('solicitud.insolvencia', 'debe ser actual o inminente.');
    if (typeof s.pide_epi !== 'boolean') push('solicitud.pide_epi', 'debe ser true o false.');
    if (!obj(s.documentos)) push('solicitud.documentos', 'falta.');
    if (fechaValida(s.fecha) && fechaValida(exp.fecha_resolucion) && exp.fecha_resolucion < s.fecha) push('fecha_resolucion', 'anterior a la solicitud.');
  }
  const ids = new Set();
  const creditos = arr(exp.creditos);
  if (!creditos.length) push('creditos', 'la relación de acreedores es obligatoria.');
  creditos.forEach((c, i) => {
    const r = `creditos[${i}]`;
    if (!text(c?.id) || ids.has(c.id)) push(`${r}.id`, 'falta o está duplicado.'); else ids.add(c.id);
    if (!text(c?.acreedor)) push(`${r}.acreedor`, 'falta.');
    if (!text(c?.concepto)) push(`${r}.concepto`, 'falta.');
    const imp = aCentimos(c?.importe);
    if (imp == null || imp <= 0) push(`${r}.importe`, 'debe ser un número positivo.');
    if (!CLASES_CREDITO.includes(text(c?.clase))) push(`${r}.clase`, `no reconocida (${c?.clase}).`);
  });
  return e;
}

export function determinarFaseDeclaracion(exp) {
  const s = exp.solicitud;
  const fuera = [];
  if (s.tipo && s.tipo !== 'concurso_sin_masa') fuera.push(`La solicitud no es de concurso sin masa (${s.tipo}).`);
  if (s.solicitante && s.solicitante !== 'deudor') fuera.push('La solicitud no la formula el deudor (concurso necesario).');
  if (s.plan_pagos) fuera.push('Se pide exoneración con plan de pagos: no es el cauce del concurso sin masa simple.');
  if (fuera.length) return { estado: 'fuera_de_alcance', variante: null, motivos: fuera };

  const faltan = DOCUMENTOS_ART_7.filter((d) => s.documentos?.[d] !== true);
  if (faltan.length) return { estado: 'pendiente_tramite', variante: 'declaracion_sin_masa', motivos: [`Faltan documentos del art. 7 TRLC: ${faltan.join(', ').replace(/_/g, ' ')}. Procede requerir la subsanación antes de declarar el concurso.`] };

  const d = exp.decision_judicial;
  const pend = [];
  if (!obj(d)) pend.push('Falta decision_judicial.');
  else {
    if (d.sentido !== 'declarar_sin_masa') pend.push('decision_judicial.sentido debe ser "declarar_sin_masa".');
    if (d.competencia_verificada !== true) pend.push('El juez debe confirmar la competencia (decision_judicial.competencia_verificada = true).');
    if (d.insolvencia_apreciada !== true) pend.push('El juez debe apreciar la insolvencia (decision_judicial.insolvencia_apreciada = true).');
    if (!SUPUESTOS_37_BIS[String(d.supuesto_37_bis)]) pend.push('El juez debe indicar el supuesto del art. 37 bis.1 TRLC que aprecia (1, 2, 3 o 4).');
  }
  if (pend.length) return { estado: 'pendiente_decision', variante: 'declaracion_sin_masa', motivos: pend };
  return { estado: 'listo', variante: 'declaracion_sin_masa', motivos: [] };
}

function filasPasivo(creditos) {
  const filas = arr(creditos).map((c) => {
    const importe = aCentimos(c.importe);
    return Object.freeze({ id: c.id, acreedor: text(c.acreedor), concepto: text(c.concepto), clase: c.clase, importe, exonerado: 0, no_exonerado: importe, vencimiento: c.vencimiento ?? null, motivo: null, valor_garantia: null });
  }).sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }));
  const pasivo = filas.reduce((s, c) => s + c.importe, 0);
  return { filas, totales: { pasivo, exonerado: 0, no_exonerado: pasivo } };
}

export function construirIRDeclaracion(exp, pack) {
  const { filas, totales } = filasPasivo(exp.creditos);
  const ctx = { pide_epi: exp.solicitud.pide_epi === true && exp.deudor.tipo === 'persona_natural' };
  const supuesto = String(exp.decision_judicial.supuesto_37_bis);
  const ratificacion = estadoRatificacion(pack);
  const ir = {
    version: 'csm-ir-v1',
    estado: 'estructurado_sin_redactar',
    variante: 'declaracion_sin_masa',
    cabecera: cabeceraIR(exp),
    decision_judicial: exp.decision_judicial,
    creditos: filas,
    totales,
    credito_publico: {},
    variables: {
      deudor: text(exp.deudor.nombre),
      nif: text(exp.deudor.nif),
      domicilio: text(exp.deudor.domicilio),
      fecha_solicitud: fechaLarga(exp.solicitud.fecha),
      insolvencia: exp.solicitud.insolvencia,
      supuesto,
      supuesto_texto: SUPUESTOS_37_BIS[supuesto],
      total_pasivo: formatoEuros(totales.pasivo)
    },
    bloques: arr(pack.bloques)
      .filter((b) => b.variantes.includes('declaracion_sin_masa') && (!b.solo_si || ctx[b.solo_si]))
      .map((b) => ({ id: b.id, seccion: b.seccion, titulo: b.titulo ?? null, texto: b.texto, tabla: b.tabla ?? null })),
    procedencia: {
      motor: MOTOR_VERSION,
      pack_id: pack.pack_id,
      pack_version: pack.version,
      hash_bloques: hashBloques(pack),
      bloques_ratificados: ratificacion.ratificado,
      aviso_ratificacion: ratificacion.motivo,
      hash_expediente: hash(exp),
      hash_lectura: text(exp._procedencia?.hash_lectura) || null
    }
  };
  ir.hash_ir = hash(ir);
  return deepFreeze(ir);
}

export function generarAutoDeclaracion(expediente, { pack }) {
  if (!pack) throw new Error('generarAutoDeclaracion: falta el paquete de bloques.');
  const errores = validarExpedienteDeclaracion(expediente);
  if (errores.length) return { estado: 'expediente_invalido', errores };
  const fase = determinarFaseDeclaracion(expediente);
  if (fase.estado !== 'listo') return fase;
  const ir = construirIRDeclaracion(expediente, pack);
  let documento, texto;
  try { documento = redactar(ir); texto = aTextoPlano(documento); } catch (err) { return { estado: 'error_redaccion', errores: [err.message], ir }; }
  const controles = controlesCalidad(ir, documento, texto);
  if (!controles.ok) return { estado: 'bloqueado_por_calidad', controles, ir };
  return { estado: ir.procedencia.bloques_ratificados ? 'borrador' : 'borrador_no_ratificado', variante: ir.variante, ir, documento, texto, controles };
}

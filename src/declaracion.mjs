// Auto de declaración: orquestación sobre Legal Core + Knowledge concursal.
// El motor conserva validación, IR, redacción y calidad; las reglas jurídicas,
// catálogos, workflows y bloques de texto residen en el Knowledge Pack.
import { arr, obj, text, hash, deepFreeze, aCentimos, fechaValida, fechaLarga, formatoEuros } from './util.mjs';
import { creditClassIds } from './core/knowledge/credit-engine.mjs';
import { evaluateWorkflow, evaluateWorkflowWarnings } from './core/knowledge/workflow.mjs';
import { estadoRatificacion, hashBloques } from './bloques.mjs';
import { cabeceraIR, MOTOR_VERSION } from './resolucion-ir.mjs';
import { redactar, aTextoPlano } from './render.mjs';
import { controlesCalidad } from './controles-calidad.mjs';

export function catalogoSupuestos37Bis(knowledge) {
  if (!knowledge) return {};
  const catalog = knowledge.getCatalog('supuesto_37_bis') || {};
  return Object.freeze(Object.fromEntries(Object.entries(catalog).map(([key, value]) => [key, value.texto])));
}

export function validarExpedienteDeclaracion(exp, { knowledge } = {}) {
  const e = [];
  const push = (r, m) => e.push(`${r}: ${m}`);
  if (!knowledge) return ['knowledge: falta el Knowledge Runtime.'];
  if (!obj(exp)) return ['expediente: debe ser un objeto JSON.'];
  const clasesCredito = creditClassIds(knowledge);
  for (const k of ['tribunal', 'seccion', 'localidad']) if (!text(exp.organo?.[k])) push(`organo.${k}`, 'falta.');
  if (!Number.isInteger(exp.organo?.plaza) || exp.organo.plaza < 1) push('organo.plaza', 'debe ser un entero ≥ 1.');
  for (const k of ['numero', 'nig']) if (!text(exp.procedimiento?.[k])) push(`procedimiento.${k}`, 'falta.');
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
    if (!clasesCredito.includes(text(c?.clase))) push(`${r}.clase`, `no reconocida (${c?.clase}).`);
  });
  return e;
}

export function determinarFaseDeclaracion(exp, { knowledge } = {}) {
  if (!knowledge) throw new Error('determinarFaseDeclaracion: falta Knowledge Runtime.');
  return evaluateWorkflow(knowledge, 'declaracion', exp);
}

function advertenciasBorradorDeclaracion(exp, knowledge) {
  return evaluateWorkflowWarnings(knowledge, 'declaracion', exp);
}

function filasPasivo(creditos) {
  const filas = arr(creditos).map((c) => {
    const importe = aCentimos(c.importe);
    return Object.freeze({ id: c.id, acreedor: text(c.acreedor), concepto: text(c.concepto), clase: c.clase, importe, exonerado: 0, no_exonerado: importe, vencimiento: c.vencimiento ?? null, motivo: null, valor_garantia: null });
  }).sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }));
  const pasivo = filas.reduce((s, c) => s + c.importe, 0);
  return { filas, totales: { pasivo, exonerado: 0, no_exonerado: pasivo } };
}

export function construirIRDeclaracion(exp, pack, knowledge) {
  const { filas, totales } = filasPasivo(exp.creditos);
  const advertencias = advertenciasBorradorDeclaracion(exp, knowledge);
  const hayRepresentacion = Boolean(text(exp.representacion?.procurador) || text(exp.representacion?.abogado));
  const ctx = {
    pide_epi: exp.solicitud.pide_epi === true && exp.deudor.tipo === 'persona_natural',
    con_representacion: hayRepresentacion,
    sin_representacion: !hayRepresentacion
  };
  const supuesto = String(exp.decision_judicial.supuesto_37_bis);
  const supuestos = knowledge.getCatalog('supuesto_37_bis') || {};
  const supuestoCfg = supuestos[supuesto];
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
      supuesto_letra: supuestoCfg?.codigo,
      supuesto_texto: supuestoCfg?.texto,
      numero_acreedores: String(filas.length),
      total_pasivo: formatoEuros(totales.pasivo)
    },
    bloques: arr(pack.bloques)
      .filter((b) => b.variantes.includes('declaracion_sin_masa') && (!b.solo_si || ctx[b.solo_si]))
      .map((b) => ({ id: b.id, seccion: b.seccion, titulo: b.titulo ?? null, texto: b.texto, tabla: b.tabla ?? null })),
    ...(advertencias.length ? { advertencias_borrador: advertencias } : {}),
    procedencia: {
      motor: MOTOR_VERSION,
      knowledge_pack_id: knowledge.pack_id,
      knowledge_version: knowledge.version,
      knowledge_hash: knowledge.pack_hash,
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

export function generarAutoDeclaracion(expediente, { knowledge, pack = null } = {}) {
  if (!knowledge) throw new Error('generarAutoDeclaracion: falta Knowledge Runtime.');
  const draftPack = pack || knowledge.redactionPack('declaracion');
  const errores = validarExpedienteDeclaracion(expediente, { knowledge });
  if (errores.length) return { estado: 'expediente_invalido', errores };
  const fase = determinarFaseDeclaracion(expediente, { knowledge });
  if (fase.estado !== 'listo') return fase;
  const ir = construirIRDeclaracion(expediente, draftPack, knowledge);
  let documento, texto;
  try { documento = redactar(ir); texto = aTextoPlano(documento); } catch (err) { return { estado: 'error_redaccion', errores: [err.message], ir }; }
  const controlesBase = controlesCalidad(ir, documento, texto);
  const avisosBorrador = advertenciasBorradorDeclaracion(expediente, knowledge);
  const controles = Object.freeze({
    ...controlesBase,
    avisos: [...new Set([...(controlesBase.avisos || []), ...avisosBorrador])]
  });
  if (!controles.ok) return { estado: 'bloqueado_por_calidad', controles, ir };
  return { estado: ir.procedencia.bloques_ratificados ? 'borrador' : 'borrador_no_ratificado', variante: ir.variante, ir, documento, texto, controles };
}

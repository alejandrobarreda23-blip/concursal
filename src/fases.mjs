// Máquina de fases del concurso sin masa (determinista).
// Decide QUÉ tipo de auto puede prepararse o POR QUÉ no puede prepararse.
// Nunca suple la valoración judicial: la buena fe y la decisión final las fija el juez
// en `decision_judicial` (principio human-decision-boundary de justicia_aeroport).
import { arr, obj, text } from './util.mjs';

export const VARIANTES = Object.freeze({
  CONCLUSION_CON_EPI: 'conclusion_con_epi',   // persona natural, EPI sin oposición
  CONCLUSION_SIN_EPI: 'conclusion_sin_epi'    // no se ha solicitado la exoneración
});

export const ESTADOS = Object.freeze({
  LISTO: 'listo',                       // se puede generar el borrador
  PENDIENTE_DECISION: 'pendiente_decision', // falta la decisión expresa del juez
  PENDIENTE_TRAMITE: 'pendiente_tramite',   // el procedimiento no está en fase de dictar este auto
  FUERA_DE_ALCANCE: 'fuera_de_alcance'      // exige otra resolución (incidente, AC, valoración)
});

function r(estado, variante, motivos) {
  return Object.freeze({ estado, variante: variante ?? null, motivos: Object.freeze(motivos) });
}

export function determinarFase(exp) {
  const t = exp.tramite;
  const fuera = [];

  if (t.solicitud_nombramiento_ac) fuera.push('Los acreedores solicitaron el nombramiento de administración concursal (art. 37 ter TRLC): el concurso no sigue el cauce sin masa simple.');
  if (t.auto_complementario_37_quinquies) fuera.push('Consta auto complementario del art. 37 quinquies TRLC: el procedimiento continúa y no procede este auto.');

  const solicitaEpi = t.solicitud_epi != null;
  if (solicitaEpi && exp.deudor.tipo !== 'persona_natural') fuera.push('La exoneración del pasivo insatisfecho solo procede para persona natural.');
  if (solicitaEpi && arr(t.oposiciones).length) fuera.push(`Hay ${arr(t.oposiciones).length} oposición(es) a la exoneración: debe tramitarse y resolverse el incidente (no es un auto de plantilla).`);
  if (obj(exp.exoneracion_previa) && exp.exoneracion_previa.existe === true) fuera.push('Consta una exoneración anterior: el juez debe valorar los plazos de reiteración (art. 488 TRLC).');
  if (arr(exp.decision_judicial?.excepciones_art_487).length) fuera.push('El juez ha apreciado causas de exclusión del art. 487 TRLC.');

  if (fuera.length) return r(ESTADOS.FUERA_DE_ALCANCE, null, fuera);

  const variante = solicitaEpi ? VARIANTES.CONCLUSION_CON_EPI : VARIANTES.CONCLUSION_SIN_EPI;

  if (solicitaEpi && t.traslado_acreedores !== true) {
    return r(ESTADOS.PENDIENTE_TRAMITE, variante, ['No consta el traslado de la solicitud de exoneración a los acreedores.']);
  }

  // Frontera de decisión humana: sin decisión expresa no se redacta nada.
  const dj = exp.decision_judicial;
  const pend = [];
  if (!obj(dj)) pend.push('Falta decision_judicial.');
  else {
    const esperado = variante === VARIANTES.CONCLUSION_CON_EPI ? 'conceder_epi' : 'concluir_sin_epi';
    if (text(dj.sentido) !== esperado) pend.push(`decision_judicial.sentido debe ser "${esperado}" para esta variante (recibido: "${text(dj.sentido) || '—'}").`);
    if (variante === VARIANTES.CONCLUSION_CON_EPI && dj.buena_fe_verificada !== true) pend.push('El juez debe confirmar expresamente la buena fe del deudor (art. 487 TRLC): decision_judicial.buena_fe_verificada = true.');
  }
  if (pend.length) return r(ESTADOS.PENDIENTE_DECISION, variante, pend);

  return r(ESTADOS.LISTO, variante, []);
}

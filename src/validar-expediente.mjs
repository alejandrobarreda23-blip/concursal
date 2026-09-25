// Validación estructural del expediente.
// El catálogo jurídico de clases de crédito procede del Knowledge Pack, no del motor.
import { arr, obj, text, aCentimos, fechaValida } from './util.mjs';
import { creditClassIds } from './core/knowledge/credit-engine.mjs';

const push = (errores, ruta, msg) => errores.push(`${ruta}: ${msg}`);

export function validarExpediente(exp, { knowledge } = {}) {
  const e = [];
  if (!knowledge) return ['knowledge: falta el Knowledge Runtime.'];
  if (!obj(exp)) return ['expediente: debe ser un objeto JSON.'];
  const clasesCredito = creditClassIds(knowledge);

  const o = exp.organo;
  if (!obj(o)) push(e, 'organo', 'falta.');
  else {
    for (const k of ['tribunal', 'seccion', 'localidad']) if (!text(o[k])) push(e, `organo.${k}`, 'falta.');
    if (!Number.isInteger(o.plaza) || o.plaza < 1) push(e, 'organo.plaza', 'debe ser un entero ≥ 1.');
  }
  const p = exp.procedimiento;
  if (!obj(p)) push(e, 'procedimiento', 'falta.');
  else for (const k of ['numero', 'nig']) if (!text(p[k])) push(e, `procedimiento.${k}`, 'falta.');

  if (!obj(exp.juez) || !text(exp.juez.nombre)) push(e, 'juez.nombre', 'falta.');
  if (!['Magistrado', 'Magistrada', 'Juez', 'Jueza'].includes(text(exp.juez?.cargo))) push(e, 'juez.cargo', 'debe ser Magistrado, Magistrada, Juez o Jueza.');
  if (!fechaValida(exp.fecha_resolucion)) push(e, 'fecha_resolucion', 'fecha ISO (AAAA-MM-DD) inválida.');

  const d = exp.deudor;
  if (!obj(d) || !text(d.nombre)) push(e, 'deudor.nombre', 'falta.');
  if (!['persona_natural', 'persona_juridica'].includes(text(d?.tipo))) push(e, 'deudor.tipo', 'debe ser persona_natural o persona_juridica.');

  const t = exp.tramite;
  if (!obj(t)) push(e, 'tramite', 'falta.');
  else {
    if (!fechaValida(t.auto_declaracion_sin_masa?.fecha)) push(e, 'tramite.auto_declaracion_sin_masa.fecha', 'fecha inválida.');
    for (const k of ['solicitud_nombramiento_ac', 'auto_complementario_37_quinquies']) {
      if (typeof t[k] !== 'boolean') push(e, `tramite.${k}`, 'debe ser true o false (no se presume).');
    }
    if (t.solicitud_epi != null) {
      if (!fechaValida(t.solicitud_epi?.fecha)) push(e, 'tramite.solicitud_epi.fecha', 'fecha inválida.');
      if (typeof t.traslado_acreedores !== 'boolean') push(e, 'tramite.traslado_acreedores', 'debe ser true o false.');
      if (!Array.isArray(t.oposiciones)) push(e, 'tramite.oposiciones', 'debe ser una lista (vacía si no hubo).');
    }
  }

  const ids = new Set();
  const creditos = arr(exp.creditos);
  if (t?.solicitud_epi != null && !creditos.length) push(e, 'creditos', 'la solicitud de exoneración exige la relación de créditos.');
  creditos.forEach((c, i) => {
    const r = `creditos[${i}]`;
    if (!obj(c)) { push(e, r, 'debe ser un objeto.'); return; }
    if (!text(c.id)) push(e, `${r}.id`, 'falta.');
    else if (ids.has(c.id)) push(e, `${r}.id`, `duplicado (${c.id}).`);
    else ids.add(c.id);
    if (!text(c.acreedor)) push(e, `${r}.acreedor`, 'falta.');
    if (!text(c.concepto)) push(e, `${r}.concepto`, 'falta.');
    const imp = aCentimos(c.importe);
    if (imp == null || imp <= 0) push(e, `${r}.importe`, 'debe ser un número positivo.');
    if (!clasesCredito.includes(text(c.clase))) push(e, `${r}.clase`, `no reconocida (${c.clase}). Valores: ${clasesCredito.join(', ')}.`);
    if (c.clase === 'garantia_real') {
      const vg = aCentimos(c.valor_garantia);
      if (vg == null || vg < 0) push(e, `${r}.valor_garantia`, 'obligatorio en créditos con garantía real.');
    }
    if (c.vencimiento != null && !['vencido', 'no_vencido'].includes(c.vencimiento)) push(e, `${r}.vencimiento`, 'debe ser vencido o no_vencido.');
  });

  const f0 = t?.auto_declaracion_sin_masa?.fecha, f1 = t?.solicitud_epi?.fecha, f2 = exp.fecha_resolucion;
  if (fechaValida(f0) && fechaValida(f1) && f1 < f0) push(e, 'tramite.solicitud_epi.fecha', 'anterior al auto de declaración.');
  if (fechaValida(f0) && fechaValida(f2) && f2 < f0) push(e, 'fecha_resolucion', 'anterior al auto de declaración.');
  if (fechaValida(f1) && fechaValida(f2) && f2 < f1) push(e, 'fecha_resolucion', 'anterior a la solicitud de exoneración.');

  return e;
}

// Controles de calidad antes de entregar el borrador.
// Nacen de errores reales observados en resoluciones publicadas (p. ej. STIM GI 81/2026):
// alternativas de plantilla sin resolver, cuantías que no cuadran entre apartados,
// partes cruzadas y numeración con saltos.
import { formatoEuros } from './util.mjs';

export function controlesCalidad(ir, doc, texto) {
  const fallos = [];
  const avisos = [];

  // 1. Restos de plantilla
  const restos = [
    [/\{\{[^}]*\}\}/, 'variable de plantilla sin sustituir ({{…}})'],
    [/\[[^\]]*\/[^\]]*\]/, 'alternativa de plantilla sin resolver ([… / …])'],
    [/\bXXX+\b|\bTODO\b|\bNUM0{3}\b/i, 'marcador pendiente (XXX, TODO, NUM000)'],
    [/\bundefined\b|\bnull\b|\bNaN\b/, 'valor técnico vacío (undefined/null/NaN)']
  ];
  for (const [re, desc] of restos) if (re.test(texto)) fallos.push(`Resto de plantilla: ${desc}.`);

  // 2. Cuadre de importes, crédito a crédito y en total
  for (const c of ir.creditos) {
    if (c.exonerado + c.no_exonerado !== c.importe) fallos.push(`Crédito ${c.id}: exonerado + no exonerado ≠ importe.`);
    if (c.exonerado < 0 || c.no_exonerado < 0) fallos.push(`Crédito ${c.id}: importe negativo.`);
  }
  const t = ir.totales;
  if (t.exonerado + t.no_exonerado !== t.pasivo) fallos.push('Totales: exonerado + no exonerado ≠ pasivo.');

  // 3. Las tablas del texto coinciden con el IR
  for (const tabla of doc.filter((e) => e.tipo === 'tabla')) {
    const esperado = formatoEuros(tabla.clase === 'exonerados' ? t.exonerado : tabla.clase === 'pasivo' ? t.pasivo : t.no_exonerado);
    if (tabla.total !== esperado) fallos.push(`Tabla ${tabla.clase}: total ${tabla.total} ≠ ${esperado}.`);
    tabla.lineas.forEach((l, i) => { if (l.n !== i + 1) fallos.push(`Tabla ${tabla.clase}: numeración con saltos.`); });
  }
  if (ir.variante === 'conclusion_con_epi') {
    const nEx = ir.creditos.filter((c) => c.exonerado > 0).length;
    const tablaEx = doc.find((e) => e.tipo === 'tabla' && e.clase === 'exonerados');
    if (nEx && (!tablaEx || tablaEx.lineas.length !== nEx)) fallos.push('No todos los créditos exonerados aparecen en la parte dispositiva.');
    if (!nEx) avisos.push('Ningún crédito resulta exonerado: revisar si tiene sentido conceder la exoneración.');
  }

  if (ir.variante === 'declaracion_sin_masa') {
    const tablaP = doc.find((e) => e.tipo === 'tabla' && e.clase === 'pasivo');
    if (!tablaP || tablaP.lineas.length !== ir.creditos.length) fallos.push('La relación de pasivo del auto no recoge todos los créditos.');
  }

  // 4. Toda cifra en euros del texto procede del IR (no hay importes "huérfanos")
  const permitidos = new Set([t.pasivo, t.exonerado, t.no_exonerado].map(formatoEuros));
  for (const c of ir.creditos) [c.importe, c.exonerado, c.no_exonerado].forEach((v) => permitidos.add(formatoEuros(v)));
  for (const d of Object.values(ir.credito_publico)) [d.total, d.exonerable, d.no_exonerable].forEach((v) => permitidos.add(formatoEuros(v)));
  for (const m of texto.matchAll(/\d{1,3}(?:\.\d{3})*,\d{2} €/g)) {
    if (!permitidos.has(m[0])) fallos.push(`Importe ${m[0]} en el texto que no procede de los datos del expediente.`);
  }

  // 5. Partes: el deudor aparece; ningún acreedor figura como concursado
  if (!texto.includes(ir.cabecera.deudor.nombre)) fallos.push('El nombre del deudor no aparece en el texto.');
  for (const c of ir.creditos) {
    if (c.acreedor === ir.cabecera.deudor.nombre) fallos.push(`El acreedor del crédito ${c.id} coincide con el deudor: partes cruzadas.`);
  }

  // 6. Numeración de la parte dispositiva
  const disp = doc.filter((e) => e.tipo === 'dispositivo').map((e) => e.numero);
  disp.forEach((n, i) => { if (n !== i + 1) fallos.push('Parte dispositiva: numeración con saltos.'); });

  // 7. Ratificación
  if (!ir.procedencia.bloques_ratificados) avisos.push(ir.procedencia.aviso_ratificacion);

  return Object.freeze({ ok: fallos.length === 0, fallos: [...new Set(fallos)], avisos });
}

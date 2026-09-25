// Redacción: convierte el IR en un documento estructurado (para .docx) y en texto plano.
// Sustituye variables y falla si queda alguna sin resolver (fail-closed).
import { formatoEuros, ordinal } from './util.mjs';

const SECCION_TITULO = { antecedentes: 'ANTECEDENTES DE HECHO', fundamentos: 'FUNDAMENTOS DE DERECHO', dispositiva: 'PARTE DISPOSITIVA' };

function sustituir(textoBloque, variables, idBloque) {
  return textoBloque.replace(/\{\{([^}]+)\}\}/g, (_, nombre) => {
    const v = variables[nombre];
    if (v == null || v === '') throw new Error(`Bloque ${idBloque}: variable {{${nombre}}} sin valor.`);
    return v;
  });
}

function filasTabla(ir, tipo) {
  const lineas = [];
  let n = 0;
  for (const c of ir.creditos) {
    const venc = c.vencimiento === 'no_vencido' ? ', no vencido' : c.vencimiento === 'vencido' ? ', vencido' : '';
    if (tipo === 'exonerados' && c.exonerado > 0) {
      n += 1;
      const parcial = c.exonerado < c.importe ? `de una deuda total de ${formatoEuros(c.importe)}` : '';
      lineas.push({ n, acreedor: c.acreedor, concepto: `${c.concepto}${venc}`, importe: formatoEuros(c.exonerado), nota: parcial.trim() || null });
    }
    if (tipo === 'pasivo') {
      n += 1;
      lineas.push({ n, acreedor: c.acreedor, concepto: `${c.concepto}${venc}`, importe: formatoEuros(c.importe), nota: null });
    }
    if (tipo === 'no_exonerados' && c.no_exonerado > 0) {
      n += 1;
      lineas.push({ n, acreedor: c.acreedor, concepto: `${c.concepto}${venc}`, importe: formatoEuros(c.no_exonerado), nota: c.motivo });
    }
  }
  const total = tipo === 'exonerados' ? ir.totales.exonerado : tipo === 'pasivo' ? ir.totales.pasivo : ir.totales.no_exonerado;
  return { lineas, total: formatoEuros(total) };
}

export function redactar(ir) {
  const doc = [];
  const cab = ir.cabecera;

  if (!ir.procedencia.bloques_ratificados) {
    doc.push({ tipo: 'aviso', texto: `BORRADOR NO RATIFICADO — ${ir.procedencia.aviso_ratificacion}` });
  }
  for (const aviso of ir.advertencias_borrador || []) {
    doc.push({ tipo: 'aviso', texto: `ADVERTENCIA DE BORRADOR — ${aviso}` });
  }
  doc.push({ tipo: 'encabezado', texto: `${cab.tribunal}. ${cab.seccion}. Plaza n.º ${cab.plaza}${cab.denominacion_historica ? ` (${cab.denominacion_historica})` : ''}` });
  doc.push({ tipo: 'encabezado', texto: `${cab.procedimiento} — N.I.G.: ${cab.nig}` });
  doc.push({ tipo: 'encabezado', texto: `Parte concursada: ${cab.deudor.nombre}` });
  if (cab.representacion?.procurador) doc.push({ tipo: 'encabezado', texto: `Procurador/a: ${cab.representacion.procurador}` });
  if (cab.representacion?.abogado) doc.push({ tipo: 'encabezado', texto: `Abogado/a: ${cab.representacion.abogado}` });
  doc.push({ tipo: 'titulo', texto: cab.numero_resolucion ? `AUTO N.º ${cab.numero_resolucion}` : 'AUTO' });
  doc.push({ tipo: 'parrafo', texto: `${cab.juez.cargo}: ${cab.juez.nombre || '____________________'}` });
  doc.push({ tipo: 'parrafo', texto: `${cab.localidad}, ${cab.fecha_larga}.` });

  for (const seccion of ['antecedentes', 'fundamentos', 'dispositiva']) {
    const bloques = ir.bloques.filter((b) => b.seccion === seccion);
    if (!bloques.length) continue;
    doc.push({ tipo: 'titulo', texto: SECCION_TITULO[seccion] });
    bloques.forEach((b, i) => {
      const cuerpo = sustituir(b.texto, ir.variables, b.id);
      if (seccion === 'dispositiva') {
        doc.push({ tipo: 'dispositivo', numero: i + 1, texto: cuerpo, bloque: b.id });
      } else {
        doc.push({ tipo: 'apartado', numero: ordinal(i), titulo: b.titulo ?? null, texto: cuerpo, seccion, bloque: b.id });
      }
      if (b.tabla) doc.push({ tipo: 'tabla', clase: b.tabla, ...filasTabla(ir, b.tabla) });
    });
  }

  for (const b of ir.bloques.filter((x) => x.seccion === 'pie')) {
    doc.push({ tipo: 'parrafo', texto: sustituir(b.texto, ir.variables, b.id), bloque: b.id });
  }
  doc.push({ tipo: 'parrafo', texto: 'Lo acuerdo y firmo.' });
  doc.push({ tipo: 'firma', texto: `${cab.juez.cargo === 'Magistrada' || cab.juez.cargo === 'Jueza' ? 'La' : 'El'} ${cab.juez.cargo}` });

  return Object.freeze(doc);
}

export function aTextoPlano(doc) {
  const out = [];
  for (const el of doc) {
    if (el.tipo === 'tabla') {
      for (const l of el.lineas) out.push(`   ${l.n}. ${l.acreedor} — ${l.concepto}: ${l.importe}${l.nota ? ` — ${l.nota}` : ''}`);
      out.push(`   Total: ${el.total}`);
    } else if (el.tipo === 'titulo') out.push('', el.texto, '');
    else if (el.tipo === 'apartado') out.push(`${el.numero}.${el.titulo ? ` ${el.titulo}.` : ''} ${el.texto}`);
    else if (el.tipo === 'dispositivo') out.push(`${el.numero}.º ${el.texto}`);
    else out.push(el.texto);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

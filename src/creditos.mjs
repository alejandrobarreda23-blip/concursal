// Clasificación determinista de créditos a efectos de exoneración (art. 489 TRLC).
// Todos los importes en céntimos. Cada euro del pasivo queda en exactamente una columna:
// exonerado + no exonerado = importe (se comprueba en controles de calidad).
import { aCentimos, arr } from './util.mjs';

// Límites del crédito público AEAT / TGSS (art. 489.1.5.º TRLC):
// primeros 5.000 € íntegros; a partir de ahí, el 50 % hasta un máximo de 10.000 € exonerados por organismo.
export const LIMITES_PUBLICO = Object.freeze({ tramo_integro: 500000, maximo: 1000000, porcentaje_resto: 50 });

const MOTIVO_NO_EXONERABLE = Object.freeze({
  publico_otro: 'crédito de derecho público (art. 489.1.5.º TRLC)',
  alimentos: 'deuda por alimentos (art. 489.1.3.º TRLC)',
  rc_extracontractual: 'responsabilidad civil extracontractual por muerte o daños personales (art. 489.1.1.º TRLC)',
  rc_delito: 'responsabilidad civil derivada de delito (art. 489.1.2.º TRLC)',
  salarios: 'créditos salariales del art. 489.1.4.º TRLC',
  multa_sancion: 'multa penal o sanción administrativa muy grave (art. 489.1.6.º TRLC)',
  costas_epi: 'costas y gastos de la solicitud de exoneración (art. 489.1.7.º TRLC)'
});

export function exoneracionPublicaLimitada(totalCentimos) {
  const { tramo_integro, maximo, porcentaje_resto } = LIMITES_PUBLICO;
  const integro = Math.min(totalCentimos, tramo_integro);
  const resto = Math.max(totalCentimos - tramo_integro, 0);
  const parcial = Math.floor((resto * porcentaje_resto) / 100);
  return Math.min(integro + parcial, maximo);
}

// Reparte la exoneración limitada de un organismo entre sus créditos, en orden de id,
// para que el resultado sea siempre el mismo con los mismos datos.
function repartir(creditos, exonerableTotal) {
  let pendiente = exonerableTotal;
  return creditos.map((c) => {
    const ex = Math.min(c.importe, pendiente);
    pendiente -= ex;
    return { ...c, exonerado: ex };
  });
}

export function clasificarCreditos(creditosRaw) {
  const creditos = arr(creditosRaw)
    .map((c) => ({
      id: c.id,
      acreedor: c.acreedor.trim(),
      concepto: c.concepto.trim(),
      clase: c.clase,
      importe: aCentimos(c.importe),
      valor_garantia: c.valor_garantia == null ? null : aCentimos(c.valor_garantia),
      vencimiento: c.vencimiento ?? null
    }))
    .sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }));

  const resultado = [];
  const publicos = { publico_aeat: [], publico_tgss: [] };

  for (const c of creditos) {
    if (c.clase === 'ordinario') {
      resultado.push({ ...c, exonerado: c.importe, motivo: null });
    } else if (c.clase === 'garantia_real') {
      const cubierto = Math.min(c.importe, c.valor_garantia);
      resultado.push({ ...c, exonerado: c.importe - cubierto, motivo: cubierto ? 'parte cubierta por el valor de la garantía real (art. 489.1.8.º TRLC)' : null });
    } else if (c.clase in publicos) {
      publicos[c.clase].push(c);
    } else {
      resultado.push({ ...c, exonerado: 0, motivo: MOTIVO_NO_EXONERABLE[c.clase] });
    }
  }

  const detallePublico = {};
  for (const [clase, lista] of Object.entries(publicos)) {
    if (!lista.length) continue;
    const total = lista.reduce((s, c) => s + c.importe, 0);
    const exonerable = exoneracionPublicaLimitada(total);
    detallePublico[clase] = { total, exonerable, no_exonerable: total - exonerable };
    for (const c of repartir(lista, exonerable)) {
      resultado.push({ ...c, motivo: c.exonerado < c.importe ? 'límite legal de exoneración del crédito público (art. 489.1.5.º TRLC)' : null });
    }
  }

  resultado.sort((a, b) => a.id.localeCompare(b.id, 'es', { numeric: true }));
  const filas = resultado.map((c) => Object.freeze({ ...c, no_exonerado: c.importe - c.exonerado }));
  const totales = filas.reduce((t, c) => ({
    pasivo: t.pasivo + c.importe,
    exonerado: t.exonerado + c.exonerado,
    no_exonerado: t.no_exonerado + c.no_exonerado
  }), { pasivo: 0, exonerado: 0, no_exonerado: 0 });

  return Object.freeze({ filas: Object.freeze(filas), totales: Object.freeze(totales), publico: Object.freeze(detallePublico) });
}

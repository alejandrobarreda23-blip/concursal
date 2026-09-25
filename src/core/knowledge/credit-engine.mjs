import { aCentimos } from '../../util.mjs';

const arr = (value) => Array.isArray(value) ? value : [];

export function creditClassIds(runtime) {
  return Object.keys(runtime.getCatalog('creditos')?.clases || {});
}

function limitedAmount(total, limit) {
  const full = Math.min(total, Number(limit.tramo_integro || 0));
  const rest = Math.max(total - Number(limit.tramo_integro || 0), 0);
  const partial = Math.floor((rest * Number(limit.porcentaje_resto || 0)) / 100);
  return Math.min(full + partial, Number(limit.maximo || 0));
}

function distribute(list, totalExonerable) {
  let pending = totalExonerable;
  return list.map((credit) => {
    const ex = Math.min(credit.importe, pending);
    pending -= ex;
    return { ...credit, exonerado: ex };
  });
}

export function classifyCreditsWithKnowledge(creditosRaw, runtime) {
  const catalog = runtime.getCatalog('creditos');
  if (!catalog?.clases) throw new Error('Knowledge: falta catálogo de créditos.');
  const credits = arr(creditosRaw).map((c) => ({
    id: c.id,
    acreedor: String(c.acreedor || '').trim(),
    concepto: String(c.concepto || '').trim(),
    clase: c.clase,
    importe: aCentimos(c.importe),
    valor_garantia: c.valor_garantia == null ? null : aCentimos(c.valor_garantia),
    vencimiento: c.vencimiento ?? null
  })).sort((a, b) => String(a.id).localeCompare(String(b.id), 'es', { numeric: true }));

  const result = [];
  const grouped = new Map();

  for (const c of credits) {
    const cfg = catalog.clases[c.clase];
    if (!cfg) throw new Error(`Clase de crédito no definida en Knowledge: ${c.clase}`);
    if (cfg.strategy === 'full') result.push({ ...c, exonerado: c.importe, motivo: null });
    else if (cfg.strategy === 'none') result.push({ ...c, exonerado: 0, motivo: cfg.motivo || null });
    else if (cfg.strategy === 'secured_excess') {
      const covered = Math.min(c.importe, c.valor_garantia ?? 0);
      result.push({ ...c, exonerado: c.importe - covered, motivo: covered ? cfg.motivo || null : null });
    } else if (cfg.strategy === 'limited_group') {
      const group = cfg.group || c.clase;
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push({ ...c, _cfg: cfg });
    } else throw new Error(`Estrategia de crédito desconocida: ${cfg.strategy}`);
  }

  const publico = {};
  for (const [group, list] of grouped) {
    const cfg = list[0]._cfg;
    const total = list.reduce((sum, c) => sum + c.importe, 0);
    const exonerable = limitedAmount(total, cfg.limit || {});
    publico[group] = { total, exonerable, no_exonerable: total - exonerable };
    for (const c of distribute(list, exonerable)) {
      const { _cfg, ...clean } = c;
      result.push({ ...clean, motivo: clean.exonerado < clean.importe ? cfg.motivo || null : null });
    }
  }

  result.sort((a, b) => String(a.id).localeCompare(String(b.id), 'es', { numeric: true }));
  const filas = result.map((c) => Object.freeze({ ...c, no_exonerado: c.importe - c.exonerado }));
  const totales = filas.reduce((t, c) => ({
    pasivo: t.pasivo + c.importe,
    exonerado: t.exonerado + c.exonerado,
    no_exonerado: t.no_exonerado + c.no_exonerado
  }), { pasivo: 0, exonerado: 0, no_exonerado: 0 });
  return Object.freeze({ filas: Object.freeze(filas), totales: Object.freeze(totales), publico: Object.freeze(publico) });
}

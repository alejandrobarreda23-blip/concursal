import { aCentimos } from '../../util.mjs';

const arr = (value) => Array.isArray(value) ? value : [];
const PUBLIC_CLASSES = new Set(['publico_aeat', 'publico_tgss', 'publico_otro']);

export function creditClassIds(runtime) {
  return Object.keys(runtime.getCatalog('creditos')?.clases || {});
}

function limitedAmount(total, limit) {
  const full = Math.min(total, Number(limit.tramo_integro || 0));
  const rest = Math.max(total - Number(limit.tramo_integro || 0), 0);
  const partial = Math.floor((rest * Number(limit.porcentaje_resto || 0)) / 100);
  return Math.min(full + partial, Number(limit.maximo || 0));
}

function normalizedCreditorKey(c) {
  const explicit = String(c.acreedor_publico_id || '').trim();
  if (explicit) return explicit;
  const nif = String(c.nif || '').replace(/\s+/g, '').toUpperCase();
  if (nif) return `nif:${nif}`;
  const name = String(c.acreedor || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `nombre:${name || c.id || 'publico'}`;
}

const PRIORITY_RANK = Object.freeze({
  subordinado: 0,
  ordinario: 1,
  privilegio_general: 2,
  privilegio_especial: 3
});

function creditPriority(c) {
  return PRIORITY_RANK[c.rango_concursal] ?? 99;
}

function dateKey(c) {
  const raw = c.fecha_origen || c.antiguedad_fecha || null;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function sortPublicAllocation(list) {
  return [...list].sort((a, b) => {
    const pa = creditPriority(a), pb = creditPriority(b);
    if (pa !== pb) return pa - pb; // orden inverso a la prelación: menos preferente primero
    const da = dateKey(a), db = dateKey(b);
    if (da != null && db != null && da !== db) return da - db; // mayor antigüedad primero
    if (da != null && db == null) return -1;
    if (da == null && db != null) return 1;
    return String(a.id).localeCompare(String(b.id), 'es', { numeric: true });
  });
}

function distribute(list, totalExonerable) {
  let pending = totalExonerable;
  return list.map((credit) => {
    const ex = Math.min(credit.importe, pending);
    pending -= ex;
    return { ...credit, exonerado: ex };
  });
}

function publicSummaryKey(c) {
  return normalizedCreditorKey(c);
}

function publicDisplayName(list) {
  return list.find((c) => c.acreedor)?.acreedor || 'Acreedor público';
}

function publicAllocationWarnings(list, key) {
  const warnings = [];
  if (list.length > 1) {
    if (list.some((c) => !c.rango_concursal)) {
      warnings.push(`Crédito público ${publicDisplayName(list)}: falta la clase concursal de uno o más componentes; revise el orden inverso de prelación antes de firmar.`);
    }
    const byPriority = new Map();
    for (const c of list) {
      const p = c.rango_concursal || 'sin_clase';
      if (!byPriority.has(p)) byPriority.set(p, []);
      byPriority.get(p).push(c);
    }
    for (const [priority, rows] of byPriority) {
      if (rows.length > 1 && rows.some((c) => dateKey(c) == null)) {
        warnings.push(`Crédito público ${publicDisplayName(list)} (${priority}): falta fecha de origen/antigüedad en uno o más componentes; el reparto interno debe revisarse.`);
      }
    }
  }
  if (!key || key === 'nombre:publico') warnings.push('Crédito público: no se ha podido identificar de forma estable al acreedor.');
  return warnings;
}

export function classifyCreditsWithKnowledge(creditosRaw, runtime) {
  const catalog = runtime.getCatalog('creditos');
  if (!catalog?.clases) throw new Error('Knowledge: falta catálogo de créditos.');
  const credits = arr(creditosRaw).map((c) => ({
    id: c.id,
    acreedor: String(c.acreedor || '').trim(),
    nif: c.nif == null ? null : String(c.nif).trim(),
    acreedor_publico_id: c.acreedor_publico_id ?? null,
    concepto: String(c.concepto || '').trim(),
    clase: c.clase,
    importe: aCentimos(c.importe),
    valor_garantia: c.valor_garantia == null ? null : aCentimos(c.valor_garantia),
    vencimiento: c.vencimiento ?? null,
    rango_concursal: c.rango_concursal ?? null,
    fecha_origen: c.fecha_origen ?? c.antiguedad_fecha ?? null
  }));

  const result = [];
  const publicGroups = new Map();
  const warnings = [];

  for (const c of credits) {
    const cfg = catalog.clases[c.clase];
    if (!cfg) throw new Error(`Clase de crédito no definida en Knowledge: ${c.clase}`);

    if (cfg.strategy === 'full') {
      result.push({ ...c, exonerado: c.importe, motivo: null });
      continue;
    }
    if (cfg.strategy === 'none') {
      result.push({ ...c, exonerado: 0, motivo: cfg.motivo || null });
      continue;
    }
    if (cfg.strategy === 'secured_excess') {
      const covered = Math.min(c.importe, c.valor_garantia ?? 0);
      result.push({ ...c, exonerado: c.importe - covered, motivo: covered ? cfg.motivo || null : null });
      continue;
    }

    if (cfg.strategy === 'public_per_creditor') {
      // Tras SSTS 260/2026 y 264/2026, el crédito público subordinado queda íntegramente exonerado.
      if (c.rango_concursal === 'subordinado') {
        result.push({ ...c, exonerado: c.importe, motivo: null, credito_publico_subordinado: true });
        continue;
      }
      const key = publicSummaryKey(c);
      if (!publicGroups.has(key)) publicGroups.set(key, []);
      publicGroups.get(key).push({ ...c, _cfg: cfg });
      continue;
    }

    // Compatibilidad temporal con packs antiguos.
    if (cfg.strategy === 'limited_group') {
      const key = cfg.group || c.clase;
      if (!publicGroups.has(key)) publicGroups.set(key, []);
      publicGroups.get(key).push({ ...c, _cfg: cfg });
      continue;
    }
    throw new Error(`Estrategia de crédito desconocida: ${cfg.strategy}`);
  }

  const publico = {};
  for (const [key, rawList] of publicGroups) {
    const cfg = rawList[0]._cfg;
    const list = sortPublicAllocation(rawList);
    const total = list.reduce((sum, c) => sum + c.importe, 0);
    const exonerable = limitedAmount(total, cfg.limit || {});
    const groupWarnings = publicAllocationWarnings(list, key);
    warnings.push(...groupWarnings);
    publico[key] = {
      acreedor: publicDisplayName(list),
      creditor_key: key,
      total,
      exonerable,
      no_exonerable: total - exonerable,
      subordinado_exonerado: 0,
      warnings: groupWarnings
    };
    for (const c of distribute(list, exonerable)) {
      const { _cfg, ...clean } = c;
      result.push({
        ...clean,
        motivo: clean.exonerado < clean.importe
          ? cfg.motivo || 'límite de exoneración del crédito público'
          : null
      });
    }
  }

  // Añadir al resumen público los subordinados ya exonerados íntegramente.
  for (const row of result.filter((c) => c.credito_publico_subordinado)) {
    const key = publicSummaryKey(row);
    const current = publico[key] || {
      acreedor: row.acreedor,
      creditor_key: key,
      total: 0,
      exonerable: 0,
      no_exonerable: 0,
      subordinado_exonerado: 0,
      warnings: []
    };
    current.total += row.importe;
    current.exonerable += row.importe;
    current.subordinado_exonerado += row.importe;
    publico[key] = current;
  }

  result.sort((a, b) => String(a.id).localeCompare(String(b.id), 'es', { numeric: true }));
  const filas = result.map((c) => Object.freeze({ ...c, no_exonerado: c.importe - c.exonerado }));
  const totales = filas.reduce((t, c) => ({
    pasivo: t.pasivo + c.importe,
    exonerado: t.exonerado + c.exonerado,
    no_exonerado: t.no_exonerado + c.no_exonerado
  }), { pasivo: 0, exonerado: 0, no_exonerado: 0 });
  return Object.freeze({
    filas: Object.freeze(filas),
    totales: Object.freeze(totales),
    publico: Object.freeze(publico),
    avisos: Object.freeze([...new Set(warnings)])
  });
}

export { limitedAmount };

import { hash, deepFreeze } from '../../util.mjs';
import { mergeCandidate, validateExtractionField } from '../../core/extraction/contracts.mjs';

export const CONCURSAL_AI_EXTRACTION_VERSION = 'concursal-ai-extraction-v1';

const arr = (value) => Array.isArray(value) ? value : [];

export function documentoATextoMarcado(doc) {
  return arr(doc?.paginas).flatMap((pagina) =>
    arr(pagina.lineas).map((linea, index) => `[p.${pagina.pagina} l.${index + 1}] ${linea.texto}`)
  ).join('\n');
}

function aiField(raw, transform = (x) => x) {
  if (!raw || raw.value == null || raw.value === '') return null;
  const validation = validateExtractionField(raw);
  if (!validation.ok) return null;
  const value = transform(raw.value);
  if (value == null || value === '') return null;
  return {
    valor: value,
    regla: 'AI.extract.v1',
    fuente: raw.evidence ? {
      pagina: raw.evidence.page ?? null,
      linea: raw.evidence.line ?? null,
      texto: raw.evidence.quote ?? ''
    } : null,
    confianza: Number(raw.confidence),
    origen: 'ia'
  };
}

function amountToCents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function normalizeNif(value) {
  return String(value || '').replace(/[-\s]/g, '').toUpperCase();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeClass(creditor) {
  if (creditor?.garantia_real === true) return 'garantia_real';
  if (creditor?.tipo_acreedor === 'aeat') return 'publico_aeat';
  if (creditor?.tipo_acreedor === 'tgss') return 'publico_tgss';
  if (['ccaa', 'local', 'otro_publico'].includes(creditor?.tipo_acreedor)) return 'publico_otro';
  return 'ordinario';
}

function creditorFromAi(row, index) {
  if (!row || !row.acreedor || !Number.isFinite(Number(row.importe_euros))) return null;
  return {
    id: `C${index + 1}`,
    acreedor: normalizeText(row.acreedor),
    nif: row.nif ? normalizeNif(row.nif) : null,
    concepto: normalizeText(row.concepto || 'Sin concepto indicado'),
    garantia: row.garantia_real === true ? 'garantía real' : null,
    importe: amountToCents(row.importe_euros),
    clase: normalizeClass(row),
    rango_concursal: row.clase_concursal || null,
    fecha_origen: row.fecha_origen || null,
    regla_clase: 'AI.extract.classification.v1',
    fuente: row.evidence ? {
      pagina: row.evidence.page ?? null,
      linea: row.evidence.line ?? null,
      texto: row.evidence.quote ?? ''
    } : null,
    confianza: Number(row.confidence || 0),
    origen: 'ia',
    ai_detalle: {
      tipo_acreedor: row.tipo_acreedor || null,
      clase_concursal: row.clase_concursal || null,
      fecha_origen: row.fecha_origen || null,
      concepto_categoria: row.concepto_categoria || null,
      garantia_real: row.garantia_real === true,
      valor_garantia: row.valor_garantia == null ? null : Number(row.valor_garantia)
    }
  };
}

function mergeExistingField(existing, assisted, transform = (x) => x, threshold = 0.72) {
  const candidate = assisted ? { value: transform(assisted.value), confidence: assisted.confidence } : null;
  const deterministic = existing ? { value: existing.valor } : null;
  const merged = mergeCandidate({ deterministic, assisted: candidate, threshold, preferAssisted: true });
  if (merged.selected === 'assisted') return aiField({ ...assisted, value: assisted.value }, transform);
  if (merged.selected === 'confirmed' && existing) return { ...existing, confirmado_por_ia: true, confianza_ia: Number(assisted?.confidence || 0) };
  return existing || null;
}

function filterResolvedMissingAlerts(alertas, lectura) {
  return arr(alertas).filter((a) => {
    const t = String(a.texto || '').toLowerCase();
    if (t.includes('nombre del deudor') && lectura.campos.deudor_nombre) return false;
    if ((t.includes('nif/nie') || t.includes('nif')) && lectura.campos.deudor_nif) return false;
    if (t.includes('domicilio del deudor') && lectura.campos.deudor_domicilio) return false;
    if (t.includes('pasivo declarado') && lectura.campos.pasivo_declarado) return false;
    if (t.includes('activo declarado') && lectura.campos.activo_declarado) return false;
    if (t.includes('relación de acreedores') && lectura.acreedores.length) return false;
    return true;
  });
}

export function fusionarLecturaConIA(deterministic, proposal, { model = null, provider = 'openai' } = {}) {
  if (!proposal || typeof proposal !== 'object') return deterministic;
  const lectura = JSON.parse(JSON.stringify(deterministic));
  const p = proposal;

  const map = [
    ['deudor_nombre', p.campos?.deudor_nombre, normalizeText],
    ['deudor_nif', p.campos?.deudor_nif, normalizeNif],
    ['deudor_domicilio', p.campos?.deudor_domicilio, normalizeText],
    ['deudor_localidad', p.campos?.deudor_localidad, normalizeText],
    ['estado_civil', p.campos?.estado_civil, normalizeText],
    ['regimen_economico', p.campos?.regimen_economico, normalizeText],
    ['procurador', p.campos?.procurador, normalizeText],
    ['abogado', p.campos?.abogado, normalizeText],
    ['organo_destino', p.campos?.organo_destino, normalizeText],
    ['fecha_escrito', p.campos?.fecha_escrito, normalizeText],
    ['pasivo_declarado', p.campos?.pasivo_declarado_euros, amountToCents],
    ['activo_declarado', p.campos?.activo_declarado_euros, amountToCents],
    ['numero_acreedores', p.campos?.numero_acreedores, (x) => Number.isFinite(Number(x)) ? Number(x) : null]
  ];
  for (const [key, assisted, transform] of map) {
    const before = lectura.campos[key] || null;
    lectura.campos[key] = mergeExistingField(before, assisted, transform) || undefined;
    if (lectura.campos[key] === undefined) delete lectura.campos[key];
  }

  const classKeys = ['tipo', 'solicitante', 'persona', 'empresario', 'insolvencia', 'pide_epi', 'plan_pagos', 'formulario_icab', 'indicio_masa'];
  for (const key of classKeys) {
    const assisted = p.clasificacion?.[key];
    if (!assisted || assisted.value == null) continue;
    const current = lectura.clasificacion[key];
    const merged = mergeCandidate({
      deterministic: current == null ? null : { value: current },
      assisted: { value: assisted.value, confidence: assisted.confidence },
      threshold: 0.75,
      preferAssisted: true
    });
    lectura.clasificacion[key] = merged.value;
    lectura.clasificacion.evidencias ||= [];
    lectura.clasificacion.evidencias.push({
      regla: 'AI.classification.v1',
      campo: key,
      confianza: Number(assisted.confidence || 0),
      conflicto: merged.conflict || false,
      fuente: assisted.evidence ? {
        pagina: assisted.evidence.page ?? null,
        linea: assisted.evidence.line ?? null,
        texto: assisted.evidence.quote ?? ''
      } : null
    });
  }

  for (const key of ['poder', 'memoria', 'inventario', 'relacion_acreedores', 'formulario_anexo_i']) {
    const assisted = p.documentos?.[key];
    if (!assisted || assisted.value == null || Number(assisted.confidence || 0) < 0.65) continue;
    const present = Boolean(assisted.value);
    lectura.documentos[key] = {
      presente: present,
      regla: 'AI.document.v1',
      confianza: Number(assisted.confidence || 0),
      fuente: assisted.evidence ? {
        pagina: assisted.evidence.page ?? null,
        linea: assisted.evidence.line ?? null,
        texto: assisted.evidence.quote ?? ''
      } : null
    };
  }

  const aiCreditors = arr(p.acreedores).map(creditorFromAi).filter(Boolean);
  const avg = aiCreditors.length ? aiCreditors.reduce((s, c) => s + Number(c.confianza || 0), 0) / aiCreditors.length : 0;
  if (aiCreditors.length && (lectura.acreedores.length === 0 || avg >= 0.72)) lectura.acreedores = aiCreditors;
  lectura.suma_acreedores = lectura.acreedores.reduce((s, c) => s + (Number(c.importe) || 0), 0);

  lectura.alertas = filterResolvedMissingAlerts(lectura.alertas, lectura);
  lectura.alertas.push({
    nivel: 'info',
    texto: `Extracción IA asistida (${provider}${model ? ` · ${model}` : ''}). Todos los datos siguen sujetos a revisión humana antes de generar la resolución.`
  });
  for (const warning of arr(p.warnings)) lectura.alertas.push({ nivel: 'aviso', texto: String(warning) });

  lectura.extractor = {
    mode: 'hybrid',
    deterministic_version: deterministic.version,
    assisted_version: CONCURSAL_AI_EXTRACTION_VERSION,
    provider,
    model,
    review_required: true
  };
  lectura.hash_lectura = hash(lectura);
  return deepFreeze(lectura);
}

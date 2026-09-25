export const EXTRACTION_ENVELOPE_VERSION = 'legal-core-extraction-v1';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite01 = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;

export function validateExtractionEvidence(evidence) {
  if (evidence == null) return { ok: true };
  const errors = [];
  if (!isObject(evidence)) errors.push('evidence debe ser objeto o null');
  else {
    if (evidence.page != null && (!Number.isInteger(evidence.page) || evidence.page < 1)) errors.push('evidence.page debe ser entero positivo o null');
    if (evidence.line != null && (!Number.isInteger(evidence.line) || evidence.line < 1)) errors.push('evidence.line debe ser entero positivo o null');
    if (evidence.quote != null && typeof evidence.quote !== 'string') errors.push('evidence.quote debe ser texto o null');
  }
  return { ok: errors.length === 0, errors };
}

export function validateExtractionField(field, { label = 'field' } = {}) {
  const errors = [];
  if (!isObject(field)) return { ok: false, errors: [`${label} debe ser objeto`] };
  if (!Object.hasOwn(field, 'value')) errors.push(`${label}.value es obligatorio`);
  if (!finite01(field.confidence)) errors.push(`${label}.confidence debe estar entre 0 y 1`);
  const evidence = validateExtractionEvidence(field.evidence);
  if (!evidence.ok) errors.push(...evidence.errors.map((e) => `${label}.${e}`));
  return { ok: errors.length === 0, errors };
}

export function buildExtractionEnvelope({ provider, model = null, proposal, sourceHash = null, warnings = [] } = {}) {
  if (!provider) throw new Error('EXTRACTION_PROVIDER_REQUIRED');
  if (!isObject(proposal)) throw new Error('EXTRACTION_PROPOSAL_REQUIRED');
  return Object.freeze({
    version: EXTRACTION_ENVELOPE_VERSION,
    provider: String(provider),
    model: model ? String(model) : null,
    source_hash: sourceHash || null,
    created_at: new Date().toISOString(),
    review_required: true,
    warnings: Object.freeze(Array.isArray(warnings) ? [...warnings] : []),
    proposal
  });
}

export function mergeCandidate({ deterministic = null, assisted = null, threshold = 0.72, preferAssisted = true } = {}) {
  if (!assisted || assisted.value == null || assisted.value === '') {
    return { value: deterministic?.value ?? null, selected: deterministic ? 'deterministic' : 'missing', conflict: false };
  }
  const confidence = Number(assisted.confidence || 0);
  if (!deterministic || deterministic.value == null || deterministic.value === '') {
    return { value: assisted.value, selected: 'assisted', conflict: false };
  }
  const same = String(deterministic.value).trim().toLowerCase() === String(assisted.value).trim().toLowerCase();
  if (same) return { value: deterministic.value, selected: 'confirmed', conflict: false };
  if (preferAssisted && confidence >= threshold) return { value: assisted.value, selected: 'assisted', conflict: true };
  return { value: deterministic.value, selected: 'deterministic', conflict: true };
}

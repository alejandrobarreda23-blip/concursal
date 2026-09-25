import { sha256Hex } from '../../sha256-sync.mjs';
import { KNOWLEDGE_COMPILER_VERSION, KNOWLEDGE_CONTRACT_VERSION, KNOWLEDGE_RUNTIME_VERSION } from './version.mjs';

export const KNOWLEDGE_ITEM_TYPES = Object.freeze([
  'cuestion_juridica',
  'regla_determinista',
  'criterio_valorativo',
  'esquema_probatorio',
  'precedente_calibracion',
  'fuente_juridica',
  'bloque_redaccion',
  'antipatron',
  'conflicto_criterio',
  'hueco_sin_criterio'
]);

export const SOURCE_VERIFICATION_STATES = Object.freeze([
  'resumen_no_verificado',
  'verificado_con_ficha',
  'verificado_con_sentencia',
  'certificado_por_juez'
]);

export const CRITERION_MATURITY_STATES = Object.freeze([
  'regla_normativa',
  'estable_multicaso',
  'ratificado_caso_unico',
  'tentativo',
  'conflictivo',
  'sin_criterio'
]);

export const RUNTIME_SURFACES = Object.freeze({
  DECISION: 'decision',
  DRAFTING: 'redaccion',
  GOVERNANCE: 'gobernanza'
});

const REQUIRED_COLLECTIONS = Object.freeze([
  'cuestiones',
  'reglas',
  'esquemas_probatorios',
  'precedentes',
  'fuentes',
  'bloques_redaccion',
  'antipatrones',
  'conflictos',
  'huecos'
]);

const COLLECTION_TYPE = Object.freeze({
  cuestiones: 'cuestion_juridica',
  reglas: null,
  esquemas_probatorios: 'esquema_probatorio',
  precedentes: 'precedente_calibracion',
  fuentes: 'fuente_juridica',
  bloques_redaccion: 'bloque_redaccion',
  antipatrones: 'antipatron',
  conflictos: 'conflicto_criterio',
  huecos: 'hueco_sin_criterio'
});

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export const canonicalJson = (value) => JSON.stringify(canonicalize(value));
export const sha256Knowledge = (value) => sha256Hex(typeof value === 'string' ? value : canonicalJson(value));

function requiredText(value, label, errors) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${label} debe ser texto no vacío`);
}

function validateRouting(pack, errors) {
  const routing = pack?.gobernanza?.routing;
  if (!isObject(routing)) return errors.push('gobernanza.routing es obligatorio');
  requiredText(routing.primary_matter, 'gobernanza.routing.primary_matter', errors);
  if (!Array.isArray(routing.accepted_profiles) || !routing.accepted_profiles.length) errors.push('gobernanza.routing.accepted_profiles debe contener al menos un perfil');
  if (!['base', 'causal', 'transversal', 'sectorial'].includes(routing.role)) errors.push('gobernanza.routing.role inválido');
  if (!['standalone', 'augment', 'specialize'].includes(routing.merge_mode)) errors.push('gobernanza.routing.merge_mode inválido');
  if (!Number.isInteger(routing.precedence) || routing.precedence < 0) errors.push('gobernanza.routing.precedence debe ser entero no negativo');
  if (!Number.isInteger(routing.display_order) || routing.display_order < 0) errors.push('gobernanza.routing.display_order debe ser entero no negativo');
  if (!['on_demand', 'eager'].includes(routing.load_policy)) errors.push('gobernanza.routing.load_policy inválido');
  if (!Array.isArray(routing.extends)) errors.push('gobernanza.routing.extends debe ser array');
  if (!Array.isArray(routing.specializes)) errors.push('gobernanza.routing.specializes debe ser array');
}

function validateItem(item, path, expectedType, ids, errors) {
  if (!isObject(item)) return errors.push(`${path} debe ser objeto`);
  requiredText(item.id, `${path}.id`, errors);
  if (item.id && ids.has(item.id)) errors.push(`id duplicado: ${item.id}`);
  if (item.id) ids.add(item.id);
  requiredText(item.tipo, `${path}.tipo`, errors);
  if (!KNOWLEDGE_ITEM_TYPES.includes(item.tipo)) errors.push(`${path}.tipo no reconocido: ${item.tipo}`);
  if (expectedType && item.tipo !== expectedType) errors.push(`${path}.tipo debe ser ${expectedType}`);
  if (path.includes('.reglas[') && !['regla_determinista', 'criterio_valorativo'].includes(item.tipo)) errors.push(`${path}.tipo debe ser regla_determinista o criterio_valorativo`);
  requiredText(item.titulo, `${path}.titulo`, errors);
  if (!Array.isArray(item.materias) || !item.materias.length) errors.push(`${path}.materias debe contener al menos una materia`);
  if (!Array.isArray(item.cuestiones)) errors.push(`${path}.cuestiones debe ser array`);
  if (!Object.values(RUNTIME_SURFACES).includes(item.superficie)) errors.push(`${path}.superficie inválida`);
  if (!isObject(item.estado)) errors.push(`${path}.estado es obligatorio`);
  else {
    if (!SOURCE_VERIFICATION_STATES.includes(item.estado.fuente)) errors.push(`${path}.estado.fuente inválido`);
    if (!CRITERION_MATURITY_STATES.includes(item.estado.madurez)) errors.push(`${path}.estado.madurez inválido`);
  }
  if (!isObject(item.procedencia)) errors.push(`${path}.procedencia es obligatoria`);
}

function validateReferences(pack, ids, errors) {
  const questionIds = new Set((pack.cuestiones || []).map((item) => item.id));
  for (const collection of REQUIRED_COLLECTIONS) {
    for (const item of pack[collection] || []) {
      for (const q of item.cuestiones || []) if (!questionIds.has(q)) errors.push(`cuestión inexistente ${q} en ${item.id}`);
      for (const key of ['fuentes_juridicas', 'precedentes_calibracion', 'bloques_redaccion', 'antipatrones_relacionados']) {
        for (const ref of Array.isArray(item[key]) ? item[key] : []) if (!ids.has(ref)) errors.push(`referencia inexistente ${ref} en ${item.id}.${key}`);
      }
      for (const key of ['fuente_id', 'precedente_id', 'esquema_probatorio', 'depends_on_rule']) {
        if (typeof item[key] === 'string' && !ids.has(item[key])) errors.push(`referencia inexistente ${item[key]} en ${item.id}.${key}`);
      }
    }
  }
}

export function validateKnowledgePack(pack, { strict = true } = {}) {
  const errors = [];
  if (!isObject(pack)) throw new Error('Knowledge pack debe ser objeto');
  if (pack.contract_version !== KNOWLEDGE_CONTRACT_VERSION) errors.push(`contract_version debe ser ${KNOWLEDGE_CONTRACT_VERSION}`);
  requiredText(pack.pack_id, 'pack_id', errors);
  requiredText(pack.version, 'version', errors);
  requiredText(pack.titulo, 'titulo', errors);
  if (!Array.isArray(pack.materias) || !pack.materias.length) errors.push('materias debe contener al menos una materia');
  if (!isObject(pack.gobernanza)) errors.push('gobernanza es obligatoria');
  validateRouting(pack, errors);
  for (const collection of REQUIRED_COLLECTIONS) if (!Array.isArray(pack[collection])) errors.push(`${collection} debe ser array`);

  const ids = new Set();
  for (const collection of REQUIRED_COLLECTIONS) {
    (pack[collection] || []).forEach((item, index) => validateItem(item, `$.${collection}[${index}]`, COLLECTION_TYPE[collection], ids, errors));
  }
  if (strict) validateReferences(pack, ids, errors);
  if (errors.length) throw new Error(`Knowledge pack inválido:\n- ${errors.join('\n- ')}`);
  return { ok: true, ids: [...ids], items: ids.size };
}

export function compileKnowledgePack(pack) {
  const validation = validateKnowledgePack(pack);
  const normalized = canonicalize(pack);
  const decisionCollections = ['cuestiones', 'reglas', 'esquemas_probatorios', 'precedentes', 'fuentes', 'antipatrones', 'conflictos', 'huecos'];
  const decision = Object.fromEntries(decisionCollections.map((key) => [key, normalized[key].filter((item) => item.superficie !== RUNTIME_SURFACES.DRAFTING)]));
  const drafting = { bloques_redaccion: normalized.bloques_redaccion.filter((item) => item.superficie === RUNTIME_SURFACES.DRAFTING) };
  const core = {
    runtime_version: KNOWLEDGE_RUNTIME_VERSION,
    compiler_version: KNOWLEDGE_COMPILER_VERSION,
    contract_version: KNOWLEDGE_CONTRACT_VERSION,
    pack_id: normalized.pack_id,
    version: normalized.version,
    titulo: normalized.titulo,
    materias: normalized.materias,
    gobernanza: normalized.gobernanza,
    superficies: { decision, redaccion: drafting },
    estadisticas: Object.fromEntries(REQUIRED_COLLECTIONS.map((key) => [key, normalized[key].length]))
  };
  return Object.freeze({ ...core, pack_hash: sha256Knowledge(core), validation });
}

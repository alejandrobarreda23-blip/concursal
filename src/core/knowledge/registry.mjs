// Registro y routing genérico de Knowledge Packs.
// Hoy solo hay un pack concursal; el contrato permite añadir otros procedimientos sin tocar el core.
const arr = (value) => Array.isArray(value) ? value : [];

const routing = (runtime) => runtime?.compiled?.gobernanza?.routing || {};
const precedence = (runtime) => Number(routing(runtime).precedence || 0);

export function validateKnowledgeGraph(runtimes = []) {
  const byId = new Map();
  const errors = [];
  for (const runtime of arr(runtimes)) {
    if (!runtime?.pack_id) { errors.push('Runtime sin pack_id'); continue; }
    if (byId.has(runtime.pack_id)) errors.push(`pack_id duplicado: ${runtime.pack_id}`);
    byId.set(runtime.pack_id, runtime);
  }
  for (const runtime of byId.values()) {
    for (const parent of arr(routing(runtime).extends)) {
      if (!byId.has(parent)) errors.push(`${runtime.pack_id}: extends referencia pack inexistente ${parent}`);
      if (parent === runtime.pack_id) errors.push(`${runtime.pack_id}: no puede extenderse a sí mismo`);
    }
  }
  if (errors.length) throw new Error(`Grafo de Knowledge inválido:\n- ${errors.join('\n- ')}`);
  return { ok: true, packs: byId.size };
}

export function createKnowledgeRegistry(runtimes = []) {
  validateKnowledgeGraph(runtimes);
  const ordered = [...runtimes].sort((a, b) => precedence(b) - precedence(a) || a.pack_id.localeCompare(b.pack_id));
  return Object.freeze({
    runtimes: Object.freeze(ordered),
    get(packId) { return ordered.find((runtime) => runtime.pack_id === packId) || null; },
    select(profile) {
      return ordered.filter((runtime) => arr(routing(runtime).accepted_profiles).includes(profile));
    },
    primary(profile) {
      return this.select(profile)[0] || null;
    }
  });
}

// Punto de entrada Node: el mismo Legal Core con el Knowledge Pack concursal por defecto.
import { generarAutoConclusion } from './motor.mjs';
import { generarAutoDeclaracion } from './declaracion.mjs';
import { loadKnowledgeRuntime, KNOWLEDGE_CONCURSAL_CSM } from './core/knowledge/node-loader.mjs';

let defaultKnowledge = null;
export function cargarKnowledge() {
  if (!defaultKnowledge) defaultKnowledge = loadKnowledgeRuntime(KNOWLEDGE_CONCURSAL_CSM);
  return defaultKnowledge;
}

export function generarAuto(expediente, { knowledge = cargarKnowledge(), pack = null } = {}) {
  return generarAutoConclusion(expediente, { knowledge, pack });
}

export function generarDeclaracion(expediente, { knowledge = cargarKnowledge(), pack = null } = {}) {
  return generarAutoDeclaracion(expediente, { knowledge, pack });
}

export { KNOWLEDGE_CONCURSAL_CSM };
export * from './motor.mjs';
export { validarExpedienteDeclaracion, determinarFaseDeclaracion, catalogoSupuestos37Bis } from './declaracion.mjs';
export * from './core/knowledge/index.mjs';
export * from './core/human-decision-boundary.mjs';

export { loadConcursalKnowledgeRegistry, KNOWLEDGE_PERSONA_FISICA_SOURCE } from './adapters/concursal/load-knowledge.mjs';

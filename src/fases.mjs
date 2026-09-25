// Adaptador de workflow concursal sobre el motor genérico de Knowledge.
// El código no contiene reglas de conclusión: las carga del Knowledge Pack.
import { evaluateWorkflow } from './core/knowledge/workflow.mjs';

export const ESTADOS = Object.freeze({
  LISTO: 'listo',
  PENDIENTE_DECISION: 'pendiente_decision',
  PENDIENTE_TRAMITE: 'pendiente_tramite',
  FUERA_DE_ALCANCE: 'fuera_de_alcance'
});

export function determinarFase(exp, { knowledge } = {}) {
  if (!knowledge) throw new Error('determinarFase: falta Knowledge Runtime.');
  return evaluateWorkflow(knowledge, 'conclusion', exp);
}

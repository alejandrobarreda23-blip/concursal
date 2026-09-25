import { evaluateJsonLogic, jsonLogicTruthy } from './json-logic.mjs';

const arr = (value) => Array.isArray(value) ? value : [];

export function evaluateKnowledgeRule(rule, data) {
  if (!rule) throw new Error('KNOWLEDGE_RULE_REQUIRED');
  const value = rule.condicion == null ? true : evaluateJsonLogic(rule.condicion, data);
  const triggered = jsonLogicTruthy(value);
  const subconditions = triggered ? arr(rule.sub_condiciones).map((sub) => ({
    id: sub.id || null,
    matched: jsonLogicTruthy(evaluateJsonLogic(sub.condicion, data)),
    mensaje: sub.mensaje || null
  })).filter((item) => item.matched) : [];
  return Object.freeze({
    rule_id: rule.id,
    source_id: rule.source_id || null,
    triggered,
    value,
    rule_type: rule.tipo,
    severity: rule.severidad || null,
    title: rule.titulo || rule.id,
    message: triggered ? rule.mensaje || null : null,
    effect: triggered ? rule.efecto ?? null : null,
    else_effect: !triggered ? rule.else ?? null : null,
    subconditions: Object.freeze(subconditions),
    requires_human_decision: rule.tipo === 'criterio_valorativo'
  });
}

export function evaluateKnowledgeModule(runtime, module, data) {
  if (!runtime?.listCollection) throw new Error('KNOWLEDGE_RUNTIME_REQUIRED');
  const rules = runtime.listCollection('reglas').filter((rule) => rule.modulo === module);
  const evaluations = rules.map((rule) => evaluateKnowledgeRule(rule, data));
  const triggered = evaluations.filter((item) => item.triggered);
  return Object.freeze({
    module,
    rules_evaluated: rules.length,
    triggered: Object.freeze(triggered),
    automatic: Object.freeze(triggered.filter((item) => !item.requires_human_decision)),
    judicial_questions: Object.freeze(triggered.filter((item) => item.requires_human_decision)),
    blocking: Object.freeze(triggered.filter((item) => ['bloqueante','requerimiento','derivacion'].includes(item.severity)))
  });
}

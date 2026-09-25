// Política de resultado reutilizada del patrón de Knowledge de "legal".
// Distingue falta de prueba, conflicto, hueco y criterio disponible sin decidir por el juez.
export const KNOWLEDGE_RESULT_POLICY_VERSION = 'legal-core-result-policy-v1';

const arr = (value) => Array.isArray(value) ? value : [];

const EVIDENCE_BLOCKING_STATUSES = new Set([
  'sin_dato_relacionado',
  'datos_relacionados_insuficientes',
  'pendiente_lectura_visual',
  'divergencia_o_contradiccion',
  'fallback_textual_sin_confirmar'
]);

export function resolveQuestionResultPolicy({
  dependencyStatus = 'activa',
  evidentiaryStatus = 'sin_dato_relacionado',
  decisiveCoverageComplete = false,
  conditionalCoverageComplete = true,
  selectedRules = [],
  requiresStructuredConfirmation = false,
  structuredConfirmationComplete = true,
  conflicts = [],
  gaps = []
} = {}) {
  const rules = arr(selectedRules);
  const applicableConflicts = arr(conflicts);
  const applicableGaps = arr(gaps);
  const deferred = String(dependencyStatus || '').startsWith('diferida');
  const evidenceBlocked = EVIDENCE_BLOCKING_STATUSES.has(evidentiaryStatus)
    || (requiresStructuredConfirmation && !structuredConfirmationComplete)
    || !decisiveCoverageComplete
    || !conditionalCoverageComplete;
  const tentative = rules.some((rule) => ['tentativo', 'conflictivo'].includes(rule?.estado?.madurez || rule?.maturity));

  if (deferred) return {
    result_policy: 'diferida',
    knowledge_state: 'diferida_por_orden_logico',
    requires_human_review: false,
    blocks_automatic_reasoning: true,
    abstention_reason: 'La cuestión depende de otra cuestión o del resultado sustantivo previo.'
  };
  if (evidenceBlocked) return {
    result_policy: 'pendiente_de_prueba',
    knowledge_state: 'sustrato_documental_incompleto',
    requires_human_review: false,
    blocks_automatic_reasoning: true,
    abstention_reason: evidentiaryStatus === 'divergencia_o_contradiccion'
      ? 'La prueba decisiva presenta una divergencia o contradicción.'
      : 'Faltan hechos decisivos o confirmaciones estructuradas.'
  };
  if (applicableConflicts.length) return {
    result_policy: 'revision_judicial_obligatoria',
    knowledge_state: 'conflicto_de_criterio_aplicable',
    requires_human_review: true,
    blocks_automatic_reasoning: true,
    abstention_reason: 'El Knowledge contiene criterios incompatibles aplicables al supuesto.'
  };
  if (applicableGaps.length) return {
    result_policy: 'hueco_declarado',
    knowledge_state: 'hueco_de_criterio_catalogado',
    requires_human_review: true,
    blocks_automatic_reasoning: true,
    abstention_reason: 'El Knowledge declara expresamente que no existe criterio consolidado.'
  };
  if (!rules.length) return {
    result_policy: 'laguna_de_criterio_no_catalogada',
    knowledge_state: 'laguna_no_prevista',
    requires_human_review: true,
    blocks_automatic_reasoning: true,
    abstention_reason: 'La cuestión tiene sustrato, pero no existe regla aplicable ni hueco declarado.'
  };
  if (tentative) return {
    result_policy: 'valoracion_judicial_asistida',
    knowledge_state: 'regla_tentativa_o_conflictiva',
    requires_human_review: true,
    blocks_automatic_reasoning: false,
    abstention_reason: null
  };
  return {
    result_policy: 'preview_no_decisorio',
    knowledge_state: 'criterio_disponible',
    requires_human_review: false,
    blocks_automatic_reasoning: false,
    abstention_reason: null
  };
}

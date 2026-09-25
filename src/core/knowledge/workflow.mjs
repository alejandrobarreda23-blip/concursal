const arr = (value) => Array.isArray(value) ? value : [];

export function readPath(obj, path) {
  return String(path || '').split('.').filter(Boolean).reduce((value, key) => value == null ? value : value[key], obj);
}

export function conditionMatches(condition, input) {
  if (!condition) return true;
  const value = readPath(input, condition.path);
  const expected = condition.value;
  switch (condition.op) {
    case 'eq': return value === expected;
    case 'neq': return value !== expected;
    case 'eq_if_present': return value == null || value === '' || value === expected;
    case 'neq_if_present': return value != null && value !== '' && value !== expected;
    case 'in': return arr(expected).map(String).includes(String(value));
    case 'not_in': return !arr(expected).map(String).includes(String(value));
    case 'truthy': return Boolean(value);
    case 'falsy': return !value;
    case 'blank': return value == null || String(value).trim() === '';
    case 'not_blank': return value != null && String(value).trim() !== '';
    case 'present': return value !== undefined && value !== null;
    case 'missing': return value === undefined || value === null;
    case 'array_nonempty': return Array.isArray(value) && value.length > 0;
    case 'array_empty': return Array.isArray(value) && value.length === 0;
    default: throw new Error(`Operador de workflow desconocido: ${condition.op}`);
  }
}

function applies(rule, variant) {
  return !Array.isArray(rule.applies_to) || rule.applies_to.includes(variant);
}

function expectedCondition(rule, variant) {
  if (!rule.expected_by_variant) return rule.condition;
  return { ...rule.condition, value: rule.expected_by_variant[variant] };
}

export function selectWorkflowVariant(workflow, input) {
  for (const item of arr(workflow?.variants)) {
    if (item.default === true || conditionMatches(item.when, input)) return item.variant;
  }
  return workflow?.variant || null;
}

export function evaluateWorkflow(runtime, profile, input) {
  const workflow = runtime.getWorkflow(profile);
  if (!workflow) throw new Error(`Workflow no definido: ${profile}`);
  const variant = selectWorkflowVariant(workflow, input);

  const byState = new Map();
  for (const guard of arr(workflow.guards)) {
    if (!applies(guard, variant) || !conditionMatches(guard.when, input)) continue;
    const state = guard.state || 'fuera_de_alcance';
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state).push(guard.message);
  }
  for (const state of ['fuera_de_alcance', 'pendiente_tramite']) {
    if (byState.get(state)?.length) return Object.freeze({ estado: state, variante: variant, motivos: Object.freeze(byState.get(state)) });
  }

  const pending = [];
  for (const requirement of arr(workflow.requirements)) {
    if (!applies(requirement, variant)) continue;
    const condition = expectedCondition(requirement, variant);
    if (!conditionMatches(condition, input)) pending.push(requirement.message);
  }
  if (pending.length) return Object.freeze({ estado: 'pendiente_decision', variante: variant, motivos: Object.freeze(pending) });
  return Object.freeze({ estado: 'listo', variante: variant, motivos: Object.freeze([]) });
}

export function evaluateWorkflowWarnings(runtime, profile, input) {
  const workflow = runtime.getWorkflow(profile);
  if (!workflow) return [];
  const variant = selectWorkflowVariant(workflow, input);
  const warnings = [];
  for (const rule of arr(workflow.warnings)) {
    if (!applies(rule, variant)) continue;
    if (rule.kind === 'collect_not_true') {
      const missing = arr(rule.fields).filter((item) => readPath(input, item.path) !== true).map((item) => item.label);
      if (missing.length) warnings.push(`${rule.prefix}${missing.join(', ')}${rule.suffix || ''}`);
      continue;
    }
    if (conditionMatches(rule.when, input)) warnings.push(rule.message);
  }
  return warnings;
}

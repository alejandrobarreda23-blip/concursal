// Frontera transversal de decisión humana.
// El core puede preparar propuestas, pero nunca sustituye una decisión ya adoptada.
const canonical = (value) => JSON.stringify(value ?? null);

export function assertHumanDecisionPreserved(before, after, { label = 'decision_judicial' } = {}) {
  if (before == null) return { ok: true };
  if (canonical(before) !== canonical(after)) {
    throw new Error(`${label}: una ejecución automática no puede modificar una decisión humana existente.`);
  }
  return { ok: true };
}

export function requireExplicitHumanDecision(value, message = 'Falta decisión humana expresa.') {
  if (value === undefined || value === null || value === '') return { ok: false, message };
  return { ok: true };
}

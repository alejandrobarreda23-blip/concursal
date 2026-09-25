// Contextos mínimos para asistentes IA opcionales.
// Nunca incluye nombre, NIF, domicilio, representación ni nombres de acreedores.

const arr = (v) => Array.isArray(v) ? v : [];

export const AI_TOOL_IDS = Object.freeze({
  DOCUMENT_AUDIT: 'document_audit',
  KNOWLEDGE_ISSUES: 'knowledge_issue_spotter'
});

export function buildSafeCaseSnapshot(expediente = {}) {
  const solicitud = expediente.solicitud || {};
  const decision = expediente.decision_judicial || {};
  return Object.freeze({
    schema: 'concursal-safe-case-v1',
    deudor: {
      tipo: expediente.deudor?.tipo || null
    },
    solicitud: {
      fecha: solicitud.fecha || null,
      tipo: solicitud.tipo || null,
      solicitante: solicitud.solicitante || null,
      insolvencia_alegada: solicitud.insolvencia || null,
      pide_epi: solicitud.pide_epi === true,
      plan_pagos: solicitud.plan_pagos === true,
      activo_declarado: solicitud.activo_declarado ?? null,
      pasivo_declarado: solicitud.pasivo_declarado ?? null,
      documentos: { ...(solicitud.documentos || {}) }
    },
    creditos: arr(expediente.creditos).map((c, index) => ({
      id: c.id || `C${index + 1}`,
      clase: c.clase || null,
      rango_concursal: c.rango_concursal || null,
      fecha_origen: c.fecha_origen || null,
      importe: c.importe ?? null,
      valor_garantia: c.valor_garantia ?? null
    })),
    antecedentes: {
      incumplimiento_colaboracion: expediente.antecedentes?.incumplimiento_colaboracion === true,
      indicios_endeudamiento_temerario: expediente.antecedentes?.indicios_endeudamiento_temerario === true,
      informacion_falsa_enganosa: expediente.antecedentes?.informacion_falsa_enganosa === true
    },
    decisiones_ya_confirmadas: {
      competencia_verificada: decision.competencia_verificada === true,
      insolvencia_apreciada: decision.insolvencia_apreciada === true,
      supuesto_37_bis: decision.supuesto_37_bis || null
    }
  });
}

function referencedNormIds(rules) {
  return new Set(rules.flatMap((r) => arr(r.fundamento)));
}

export function relevantKnowledgeModules(expediente = {}) {
  const modules = ['solicitud_declaracion'];
  if (expediente.solicitud?.tipo === 'concurso_sin_masa') modules.push('sin_masa');
  if (expediente.solicitud?.pide_epi === true) modules.push('epi_general', 'epi_liquidacion');
  if (expediente.solicitud?.plan_pagos === true) modules.push('epi_plan_pagos');
  return [...new Set(modules)];
}

export function buildKnowledgeContext(rawKnowledge, expediente, { maxRules = 36, maxNorms = 24 } = {}) {
  const modules = relevantKnowledgeModules(expediente);
  const allRules = arr(rawKnowledge?.reglas);
  const selectedRules = allRules
    .filter((r) => modules.includes(r.modulo))
    .slice(0, maxRules)
    .map((r) => ({
      id: r.id,
      titulo: r.titulo || null,
      modulo: r.modulo || null,
      tipo: r.tipo || null,
      severidad: r.severidad || null,
      condicion: r.condicion ?? null,
      sub_condiciones: arr(r.sub_condiciones),
      mensaje: r.mensaje || null,
      fundamento: arr(r.fundamento)
    }));
  const normIds = referencedNormIds(selectedRules);
  const selectedNorms = arr(rawKnowledge?.normas)
    .filter((n) => normIds.has(n.id))
    .slice(0, maxNorms)
    .map((n) => ({
      id: n.id,
      norma: n.norma || null,
      art: n.art || null,
      titulo: n.titulo || null,
      texto: n.texto || null,
      verificado: n.verificado ?? null
    }));
  return Object.freeze({
    schema: 'concursal-knowledge-context-v1',
    source_id: rawKnowledge?.meta?.id || null,
    version: rawKnowledge?.meta?.version || null,
    fecha_corte_normativa: rawKnowledge?.meta?.fecha_corte_normativa || null,
    modules,
    rules: selectedRules,
    sources: selectedNorms
  });
}

export function validateSafeCaseSnapshot(snapshot) {
  const serialized = JSON.stringify(snapshot || {});
  const forbiddenKeys = ['nombre','nif','nie','dni','domicilio','direccion','procurador','abogado','acreedor'];
  const keyHits = forbiddenKeys.filter((key) => new RegExp(`"${key}"\\s*:`, 'i').test(serialized));
  const directPatterns = [
    /\b(?:\d{8}|[XYZ]\d{7})[-\s]?[A-Z]\b/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\bES\d{2}(?:[\s-]?\d{4}){5}\b/i
  ];
  const directHits = directPatterns.filter((re) => re.test(serialized)).length;
  return Object.freeze({
    ok: keyHits.length === 0 && directHits === 0,
    key_hits: Object.freeze(keyHits),
    direct_pattern_hits: directHits
  });
}

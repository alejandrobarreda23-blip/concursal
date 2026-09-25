import { detectDirectIdentifiers, PSEUDONYMIZATION_VERSION } from '../../src/core/extraction/pseudonymization.mjs';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  body: JSON.stringify(body)
});

const evidenceSchema = {
  type: ['object','null'],
  properties: {
    page: { type: ['integer','null'], minimum: 1 },
    line: { type: ['integer','null'], minimum: 1 },
    quote: { type: ['string','null'] }
  },
  required: ['page','line','quote'],
  additionalProperties: false
};

const documentAuditSchema = {
  type: 'object',
  properties: {
    hallazgos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          categoria: { type: 'string' },
          severidad: { type: 'string', enum: ['alta','media','baja'] },
          descripcion: { type: 'string' },
          evidence: evidenceSchema
        },
        required: ['categoria','severidad','descripcion','evidence'],
        additionalProperties: false
      }
    },
    contradicciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          descripcion: { type: 'string' },
          evidence_a: evidenceSchema,
          evidence_b: evidenceSchema
        },
        required: ['descripcion','evidence_a','evidence_b'],
        additionalProperties: false
      }
    },
    preguntas_revision: { type: 'array', items: { type: 'string' } },
    limitaciones: { type: 'array', items: { type: 'string' } }
  },
  required: ['hallazgos','contradicciones','preguntas_revision','limitaciones'],
  additionalProperties: false
};

const issueSpotterSchema = {
  type: 'object',
  properties: {
    cuestiones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          relevancia: { type: 'string', enum: ['alta','media','baja'] },
          rule_ids: { type: 'array', items: { type: 'string' } },
          por_que_importa: { type: 'string' },
          hechos_faltantes: { type: 'array', items: { type: 'string' } },
          requiere_decision_judicial: { type: 'boolean' }
        },
        required: ['titulo','relevancia','rule_ids','por_que_importa','hechos_faltantes','requiere_decision_judicial'],
        additionalProperties: false
      }
    },
    reglas_destacadas: { type: 'array', items: { type: 'string' } },
    preguntas_revision: { type: 'array', items: { type: 'string' } },
    advertencias: { type: 'array', items: { type: 'string' } }
  },
  required: ['cuestiones','reglas_destacadas','preguntas_revision','advertencias'],
  additionalProperties: false
};

function outputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text) return response.output_text;
  for (const item of response?.output || []) for (const part of item?.content || []) {
    if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
  }
  return null;
}

function privacyOk(body, mode) {
  if (mode === 'document_audit') {
    const p = body.privacy;
    if (
      p?.mode !== 'pseudonymized' ||
      p?.version !== PSEUDONYMIZATION_VERSION ||
      p?.mapping_shared !== false ||
      p?.asserted_no_direct_identifiers !== true
    ) return { ok: false, code: 'PRIVACY_ENVELOPE_REQUIRED' };
    const text = String(body.document_text || '');
    const leaks = detectDirectIdentifiers(text);
    if (leaks.length) return { ok: false, code: 'PRIVACY_GUARD_FAILED', details: leaks };
    return { ok: true };
  }

  const serialized = JSON.stringify(body.case_snapshot || {});
  const forbiddenKeys = ['nombre','nif','nie','dni','domicilio','direccion','procurador','abogado','acreedor'];
  const keyHits = forbiddenKeys.filter((key) => new RegExp(`"${key}"\\s*:`, 'i').test(serialized));
  const leaks = detectDirectIdentifiers(serialized);
  if (keyHits.length || leaks.length) return { ok: false, code: 'SAFE_CASE_GUARD_FAILED', details: [...keyHits, ...leaks] };
  return { ok: true };
}

function toolConfig(mode) {
  if (mode === 'document_audit') return {
    model: process.env.OPENAI_AI2_MODEL || 'gpt-5.6-terra',
    effort: 'medium',
    schema: documentAuditSchema,
    schemaName: 'concursal_document_audit',
    instructions: [
      'Actúas como auditor documental para un juez mercantil español.',
      'Recibes exclusivamente texto pseudonimizado de una solicitud concursal. Los tokens entre corchetes son opacos y nunca debes intentar reconstruir identidades.',
      'Busca contradicciones semánticas, omisiones internas, cifras incompatibles, afirmaciones que merecen revisión y referencias documentales confusas.',
      'No determines competencia, insolvencia jurídica, concurso sin masa, buena fe, exoneración ni el sentido de ninguna resolución.',
      'No sustituyas al juez ni afirmes conclusiones jurídicas. Formula hallazgos y preguntas de revisión.',
      'Cita página y línea sólo cuando exista evidencia en los marcadores del texto.'
    ].join('\n')
  };

  return {
    model: process.env.OPENAI_AI3_MODEL || 'gpt-5.6-sol',
    effort: 'high',
    schema: issueSpotterSchema,
    schemaName: 'concursal_knowledge_issue_spotter',
    instructions: [
      'Actúas como asistente de issue spotting para un juez mercantil español.',
      'Recibes un expediente deliberadamente desidentificado y un subconjunto cerrado de Knowledge versionado.',
      'Trabaja exclusivamente con las reglas y fuentes suministradas. No inventes normas, artículos, sentencias ni criterios.',
      'Tu función es señalar cuestiones potencialmente activas, hechos faltantes y reglas que el juez debería revisar.',
      'Una regla valorativa o mixta nunca se convierte en conclusión automática.',
      'No decidas competencia, insolvencia, art. 37 bis, buena fe, EPI ni el sentido de la resolución.',
      'Devuelve ids de reglas del Knowledge para que cada sugerencia sea trazable.'
    ].join('\n')
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: { code:'METHOD_NOT_ALLOWED', message:'Use POST.' } });
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: { code:'INVALID_JSON', message:'JSON inválido.' } }); }

  const mode = body.mode;
  if (!['document_audit','knowledge_issue_spotter'].includes(mode)) {
    return json(400, { error: { code:'UNKNOWN_AI_TOOL', message:'Herramienta IA desconocida.' } });
  }

  const privacy = privacyOk(body, mode);
  if (!privacy.ok) return json(422, { error: { code:privacy.code, message:'El contexto no supera la frontera de privacidad.', details:privacy.details || [] } });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(503, { error: { code:'AI_NOT_CONFIGURED', message:'Las asistencias IA todavía no están conectadas a un proveedor.' } });

  const cfg = toolConfig(mode);
  const input = mode === 'document_audit'
    ? String(body.document_text || '')
    : JSON.stringify({ case_snapshot: body.case_snapshot || {}, knowledge: body.knowledge_context || {} });

  if (input.length < 20) return json(400, { error: { code:'EMPTY_INPUT', message:'No hay contexto suficiente.' } });
  if (input.length > 220000) return json(413, { error: { code:'INPUT_TOO_LARGE', message:'El contexto supera el límite de la herramienta.' } });

  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers: { authorization:`Bearer ${apiKey}`, 'content-type':'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        reasoning: { effort: cfg.effort },
        instructions: cfg.instructions,
        input: [{ role:'user', content:[{ type:'input_text', text:input }] }],
        text: { format: { type:'json_schema', name:cfg.schemaName, strict:true, schema:cfg.schema } }
      })
    });
  } catch (error) {
    return json(502, { error: { code:'AI_NETWORK_ERROR', message:error?.message || 'Error de red.' } });
  }

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) return json(502, { error: { code:'AI_UPSTREAM_ERROR', message:payload?.error?.message || `Proveedor HTTP ${upstream.status}` } });

  const raw = outputText(payload);
  if (!raw) return json(502, { error: { code:'AI_EMPTY_OUTPUT', message:'La IA no devolvió una salida utilizable.' } });
  let result;
  try { result = JSON.parse(raw); }
  catch { return json(502, { error: { code:'AI_INVALID_OUTPUT', message:'La salida estructurada no es JSON válido.' } }); }

  return json(200, {
    mode,
    provider:'openai',
    model:cfg.model,
    response_id:payload.id || null,
    human_review_required:true,
    result
  });
}

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  },
  body: JSON.stringify(body)
});

const evidenceSchema = {
  type: ['object', 'null'],
  properties: {
    page: { type: ['integer', 'null'], minimum: 1 },
    line: { type: ['integer', 'null'], minimum: 1 },
    quote: { type: ['string', 'null'] }
  },
  required: ['page', 'line', 'quote'],
  additionalProperties: false
};

function fieldSchema(valueType) {
  return {
    type: 'object',
    properties: {
      value: { type: [valueType, 'null'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      evidence: evidenceSchema
    },
    required: ['value', 'confidence', 'evidence'],
    additionalProperties: false
  };
}

const nullableEnum = (values) => ({
  type: ['string', 'null'],
  enum: [...values, null]
});

const extractionSchema = {
  type: 'object',
  properties: {
    clasificacion: {
      type: 'object',
      properties: {
        tipo: { ...fieldSchema('string'), properties: { ...fieldSchema('string').properties, value: nullableEnum(['concurso_sin_masa', 'concurso_ordinario', 'microempresas']) } },
        solicitante: { ...fieldSchema('string'), properties: { ...fieldSchema('string').properties, value: nullableEnum(['deudor', 'acreedor', 'otro_legitimado']) } },
        persona: { ...fieldSchema('string'), properties: { ...fieldSchema('string').properties, value: nullableEnum(['natural', 'juridica']) } },
        empresario: fieldSchema('boolean'),
        insolvencia: { ...fieldSchema('string'), properties: { ...fieldSchema('string').properties, value: nullableEnum(['actual', 'inminente', 'no_acreditada']) } },
        pide_epi: fieldSchema('boolean'),
        plan_pagos: fieldSchema('boolean'),
        formulario_icab: fieldSchema('boolean'),
        indicio_masa: fieldSchema('boolean')
      },
      required: ['tipo','solicitante','persona','empresario','insolvencia','pide_epi','plan_pagos','formulario_icab','indicio_masa'],
      additionalProperties: false
    },
    campos: {
      type: 'object',
      properties: {
        deudor_nombre: fieldSchema('string'),
        deudor_nif: fieldSchema('string'),
        deudor_domicilio: fieldSchema('string'),
        deudor_localidad: fieldSchema('string'),
        estado_civil: fieldSchema('string'),
        regimen_economico: fieldSchema('string'),
        procurador: fieldSchema('string'),
        abogado: fieldSchema('string'),
        organo_destino: fieldSchema('string'),
        fecha_escrito: fieldSchema('string'),
        pasivo_declarado_euros: fieldSchema('number'),
        activo_declarado_euros: fieldSchema('number'),
        numero_acreedores: fieldSchema('number')
      },
      required: ['deudor_nombre','deudor_nif','deudor_domicilio','deudor_localidad','estado_civil','regimen_economico','procurador','abogado','organo_destino','fecha_escrito','pasivo_declarado_euros','activo_declarado_euros','numero_acreedores'],
      additionalProperties: false
    },
    documentos: {
      type: 'object',
      properties: {
        poder: fieldSchema('boolean'),
        memoria: fieldSchema('boolean'),
        inventario: fieldSchema('boolean'),
        relacion_acreedores: fieldSchema('boolean'),
        formulario_anexo_i: fieldSchema('boolean')
      },
      required: ['poder','memoria','inventario','relacion_acreedores','formulario_anexo_i'],
      additionalProperties: false
    },
    acreedores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          acreedor: { type: 'string' },
          nif: { type: ['string','null'] },
          concepto: { type: ['string','null'] },
          importe_euros: { type: 'number', minimum: 0 },
          tipo_acreedor: nullableEnum(['privado','aeat','tgss','ccaa','local','otro_publico']),
          clase_concursal: nullableEnum(['privilegio_especial','privilegio_general','ordinario','subordinado']),
          concepto_categoria: { type: ['string','null'] },
          garantia_real: { type: 'boolean' },
          valor_garantia: { type: ['number','null'], minimum: 0 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence: evidenceSchema
        },
        required: ['acreedor','nif','concepto','importe_euros','tipo_acreedor','clase_concursal','concepto_categoria','garantia_real','valor_garantia','confidence','evidence'],
        additionalProperties: false
      }
    },
    warnings: { type: 'array', items: { type: 'string' } }
  },
  required: ['clasificacion','campos','documentos','acreedores','warnings'],
  additionalProperties: false
};

function outputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text) return response.output_text;
  for (const item of response?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return null;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(503, { error: { code: 'AI_NOT_CONFIGURED', message: 'El extractor IA no está configurado en este entorno.' } });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: { code: 'INVALID_JSON', message: 'JSON inválido.' } }); }

  const documentText = String(body.document_text || '');
  if (documentText.length < 50) return json(400, { error: { code: 'EMPTY_DOCUMENT', message: 'No hay texto suficiente para extraer.' } });
  if (documentText.length > 180000) return json(413, { error: { code: 'DOCUMENT_TOO_LARGE', message: 'El texto supera el límite del extractor.' } });

  const model = process.env.OPENAI_EXTRACTION_MODEL || 'gpt-5.6-luna';
  const instructions = [
    'Eres un extractor de datos de escritos concursales españoles.',
    'Tu tarea es exclusivamente documental: extrae hechos expresamente presentes en el texto.',
    'No decidas competencia, insolvencia, buena fe, concurso sin masa ni ninguna otra cuestión reservada al juez.',
    'Si un dato no consta de forma razonablemente identificable, devuelve null y confianza baja.',
    'No inventes NIF, importes, documentos ni acreedores.',
    'Para cada dato aporta evidencia con página, línea y cita breve usando los marcadores [p.X l.Y] del texto.',
    'Los importes deben devolverse en euros como número.',
    'La lista de acreedores debe contener una fila por crédito identificable; no incluyas la fila TOTAL.',
    'Clasifica tipo_acreedor y clase_concursal sólo cuando el propio texto lo permita; en otro caso null.',
    'Todas las salidas serán revisadas por una persona antes de producir una resolución.'
  ].join('\n');

  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: 'low' },
        instructions,
        input: [{
          role: 'user',
          content: [{ type: 'input_text', text: documentText }]
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'concurso_solicitud_extraction',
            strict: true,
            schema: extractionSchema
          }
        }
      })
    });
  } catch (error) {
    return json(502, { error: { code: 'AI_NETWORK_ERROR', message: error?.message || 'Error de red.' } });
  }

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return json(502, {
      error: {
        code: 'AI_UPSTREAM_ERROR',
        message: payload?.error?.message || `OpenAI HTTP ${upstream.status}`
      }
    });
  }

  const raw = outputText(payload);
  if (!raw) return json(502, { error: { code: 'AI_EMPTY_OUTPUT', message: 'El modelo no devolvió una extracción utilizable.' } });

  let proposal;
  try { proposal = JSON.parse(raw); }
  catch { return json(502, { error: { code: 'AI_INVALID_OUTPUT', message: 'La respuesta estructurada no es JSON válido.' } }); }

  return json(200, {
    provider: 'openai',
    model,
    response_id: payload.id || null,
    proposal
  });
}

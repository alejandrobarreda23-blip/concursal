import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCandidate } from '../src/core/extraction/contracts.mjs';
import { fusionarLecturaConIA } from '../src/adapters/concursal/ai-extraction.mjs';
import { handler } from '../netlify/functions/extract-solicitud.mjs';

test('extracción core: conflicto asistido no sustituye dato firme con baja confianza', () => {
  const r = mergeCandidate({
    deterministic: { value: 'A' },
    assisted: { value: 'B', confidence: 0.4 },
    threshold: 0.72,
    preferAssisted: true
  });
  assert.equal(r.value, 'A');
  assert.equal(r.selected, 'deterministic');
  assert.equal(r.conflict, true);
});

test('extracción concursal: IA completa ausencias pero conserva revisión humana', () => {
  const deterministic = {
    version: 'lector/0.2.0',
    reglas: 'test',
    fichero: 'solicitud.pdf',
    hash_texto: 'abc',
    clasificacion: {
      tipo: 'concurso_sin_masa',
      solicitante: 'deudor',
      persona: 'natural',
      empresario: null,
      insolvencia: 'actual',
      pide_epi: false,
      plan_pagos: false,
      formulario_icab: false,
      indicio_masa: false,
      evidencias: []
    },
    campos: {},
    acreedores: [],
    suma_acreedores: 0,
    documentos: {
      poder: { presente: false, regla: 'D' },
      memoria: { presente: false, regla: 'D' },
      inventario: { presente: false, regla: 'D' },
      relacion_acreedores: { presente: false, regla: 'D' },
      formulario_anexo_i: { presente: false, regla: 'D' }
    },
    alertas: [
      { nivel: 'aviso', texto: 'No se ha encontrado el nombre del deudor: complételo a mano.' },
      { nivel: 'aviso', texto: 'No se ha encontrado la relación de acreedores en el escrito: complétela a mano.' }
    ],
    hash_lectura: 'old'
  };

  const field = (value, confidence = 0.95) => ({ value, confidence, evidence: { page: 1, line: 2, quote: 'evidencia' } });
  const proposal = {
    clasificacion: {
      tipo: field('concurso_sin_masa'), solicitante: field('deudor'), persona: field('natural'),
      empresario: field(false), insolvencia: field('actual'), pide_epi: field(false),
      plan_pagos: field(false), formulario_icab: field(false), indicio_masa: field(false)
    },
    campos: {
      deudor_nombre: field('JUAN PÉREZ'), deudor_nif: field('12345678-Z'), deudor_domicilio: field('Calle Uno 1'),
      deudor_localidad: field('Sevilla'), estado_civil: field(null, 0.2), regimen_economico: field(null, 0.2),
      procurador: field(null, 0.2), abogado: field(null, 0.2), organo_destino: field('Sección Mercantil'),
      fecha_escrito: field('2026-09-25'), pasivo_declarado_euros: field(10000), activo_declarado_euros: field(200),
      numero_acreedores: field(1)
    },
    documentos: {
      poder: field(false), memoria: field(true), inventario: field(true), relacion_acreedores: field(true), formulario_anexo_i: field(false)
    },
    acreedores: [{
      acreedor: 'Banco Ejemplo', nif: null, concepto: 'Préstamo', importe_euros: 10000,
      tipo_acreedor: 'privado', clase_concursal: 'ordinario', concepto_categoria: 'otro',
      garantia_real: false, valor_garantia: null, confidence: 0.94,
      evidence: { page: 2, line: 5, quote: 'Banco Ejemplo 10.000 euros' }
    }],
    warnings: []
  };

  const merged = fusionarLecturaConIA(deterministic, proposal, { provider: 'openai', model: 'test-model' });
  assert.equal(merged.campos.deudor_nombre.valor, 'JUAN PÉREZ');
  assert.equal(merged.campos.deudor_nif.valor, '12345678Z');
  assert.equal(merged.campos.pasivo_declarado.valor, 1000000);
  assert.equal(merged.acreedores.length, 1);
  assert.equal(merged.acreedores[0].importe, 1000000);
  assert.equal(merged.extractor.mode, 'hybrid');
  assert.equal(merged.extractor.review_required, true);
  assert.ok(!merged.alertas.some((a) => /nombre del deudor/.test(a.texto)));
});

test('Netlify extractor: sin método POST no intenta llamar a proveedor', async () => {
  const r = await handler({ httpMethod: 'GET' });
  assert.equal(r.statusCode, 405);
});

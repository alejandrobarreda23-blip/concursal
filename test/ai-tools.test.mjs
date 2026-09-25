import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSafeCaseSnapshot, buildKnowledgeContext, validateSafeCaseSnapshot, relevantKnowledgeModules
} from '../src/adapters/concursal/ai-tools.mjs';
import { handler } from '../netlify/functions/assist-case.mjs';
import { readFileSync } from 'node:fs';

const knowledge = JSON.parse(readFileSync(new URL('../knowledge/source/concursal/kb-concurso-persona-fisica-1.0.0.json', import.meta.url), 'utf8'));

const expediente = {
  deudor: { nombre:'JUAN PÉREZ', nif:'12345678Z', domicilio:'Calle Uno 1', tipo:'persona_natural' },
  representacion: { procurador:'MARÍA LÓPEZ', abogado:'CARLOS RUIZ' },
  solicitud: {
    fecha:'2026-09-25', tipo:'concurso_sin_masa', solicitante:'deudor', insolvencia:'actual',
    pide_epi:true, plan_pagos:false, activo_declarado:200, pasivo_declarado:10000,
    documentos:{ poder:true, memoria:true, inventario:true, relacion_acreedores:true }
  },
  creditos:[
    { id:'C1', acreedor:'BANCO X', nif:'A00000000', concepto:'Préstamo personal', clase:'ordinario', importe:10000 }
  ],
  decision_judicial:{ competencia_verificada:true, insolvencia_apreciada:true, supuesto_37_bis:'1' }
};

test('IA 3: snapshot seguro excluye identidad y texto libre de acreedores', () => {
  const snapshot = buildSafeCaseSnapshot(expediente);
  const serialized = JSON.stringify(snapshot);
  for (const secret of ['JUAN PÉREZ','12345678Z','Calle Uno 1','MARÍA LÓPEZ','CARLOS RUIZ','BANCO X','Préstamo personal']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(validateSafeCaseSnapshot(snapshot).ok, true);
  assert.deepEqual(snapshot.creditos[0], { id:'C1', clase:'ordinario', rango_concursal:null, fecha_origen:null, importe:10000, valor_garantia:null });
});

test('IA 3: selecciona sólo módulos de Knowledge plausibles para el expediente', () => {
  assert.deepEqual(relevantKnowledgeModules(expediente), ['solicitud_declaracion','sin_masa','epi_general','epi_liquidacion']);
  const context = buildKnowledgeContext(knowledge, expediente);
  assert.ok(context.rules.length > 0);
  assert.ok(context.rules.every((r) => context.modules.includes(r.modulo)));
  assert.ok(context.rules.every((r) => r.id));
});

test('endpoint IA 3: bloquea snapshot con identificadores antes de proveedor', async () => {
  const unsafe = { deudor:{ nif:'12345678Z' } };
  const r = await handler({
    httpMethod:'POST',
    body:JSON.stringify({ mode:'knowledge_issue_spotter', case_snapshot:unsafe, knowledge_context:{} })
  });
  assert.equal(r.statusCode, 422);
  assert.equal(JSON.parse(r.body).error.code, 'SAFE_CASE_GUARD_FAILED');
});

test('endpoint IA 2: exige texto pseudonimizado', async () => {
  const r = await handler({
    httpMethod:'POST',
    body:JSON.stringify({ mode:'document_audit', document_text:'Texto sin sobre de privacidad.' })
  });
  assert.equal(r.statusCode, 422);
  assert.equal(JSON.parse(r.body).error.code, 'PRIVACY_ENVELOPE_REQUIRED');
});

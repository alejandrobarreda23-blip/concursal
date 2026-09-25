import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConcursalFamilies, buildConcursalReport, buildLearningSummary } from '../src/adapters/concursal/insights.mjs';

const cases=[
  {
    id:'A',createdAt:'2026-09-01T10:00:00Z',updatedAt:'2026-09-02T10:00:00Z',
    lectura:{ campos:{deudor_nombre:{valor:'A'},pasivo_declarado:{valor:1000000}}, acreedores:[{id:'C1',clase:'publico_otro'}], alertas:[] },
    expediente:{ deudor:{nombre:'A',tipo:'persona_natural'},solicitud:{tipo:'concurso_sin_masa',pide_epi:true,plan_pagos:false,pasivo_declarado:10000},creditos:[{id:'C1',clase:'publico_otro',importe:10000}],decision_judicial:{} }
  },
  {
    id:'B',createdAt:'2026-09-03T10:00:00Z',updatedAt:'2026-09-04T10:00:00Z',
    lectura:{ campos:{deudor_nombre:{valor:'B'},pasivo_declarado:{valor:2000000}}, acreedores:[{id:'C1',clase:'ordinario'}], alertas:[] },
    expediente:{ deudor:{nombre:'B',tipo:'persona_natural'},solicitud:{tipo:'concurso_sin_masa',pide_epi:false,plan_pagos:false,pasivo_declarado:22000},creditos:[{id:'C1',clase:'ordinario',importe:22000}],decision_judicial:{} },
    resultadoDeclaracion:{texto:'x'}
  }
];

test('informes: resume la bandeja local sin servidor', () => {
  const r=buildConcursalReport(cases);
  assert.equal(r.total,2);
  assert.equal(r.declaracion_generada,1);
  assert.equal(r.credito_publico,1);
  assert.equal(r.pasivo_total,32000);
});

test('familias: agrupa por rasgos jurídicos compartidos', () => {
  const f=buildConcursalFamilies(cases);
  assert.equal(f.reduce((s,x)=>s+x.total,0),2);
  assert.ok(f.some((x)=>x.tags.includes('crédito público')));
});

test('aprendizajes: detecta correcciones humanas sin convertirlas en regla', () => {
  const l=buildLearningSummary(cases);
  assert.equal(l.counters.pasivo,1);
  assert.equal(l.examples.length,1);
  assert.ok(l.examples[0].changed.includes('pasivo'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluarIndicadoresBuenaFe } from '../src/adapters/concursal/good-faith.mjs';

test('buena fe: ausencia de señales no se convierte en declaración de buena fe', () => {
  const r = evaluarIndicadoresBuenaFe({ expediente:{ deudor:{tipo:'persona_natural'} }, lectura:{ alertas:[], clasificacion:{} } });
  assert.equal(r.estado, 'sin_indicios_detectados');
  assert.equal(r.human_decision_required, true);
  assert.match(r.conclusion, /no equivale/i);
  assert.ok(r.rule_ids.includes('EPI_017'));
});

test('buena fe: incoherencias en acreedores abren revisión sin decidir mala fe', () => {
  const r = evaluarIndicadoresBuenaFe({
    expediente:{ deudor:{tipo:'persona_natural'} },
    lectura:{ clasificacion:{}, alertas:[
      { texto:'La suma de la relación de acreedores (9.000,00 €) no coincide con el pasivo declarado (10.000,00 €).' }
    ]}
  });
  assert.equal(r.estado, 'revisar');
  assert.equal(r.signals[0].nivel, 'media');
  assert.match(r.conclusion, /no concluye mala fe/i);
});

test('buena fe: una marca expresa de endeudamiento temerario es revisión prioritaria', () => {
  const r = evaluarIndicadoresBuenaFe({
    expediente:{ deudor:{tipo:'persona_natural'}, antecedentes:{ indicios_endeudamiento_temerario:true } },
    lectura:{ clasificacion:{}, alertas:[] }
  });
  assert.equal(r.estado, 'prioridad_alta');
  assert.ok(r.signals.some((x)=>x.id==='temerario' && x.nivel==='alta'));
});

test('buena fe: hallazgo de IA 2 se usa sólo como señal revisable', () => {
  const r = evaluarIndicadoresBuenaFe({
    expediente:{ deudor:{tipo:'persona_natural'} },
    lectura:{ clasificacion:{}, alertas:[] },
    aiResults:{ document_audit:{ result:{ hallazgos:[
      { categoria:'buena_fe_487', severidad:'alta', descripcion:'Posible deuda omitida en la relación.' }
    ]}}}
  });
  assert.equal(r.estado, 'prioridad_alta');
  assert.ok(r.signals.some((x)=>x.origen.includes('IA 2')));
});

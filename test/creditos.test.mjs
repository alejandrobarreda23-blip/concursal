import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exoneracionPublicaLimitada, clasificarCreditos } from '../src/creditos.mjs';
import { knowledge } from './helpers.mjs';

test('crédito público: tramos cuantitativos del art. 489.1.5.º', () => {
  assert.equal(exoneracionPublicaLimitada(400000, knowledge), 400000);
  assert.equal(exoneracionPublicaLimitada(500000, knowledge), 500000);
  assert.equal(exoneracionPublicaLimitada(800000, knowledge), 650000);
  assert.equal(exoneracionPublicaLimitada(1500000, knowledge), 1000000);
  assert.equal(exoneracionPublicaLimitada(2500000, knowledge), 1000000);
});

test('STS 260/264-2026: el límite público se aplica por cada acreedor, no por tipo de Administración', () => {
  const r = clasificarCreditos([
    { id: 'A1', acreedor: 'AEAT', nif: 'Q2826000H', concepto: 'IRPF', importe: 12000, clase: 'publico_aeat', rango_concursal: 'ordinario' },
    { id: 'M1', acreedor: 'Ayuntamiento A', nif: 'P0800000B', concepto: 'IBI', importe: 12000, clase: 'publico_otro', rango_concursal: 'ordinario' },
    { id: 'M2', acreedor: 'Ayuntamiento B', nif: 'P1700000A', concepto: 'IVTM', importe: 3000, clase: 'publico_otro', rango_concursal: 'ordinario' }
  ], knowledge);
  assert.equal(Object.keys(r.publico).length, 3);
  assert.deepEqual(r.filas.map((x) => x.exonerado), [850000, 850000, 300000]);
  assert.equal(r.totales.exonerado, 2000000);
});

test('STS 260/264-2026: el crédito público subordinado se exonera íntegramente fuera del límite', () => {
  const r = clasificarCreditos([
    { id: 'P1', acreedor: 'AEAT', nif: 'Q2826000H', concepto: 'Privilegio general', importe: 16000, clase: 'publico_aeat', rango_concursal: 'privilegio_general' },
    { id: 'O1', acreedor: 'AEAT', nif: 'Q2826000H', concepto: 'Ordinario', importe: 16000, clase: 'publico_aeat', rango_concursal: 'ordinario' },
    { id: 'S1', acreedor: 'AEAT', nif: 'Q2826000H', concepto: 'Recargos subordinados', importe: 4000, clase: 'publico_aeat', rango_concursal: 'subordinado' }
  ], knowledge);
  const byId = Object.fromEntries(r.filas.map((x) => [x.id, x]));
  assert.equal(byId.S1.exonerado, 400000);
  assert.equal(byId.O1.exonerado, 1000000); // orden inverso: ordinario antes del privilegiado
  assert.equal(byId.P1.exonerado, 0);
  assert.equal(r.publico['nif:Q2826000H'].subordinado_exonerado, 400000);
  assert.equal(r.publico['nif:Q2826000H'].exonerable, 1400000);
});

test('crédito público: dentro de la misma clase se aplica la antigüedad y se avisa si falta', () => {
  const r = clasificarCreditos([
    { id: 'NUEVO', acreedor: 'TGSS', nif: 'Q2819001D', concepto: 'Cuota 2025', importe: 6000, clase: 'publico_tgss', rango_concursal: 'ordinario', fecha_origen: '2025-01-01' },
    { id: 'ANTIGUO', acreedor: 'TGSS', nif: 'Q2819001D', concepto: 'Cuota 2022', importe: 6000, clase: 'publico_tgss', rango_concursal: 'ordinario', fecha_origen: '2022-01-01' }
  ], knowledge);
  const byId = Object.fromEntries(r.filas.map((x) => [x.id, x]));
  assert.equal(byId.ANTIGUO.exonerado, 600000);
  assert.equal(byId.NUEVO.exonerado, 250000);
  assert.equal(r.avisos.length, 0);

  const sinFechas = clasificarCreditos([
    { id: 'A', acreedor: 'TGSS', nif: 'Q2819001D', concepto: 'Uno', importe: 6000, clase: 'publico_tgss', rango_concursal: 'ordinario' },
    { id: 'B', acreedor: 'TGSS', nif: 'Q2819001D', concepto: 'Dos', importe: 6000, clase: 'publico_tgss', rango_concursal: 'ordinario' }
  ], knowledge);
  assert.ok(sinFechas.avisos.some((x) => /antigüedad/.test(x)));
});

test('garantía real: solo se exonera lo que excede del valor de la garantía', () => {
  const r = clasificarCreditos([{ id: 'H', acreedor: 'Banco', concepto: 'Hipoteca', importe: 90000, clase: 'garantia_real', valor_garantia: 60000 }], knowledge);
  assert.equal(r.filas[0].exonerado, 3000000);
  assert.equal(r.filas[0].no_exonerado, 6000000);
  const r2 = clasificarCreditos([{ id: 'H', acreedor: 'Banco', concepto: 'Hipoteca', importe: 50000, clase: 'garantia_real', valor_garantia: 60000 }], knowledge);
  assert.equal(r2.filas[0].exonerado, 0);
});

test('clases legalmente no exonerables quedan fuera de la exoneración', () => {
  for (const clase of ['alimentos', 'rc_extracontractual', 'rc_delito', 'salarios', 'multa_sancion', 'costas_epi']) {
    const r = clasificarCreditos([{ id: 'X', acreedor: 'A', concepto: 'c', importe: 100, clase }], knowledge);
    assert.equal(r.filas[0].exonerado, 0, clase);
    assert.ok(r.filas[0].motivo, clase);
  }
});

test('los importes con decimales se calculan en céntimos sin error de coma flotante', () => {
  const r = clasificarCreditos([
    { id: 'C1', acreedor: 'A', concepto: 'x', importe: 0.1, clase: 'ordinario' },
    { id: 'C2', acreedor: 'B', concepto: 'y', importe: 0.2, clase: 'ordinario' }
  ], knowledge);
  assert.equal(r.totales.pasivo, 30);
  assert.equal(r.totales.exonerado + r.totales.no_exonerado, r.totales.pasivo);
});

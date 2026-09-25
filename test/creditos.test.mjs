import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exoneracionPublicaLimitada, clasificarCreditos } from '../src/creditos.mjs';
import { knowledge } from './helpers.mjs';

test('crédito público AEAT/TGSS: tramos del art. 489.1.5.º', () => {
  assert.equal(exoneracionPublicaLimitada(400000, knowledge), 400000);   // 4.000 € → íntegro
  assert.equal(exoneracionPublicaLimitada(500000, knowledge), 500000);   // 5.000 € → íntegro
  assert.equal(exoneracionPublicaLimitada(800000, knowledge), 650000);   // 8.000 € → 5.000 + 1.500
  assert.equal(exoneracionPublicaLimitada(1500000, knowledge), 1000000); // 15.000 € → tope 10.000
  assert.equal(exoneracionPublicaLimitada(2500000, knowledge), 1000000); // 25.000 € → tope 10.000
});

test('el límite público se aplica por organismo, sumando todos sus créditos', () => {
  const r = clasificarCreditos([
    { id: 'A1', acreedor: 'AEAT', concepto: 'IRPF', importe: 6000, clase: 'publico_aeat' },
    { id: 'A2', acreedor: 'AEAT', concepto: 'IVA', importe: 6000, clase: 'publico_aeat' },
    { id: 'S1', acreedor: 'TGSS', concepto: 'Cuotas', importe: 3000, clase: 'publico_tgss' }
  ], knowledge);
  assert.deepEqual(r.publico.publico_aeat, { total: 1200000, exonerable: 850000, no_exonerable: 350000 });
  assert.deepEqual(r.publico.publico_tgss, { total: 300000, exonerable: 300000, no_exonerable: 0 });
  const [a1, a2] = r.filas;
  assert.equal(a1.exonerado + a2.exonerado, 850000);
});

test('garantía real: solo se exonera lo que excede del valor de la garantía', () => {
  const r = clasificarCreditos([{ id: 'H', acreedor: 'Banco', concepto: 'Hipoteca', importe: 90000, clase: 'garantia_real', valor_garantia: 60000 }], knowledge);
  assert.equal(r.filas[0].exonerado, 3000000);
  assert.equal(r.filas[0].no_exonerado, 6000000);
  const r2 = clasificarCreditos([{ id: 'H', acreedor: 'Banco', concepto: 'Hipoteca', importe: 50000, clase: 'garantia_real', valor_garantia: 60000 }], knowledge);
  assert.equal(r2.filas[0].exonerado, 0);
});

test('clases no exonerables quedan íntegras fuera de la exoneración', () => {
  for (const clase of ['alimentos', 'rc_extracontractual', 'rc_delito', 'salarios', 'multa_sancion', 'costas_epi', 'publico_otro']) {
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

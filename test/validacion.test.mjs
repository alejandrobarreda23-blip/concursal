import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarExpediente } from '../src/validar-expediente.mjs';
import { ejemplo, copia, knowledge } from './helpers.mjs';

const base = ejemplo('01-epi-sin-oposicion');

test('los ejemplos son válidos', () => {
  for (const n of ['01-epi-sin-oposicion', '02-con-oposicion', '03-persona-juridica-sin-epi', '04-garantia-real-y-publico']) {
    assert.deepEqual(validarExpediente(ejemplo(n), { knowledge }), [], n);
  }
});

test('no se presume nada: los booleanos del trámite son obligatorios', () => {
  const e = copia(base); delete e.tramite.solicitud_nombramiento_ac;
  assert.ok(validarExpediente(e, { knowledge }).some((m) => m.includes('solicitud_nombramiento_ac')));
});

test('créditos: clase desconocida, importe inválido, id duplicado, garantía sin valor', () => {
  const e = copia(base);
  e.creditos.push({ id: 'C1', acreedor: 'X', concepto: 'y', importe: -5, clase: 'inventada' });
  e.creditos.push({ id: 'C9', acreedor: 'X', concepto: 'y', importe: 5, clase: 'garantia_real' });
  const errs = validarExpediente(e, { knowledge }).join('\n');
  for (const s of ['duplicado', 'importe', 'no reconocida', 'valor_garantia']) assert.ok(errs.includes(s), s);
});

test('fechas incoherentes', () => {
  const e = copia(base); e.fecha_resolucion = '2026-01-01';
  assert.ok(validarExpediente(e, { knowledge }).some((m) => m.includes('anterior')));
  const f = copia(base); f.fecha_resolucion = '2026-02-30';
  assert.ok(validarExpediente(f, { knowledge }).some((m) => m.includes('inválida')));
});

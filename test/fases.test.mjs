import { test } from 'node:test';
import assert from 'node:assert/strict';
import { determinarFase } from '../src/fases.mjs';
import { ejemplo, copia } from './helpers.mjs';

const base = ejemplo('01-epi-sin-oposicion');

test('caso normal: listo para EPI', () => {
  assert.equal(determinarFase(base).estado, 'listo');
  assert.equal(determinarFase(base).variante, 'conclusion_con_epi');
});

test('oposición → fuera de alcance (incidente)', () => {
  const e = copia(base); e.tramite.oposiciones = [{ acreedor: 'X' }];
  assert.equal(determinarFase(e).estado, 'fuera_de_alcance');
});

test('solicitud de administración concursal o auto complementario → fuera de alcance', () => {
  const a = copia(base); a.tramite.solicitud_nombramiento_ac = true;
  const b = copia(base); b.tramite.auto_complementario_37_quinquies = true;
  assert.equal(determinarFase(a).estado, 'fuera_de_alcance');
  assert.equal(determinarFase(b).estado, 'fuera_de_alcance');
});

test('persona jurídica no puede pedir EPI', () => {
  const e = copia(base); e.deudor.tipo = 'persona_juridica';
  assert.equal(determinarFase(e).estado, 'fuera_de_alcance');
});

test('exoneración previa o causas del art. 487 → el juez decide fuera de la plantilla', () => {
  const a = copia(base); a.exoneracion_previa = { existe: true };
  const b = copia(base); b.decision_judicial.excepciones_art_487 = ['condena por delito económico'];
  assert.equal(determinarFase(a).estado, 'fuera_de_alcance');
  assert.equal(determinarFase(b).estado, 'fuera_de_alcance');
});

test('frontera de decisión humana: sin decisión o sin buena fe confirmada no se redacta', () => {
  const a = copia(base); delete a.decision_judicial;
  const b = copia(base); b.decision_judicial.buena_fe_verificada = false;
  const c = copia(base); c.decision_judicial.sentido = 'concluir_sin_epi';
  for (const e of [a, b, c]) assert.equal(determinarFase(e).estado, 'pendiente_decision');
});

test('sin traslado a los acreedores → pendiente de trámite', () => {
  const e = copia(base); e.tramite.traslado_acreedores = false;
  assert.equal(determinarFase(e).estado, 'pendiente_tramite');
});

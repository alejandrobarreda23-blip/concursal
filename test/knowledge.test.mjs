import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadKnowledgeRuntime, KNOWLEDGE_CONCURSAL_CSM } from '../src/core/knowledge/node-loader.mjs';
import { compileKnowledgePack, validateKnowledgePack } from '../src/core/knowledge/contracts.mjs';
import { evaluateWorkflow } from '../src/core/knowledge/workflow.mjs';
import { ejemplo, copia } from './helpers.mjs';

const raw = JSON.parse(readFileSync(KNOWLEDGE_CONCURSAL_CSM, 'utf8'));
const runtime = loadKnowledgeRuntime();

test('knowledge: el pack concursal cumple el contrato v1 y compila', () => {
  assert.equal(validateKnowledgePack(raw).ok, true);
  const compiled = compileKnowledgePack(raw);
  assert.equal(compiled.pack_id, 'KP-CONCURSAL-CSM');
  assert.ok(compiled.pack_hash);
  assert.equal(compiled.estadisticas.cuestiones, 10);
  assert.equal(compiled.estadisticas.bloques_redaccion, 30);
});

test('knowledge: la redacción proyectada mantiene paridad con las plantillas legacy', () => {
  const legacyDeclaracion = JSON.parse(readFileSync(new URL('../packs/declaracion-sin-masa.v1.json', import.meta.url), 'utf8'));
  const legacyConclusion = JSON.parse(readFileSync(new URL('../packs/concurso-sin-masa.v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(runtime.redactionPack('declaracion'), legacyDeclaracion);
  assert.deepEqual(runtime.redactionPack('conclusion'), legacyConclusion);
});

test('knowledge: el catálogo del art. 37 bis vive fuera del motor', () => {
  const catalog = runtime.getCatalog('supuesto_37_bis');
  assert.deepEqual(Object.keys(catalog), ['1', '2', '3', '4']);
  assert.equal(catalog['1'].codigo, 'a');
  assert.match(catalog['4'].texto, /gravámenes y cargas/);
});

test('knowledge: el workflow conserva la frontera de decisión humana', () => {
  const e = ejemplo('10-declaracion-desde-solicitud');
  assert.equal(evaluateWorkflow(runtime, 'declaracion', e).estado, 'listo');
  const sinDecision = copia(e); sinDecision.decision_judicial = {};
  const r = evaluateWorkflow(runtime, 'declaracion', sinDecision);
  assert.equal(r.estado, 'pendiente_decision');
  assert.equal(r.motivos.length, 4);
});

test('knowledge: el workflow de conclusión conserva los estados del motor anterior', () => {
  const e = ejemplo('01-epi-sin-oposicion');
  assert.equal(evaluateWorkflow(runtime, 'conclusion', e).estado, 'listo');
  const conOposicion = copia(e); conOposicion.tramite.oposiciones = [{ acreedor: 'X' }];
  assert.equal(evaluateWorkflow(runtime, 'conclusion', conOposicion).estado, 'fuera_de_alcance');
  const sinTraslado = copia(e); sinTraslado.tramite.traslado_acreedores = false;
  assert.equal(evaluateWorkflow(runtime, 'conclusion', sinTraslado).estado, 'pendiente_tramite');
});

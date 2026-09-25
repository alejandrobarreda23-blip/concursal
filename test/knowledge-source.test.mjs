import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptPersonaFisicaKnowledgeSource, personaFisicaKnowledgeSummary } from '../src/adapters/concursal/knowledge-persona-fisica.mjs';
import { validateKnowledgePack } from '../src/core/knowledge/contracts.mjs';
import { prepareKnowledgeRuntime } from '../src/core/knowledge/runtime.mjs';
import { createKnowledgeRegistry } from '../src/core/knowledge/registry.mjs';
import { loadKnowledgeRuntime } from '../src/core/knowledge/node-loader.mjs';

const source = JSON.parse(readFileSync(new URL('../knowledge/source/concursal/kb-concurso-persona-fisica-1.0.0.json', import.meta.url), 'utf8'));

test('knowledge fuente: se importa íntegro y compila en el contrato del Legal Core', () => {
  const pack = adaptPersonaFisicaKnowledgeSource(source);
  assert.equal(validateKnowledgePack(pack).ok, true);
  const runtime = prepareKnowledgeRuntime(pack);
  assert.equal(runtime.pack_id, 'KP-CONCURSAL-PERSONA-FISICA');
  assert.equal(runtime.version, '1.0.0');
  assert.equal(runtime.listCollection('reglas').length, 91);
  assert.equal(runtime.listCollection('cuestiones').length, 91);
  assert.equal(runtime.listCollection('fuentes').length, 53);
  assert.equal(runtime.listCollection('esquemas_probatorios').length, 4);
  assert.equal(runtime.listCollection('precedentes').length, 5);
  assert.equal(runtime.listCollection('bloques_redaccion').length, 33);
  assert.equal(runtime.listCollection('huecos').length, 14);
});

test('knowledge fuente: conserva gobernanza y magnitudes declaradas por el corpus', () => {
  const summary = personaFisicaKnowledgeSummary(source);
  assert.deepEqual(summary, {
    id: 'kb_concurso_persona_fisica',
    version: '1.0.0',
    fecha_corte_normativa: '2026-09-25',
    normas: 53,
    reglas: 91,
    automaticas: 71,
    mixtas: 11,
    valoracion_judicial: 9,
    fases: 21,
    resoluciones: 15,
    fundamentos_tipo: 33,
    jurisprudencia: 5,
    pendiente_verificar: 14
  });
});

test('knowledge fuente: una valoración judicial no se degrada a regla automática', () => {
  const runtime = prepareKnowledgeRuntime(adaptPersonaFisicaKnowledgeSource(source));
  const rule = runtime.getRule('KB.R.EPI_017');
  assert.equal(rule.tipo, 'criterio_valorativo');
  assert.equal(rule.estado.madurez, 'tentativo');
  assert.match(rule.titulo, /endeudamiento temerario/i);
});

test('knowledge registry: el pack nuevo amplía materia sin desplazar la paridad activa', () => {
  const baseline = loadKnowledgeRuntime();
  const personaFisica = prepareKnowledgeRuntime(adaptPersonaFisicaKnowledgeSource(source));
  const registry = createKnowledgeRegistry([baseline, personaFisica]);
  assert.equal(registry.primary('declaracion_sin_masa').pack_id, 'KP-CONCURSAL-CSM');
  assert.equal(registry.primary('epi_general').pack_id, 'KP-CONCURSAL-PERSONA-FISICA');
  assert.equal(registry.runtimes.length, 2);
});

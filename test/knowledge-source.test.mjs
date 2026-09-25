import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptPersonaFisicaKnowledgeSource, personaFisicaKnowledgeSummary } from '../src/adapters/concursal/knowledge-persona-fisica.mjs';
import { validateKnowledgePack } from '../src/core/knowledge/contracts.mjs';
import { prepareKnowledgeRuntime } from '../src/core/knowledge/runtime.mjs';
import { createKnowledgeRegistry } from '../src/core/knowledge/registry.mjs';
import { evaluateKnowledgeModule } from '../src/core/knowledge/rule-engine.mjs';
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


test('knowledge rules: el Core ejecuta JSON Logic sin conocer derecho concursal', () => {
  const runtime = prepareKnowledgeRuntime(adaptPersonaFisicaKnowledgeSource(source));
  const expediente = {
    deudor: {
      nif: '12345678Z',
      es_empresario: true,
      num_trabajadores_medio_anio_anterior: 2,
      volumen_negocio_anual: 120000,
      coi_provincia: 'Girona',
      insolvencia_tipo: 'actual'
    },
    solicitante: { tipo: 'deudor', procurador: true, abogado: true, poder_especial_concurso: true, poder_forma: 'notarial', modelo_oficial: true },
    documentos: { memoria: true, memoria_datos_conyuge: true, inventario: true, inventario_con_valoracion: true, relacion_acreedores: true, relacion_acreedores_completa: true, datos_trabajadores: true },
    procedimiento: { organo_provincia: 'Girona', organo_es_seccion_mercantil: true },
    pasivo: { total: 100000 },
    antecedentes: {},
    calc: {}
  };
  const result = evaluateKnowledgeModule(runtime, 'solicitud_declaracion', expediente);
  assert.equal(result.rules_evaluated, 15);
  assert.ok(result.triggered.some((item) => item.source_id === 'SOL_002'));
  assert.ok(result.blocking.some((item) => item.source_id === 'SOL_002' && item.severity === 'derivacion'));
});

test('knowledge rules: las reglas valorativas salen como cuestión judicial y no como automática', () => {
  const runtime = prepareKnowledgeRuntime(adaptPersonaFisicaKnowledgeSource(source));
  const result = evaluateKnowledgeModule(runtime, 'epi_general', {
    antecedentes: { indicios_endeudamiento_temerario: true },
    epi: { oposiciones: [] },
    pasivo: { total: 1 },
    procedimiento: { fase_actual: 'F_EPI_LIQ_TRASLADO' }
  });
  const item = result.judicial_questions.find((row) => row.source_id === 'EPI_017');
  assert.ok(item);
  assert.equal(item.requires_human_decision, true);
});

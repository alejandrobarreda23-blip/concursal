import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadKnowledgeRuntime } from '../../core/knowledge/node-loader.mjs';
import { prepareKnowledgeRuntime } from '../../core/knowledge/runtime.mjs';
import { createKnowledgeRegistry } from '../../core/knowledge/registry.mjs';
import { adaptPersonaFisicaKnowledgeSource } from './knowledge-persona-fisica.mjs';

export const KNOWLEDGE_PERSONA_FISICA_SOURCE = fileURLToPath(
  new URL('../../../knowledge/source/concursal/kb-concurso-persona-fisica-1.0.0.json', import.meta.url)
);

export function loadConcursalKnowledgeRegistry() {
  const baseline = loadKnowledgeRuntime();
  const source = JSON.parse(readFileSync(KNOWLEDGE_PERSONA_FISICA_SOURCE, 'utf8'));
  const personaFisica = prepareKnowledgeRuntime(adaptPersonaFisicaKnowledgeSource(source));
  return createKnowledgeRegistry([baseline, personaFisica]);
}

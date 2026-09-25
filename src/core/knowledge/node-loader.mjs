// Loader Node para Knowledge Packs. La web usa el loader por URL.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareKnowledgeRuntime } from './runtime.mjs';

export const KNOWLEDGE_CONCURSAL_CSM = fileURLToPath(
  new URL('../../../knowledge/runtime/concursal/concurso-sin-masa-1.1.0.json', import.meta.url)
);

export function loadKnowledgeRuntime(filePath = KNOWLEDGE_CONCURSAL_CSM) {
  return prepareKnowledgeRuntime(JSON.parse(readFileSync(filePath, 'utf8')));
}

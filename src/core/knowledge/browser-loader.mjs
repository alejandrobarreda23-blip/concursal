import { prepareKnowledgeRuntime } from './runtime.mjs';

export async function loadKnowledgeRuntimeFromUrl(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`No se ha podido cargar Knowledge (${response.status}).`);
  return prepareKnowledgeRuntime(await response.json());
}

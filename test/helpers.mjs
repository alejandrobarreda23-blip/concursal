import { readFileSync } from 'node:fs';
import { loadKnowledgeRuntime } from '../src/core/knowledge/node-loader.mjs';

export const ejemplo = (n) => JSON.parse(readFileSync(new URL(`../ejemplos/${n}.json`, import.meta.url), 'utf8'));
export const copia = (x) => JSON.parse(JSON.stringify(x));
export const knowledge = loadKnowledgeRuntime();

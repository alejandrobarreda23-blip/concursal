import { readFileSync } from 'node:fs';
export const ejemplo = (n) => JSON.parse(readFileSync(new URL(`../ejemplos/${n}.json`, import.meta.url), 'utf8'));
export const copia = (x) => JSON.parse(JSON.stringify(x));

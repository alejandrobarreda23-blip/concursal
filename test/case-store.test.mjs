import { test } from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.has(key) ? memory.get(key) : null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key)
};

const {
  listProcedimientos, getProcedimiento, putProcedimiento,
  deleteProcedimiento, findBySourceHash, clearProcedimientos
} = await import('../web/case-store.mjs');

test('case-store: fallback local persiste, lista, busca y elimina procedimientos', async () => {
  await clearProcedimientos();
  const a = { id: 'CSM-A', updatedAt: '2026-09-25T10:00:00Z', source: { hash: 'abc' }, expediente: { deudor: { nombre: 'A' } } };
  const b = { id: 'CSM-B', updatedAt: '2026-09-25T11:00:00Z', source: { hash: 'def' }, expediente: { deudor: { nombre: 'B' } } };

  await putProcedimiento(a);
  await putProcedimiento(b);

  const rows = await listProcedimientos();
  assert.deepEqual(rows.map((row) => row.id), ['CSM-B', 'CSM-A']);
  assert.equal((await getProcedimiento('CSM-A')).expediente.deudor.nombre, 'A');
  assert.equal((await findBySourceHash('def')).id, 'CSM-B');

  await deleteProcedimiento('CSM-A');
  assert.equal(await getProcedimiento('CSM-A'), null);
  assert.deepEqual((await listProcedimientos()).map((row) => row.id), ['CSM-B']);
});

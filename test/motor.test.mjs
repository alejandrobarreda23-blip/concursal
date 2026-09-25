import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { generarAuto, redactar, aTextoPlano, controlesCalidad } from '../src/index.mjs';
import { validarPack, estadoRatificacion, hashBloques } from '../src/bloques.mjs';
import { ejemplo, copia } from './helpers.mjs';

const EJEMPLOS = ['01-epi-sin-oposicion', '02-con-oposicion', '03-persona-juridica-sin-epi', '04-garantia-real-y-publico'];

test('determinismo: mismo expediente → mismo IR y mismo texto', () => {
  const e = ejemplo('04-garantia-real-y-publico');
  const a = generarAuto(e), b = generarAuto(copia(e));
  assert.equal(a.ir.hash_ir, b.ir.hash_ir);
  assert.equal(a.texto, b.texto);
});

test('golden: los ejemplos producen exactamente el texto de referencia', () => {
  for (const n of EJEMPLOS) {
    const r = generarAuto(ejemplo(n));
    const meta = JSON.parse(readFileSync(new URL(`./golden/${n}.json`, import.meta.url), 'utf8'));
    assert.equal(r.estado, meta.estado, n);
    assert.equal(r.ir?.hash_ir ?? null, meta.hash_ir, `${n}: hash del IR distinto (¿cambio intencionado? npm run golden)`);
    const ruta = new URL(`./golden/${n}.txt`, import.meta.url);
    if (existsSync(ruta)) assert.equal(r.texto, readFileSync(ruta, 'utf8'), n);
  }
});

test('todos los borradores generados superan los controles de calidad', () => {
  for (const n of EJEMPLOS) {
    const r = generarAuto(ejemplo(n));
    if (r.texto) assert.equal(r.controles.ok, true, `${n}: ${r.controles.fallos.join('; ')}`);
  }
});

test('el IR es inmutable', () => {
  const r = generarAuto(ejemplo('01-epi-sin-oposicion'));
  assert.throws(() => { r.ir.totales.exonerado = 0; });
});

test('control de calidad: detecta alternativas de plantilla sin resolver', () => {
  const r = generarAuto(ejemplo('01-epi-sin-oposicion'));
  const texto = r.texto + '\nderivada del impago de los [servicios prestados / bienes suministrados]';
  const c = controlesCalidad(r.ir, r.documento, texto);
  assert.equal(c.ok, false);
  assert.ok(c.fallos.some((f) => f.includes('alternativa')));
});

test('control de calidad: detecta un importe que no sale del expediente', () => {
  const r = generarAuto(ejemplo('01-epi-sin-oposicion'));
  const c = controlesCalidad(r.ir, r.documento, r.texto.replace('12.000,00 €', '12.020,00 €'));
  assert.ok(c.fallos.some((f) => f.includes('12.020,00 €')));
});

test('control de calidad: detecta partes cruzadas', () => {
  const e = ejemplo('01-epi-sin-oposicion');
  e.creditos[0].acreedor = e.deudor.nombre;
  const r = generarAuto(e);
  assert.equal(r.estado, 'bloqueado_por_calidad');
});

test('paquete: rechaza variables no permitidas y alternativas entre corchetes', () => {
  const pack = JSON.parse(readFileSync(new URL('../packs/concurso-sin-masa.v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(validarPack(pack), []);
  const malo = copia(pack);
  malo.bloques[0].texto += ' {{inventada}} [a / b]';
  const errs = validarPack(malo).join('\n');
  assert.ok(errs.includes('inventada') && errs.includes('corchetes'));
});

test('ratificación: cualquier cambio en un bloque invalida la ratificación', () => {
  const pack = JSON.parse(readFileSync(new URL('../packs/concurso-sin-masa.v1.json', import.meta.url), 'utf8'));
  const ok = copia(pack);
  ok.ratificacion = { estado: 'ratificado', ratificado_por: 'Juez de prueba', fecha: '2026-09-25', hash_bloques: hashBloques(ok) };
  assert.equal(estadoRatificacion(ok).ratificado, true);
  const r = generarAuto(ejemplo('01-epi-sin-oposicion'), { pack: ok });
  assert.equal(r.estado, 'borrador');
  assert.ok(!r.texto.includes('BORRADOR NO RATIFICADO'));
  ok.bloques[0].texto += ' ';
  ok.bloques[0].texto = ok.bloques[0].texto.replace('declaró', 'acordó');
  assert.equal(estadoRatificacion(ok).ratificado, false);
});

test('sin ratificar, el texto lleva la marca de borrador', () => {
  const r = generarAuto(ejemplo('01-epi-sin-oposicion'));
  assert.equal(r.estado, 'borrador_no_ratificado');
  assert.ok(r.texto.startsWith('BORRADOR NO RATIFICADO'));
});

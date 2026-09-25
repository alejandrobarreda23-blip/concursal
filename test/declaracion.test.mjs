import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarDeclaracion, determinarFaseDeclaracion } from '../src/index.mjs';
import { ejemplo, copia } from './helpers.mjs';

const base = ejemplo('10-declaracion-desde-solicitud');

test('declaración: genera el borrador y recoge todo el pasivo', () => {
  const r = generarDeclaracion(base);
  assert.equal(r.estado, 'borrador_no_ratificado');
  assert.equal(r.controles.ok, true);
  assert.match(r.texto, /Declaro en concurso voluntario sin masa a PERSONA DEUDORA EJEMPLO, con NIF 00000000T/);
  assert.match(r.texto, /asciende a 24\.790,71 €/);
  assert.match(r.texto, /37 bis\.1\.1\.º/);
  assert.match(r.texto, /No se nombra administración concursal/);
});

test('declaración: sin decisión del juez no se redacta', () => {
  const e = copia(base); e.decision_judicial = {};
  const r = generarDeclaracion(e);
  assert.equal(r.estado, 'pendiente_decision');
  assert.equal(r.motivos.length, 4);
});

test('declaración: documentos del art. 7 incompletos → borrador con advertencia, no bloqueo', () => {
  const e = copia(base);
  e.solicitud.documentos.poder = false;
  e.solicitud.documentos.memoria = false;
  e.solicitud.documentos.inventario = false;
  const f = determinarFaseDeclaracion(e);
  assert.equal(f.estado, 'listo');
  const r = generarDeclaracion(e);
  assert.equal(r.estado, 'borrador_no_ratificado');
  assert.ok(r.controles.avisos.some((a) => /poder, memoria, inventario/.test(a)));
  assert.match(r.texto, /ADVERTENCIA DE BORRADOR/);
  assert.ok(!r.texto.includes('acompañó la documentación prevista en el artículo 7'));
});

test('declaración: sin nombre del juez → genera con hueco y advertencia', () => {
  const e = copia(base); e.juez.nombre = '';
  const r = generarDeclaracion(e);
  assert.equal(r.estado, 'borrador_no_ratificado');
  assert.match(r.texto, /Magistrado: ____________________/);
  assert.ok(r.controles.avisos.some((a) => /Falta el nombre del juez\/a/.test(a)));
});

test('declaración: plan de pagos, concurso necesario u ordinario → fuera de alcance', () => {
  for (const cambio of [(e) => { e.solicitud.plan_pagos = true; }, (e) => { e.solicitud.solicitante = 'acreedor'; }, (e) => { e.solicitud.tipo = 'concurso_ordinario'; }]) {
    const e = copia(base); cambio(e);
    assert.equal(determinarFaseDeclaracion(e).estado, 'fuera_de_alcance');
  }
});

test('declaración: la EPI anunciada solo se menciona para persona natural que la pide', () => {
  const sin = copia(base); sin.solicitud.pide_epi = false;
  assert.ok(!generarDeclaracion(sin).texto.includes('Exoneración del pasivo insatisfecho'));
  assert.ok(generarDeclaracion(base).texto.includes('Exoneración del pasivo insatisfecho'));
});

test('declaración: faltan NIF o domicilio → expediente inválido', () => {
  const e = copia(base); e.deudor.nif = '';
  assert.equal(generarDeclaracion(e).estado, 'expediente_invalido');
});

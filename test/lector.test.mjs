import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoDePdf } from '../src/lector/pdf-node.mjs';
import { textoPlanoAPaginas } from '../src/lector/texto-pdf.mjs';
import { leerSolicitud } from '../src/lector/lector.mjs';
import { lecturaAExpedienteDeclaracion, declaracionAExpedienteConclusion } from '../src/lector/a-expediente.mjs';

const F = (n) => new URL(`./fixtures/solicitudes/${n}.pdf`, import.meta.url).pathname;
const leer = async (n) => leerSolicitud(await textoDePdf(F(n)), { nombre_fichero: n });

test('escrito sin masa: clasificación', async () => {
  const l = await leer('01-sin-masa-escrito');
  const c = l.clasificacion;
  assert.equal(c.tipo, 'concurso_sin_masa');
  assert.equal(c.solicitante, 'deudor');
  assert.equal(c.persona, 'natural');
  assert.equal(c.insolvencia, 'actual');
  assert.equal(c.pide_epi, true);
  assert.equal(c.plan_pagos, false);
  assert.ok(!l.alertas.some((a) => a.nivel === 'bloqueo'));
});

test('escrito sin masa: campos con su línea de origen', async () => {
  const { campos: c } = await leer('01-sin-masa-escrito');
  assert.equal(c.deudor_nombre.valor, 'PERSONA DEUDORA EJEMPLO');
  assert.equal(c.deudor_nif.valor, '00000000T');
  assert.equal(c.deudor_domicilio.valor, 'Calle Inventada 1, 08850 Gavà (Barcelona)');
  assert.equal(c.procurador.valor, 'PROCURADORA EJEMPLO');
  assert.equal(c.abogado.valor, 'ABOGADO EJEMPLO');
  assert.equal(c.fecha_escrito.valor, '2026-03-03');
  assert.equal(c.pasivo_declarado.valor, 2479071);
  assert.equal(c.activo_declarado.valor, 35000);
  assert.deepEqual(c.causas.valor, ['desempleo', 'sobreendeudamiento']);
  for (const v of Object.values(c)) assert.ok(v.fuente?.pagina && v.fuente?.linea && v.regla, JSON.stringify(v));
  assert.match(c.deudor_nif.fuente.texto, /00000000T/);
});

test('escrito sin masa: relación de acreedores, clases y cuadre con el pasivo', async () => {
  const l = await leer('01-sin-masa-escrito');
  assert.deepEqual(l.acreedores.map((a) => [a.acreedor, a.nif, a.importe, a.clase]), [
    ['Banco Ficticio, S.A.', 'A00000001', 1200000, 'ordinario'],
    ['Financiera Ejemplo, S.A.', 'A00000002', 175021, 'ordinario'],
    ['Agencia Estatal de Administración Tributaria', 'Q2826000H', 800000, 'publico_aeat'],
    ['Tesorería General de la Seguridad Social', 'Q2827003A', 240000, 'publico_tgss'],
    ['Ayuntamiento Ficticio', 'P0800000A', 64050, 'publico_otro']
  ]);
  assert.equal(l.suma_acreedores, l.campos.pasivo_declarado.valor);
  assert.ok(!l.alertas.some((a) => /no coincide/.test(a.texto)));
});

test('formulario del Anexo I (ICAB): casillas, tabla de contratos y fin de sección en los gastos', async () => {
  const l = await leer('02-formulario-icab');
  assert.equal(l.clasificacion.tipo, 'concurso_sin_masa');
  assert.equal(l.clasificacion.formulario_icab, true);
  assert.equal(l.campos.deudor_nombre.valor, 'MARIA EJEMPLO FICTICIA');
  assert.equal(l.campos.estado_civil.valor, 'casado');
  assert.equal(l.campos.regimen_economico.valor, 'separacion de bienes');
  assert.equal(l.campos.personas_a_cargo.valor, true);
  assert.equal(l.campos.numero_acreedores.valor, 3);
  assert.deepEqual(l.acreedores.map((a) => [a.acreedor, a.importe, a.clase]), [
    ['Wizink Ficticio, S.A.', 930000, 'ordinario'],
    ['Cofidis Ficticio, S.A.', 600000, 'ordinario'],
    ['Excónyuge (alimentos)', 300000, 'alimentos']
  ]);
  assert.equal(l.suma_acreedores, 1830000); // los gastos mensuales no se cuelan como acreedores
});

test('concurso ordinario con vivienda y plan de pagos: bloqueado y con avisos', async () => {
  const l = await leer('03-ordinario-con-masa');
  assert.equal(l.clasificacion.tipo, 'concurso_ordinario');
  assert.equal(l.clasificacion.plan_pagos, true);
  assert.ok(l.alertas.some((a) => a.nivel === 'bloqueo'));
  const hip = l.acreedores.find((a) => a.clase === 'garantia_real');
  assert.equal(hip.acreedor, 'Banco Hipotecario Ficticio, S.A.');
  assert.equal(hip.concepto, 'Préstamo hipotecario vivienda');
});

test('determinismo: mismo PDF → misma lectura y mismo hash', async () => {
  const a = await leer('01-sin-masa-escrito');
  const b = await leer('01-sin-masa-escrito');
  assert.equal(a.hash_lectura, b.hash_lectura);
  assert.deepEqual(a, b);
});

test('PDF sin capa de texto → bloqueo', () => {
  const l = leerSolicitud(textoPlanoAPaginas(''), { nombre_fichero: 'escaneado.pdf' });
  assert.ok(l.alertas.some((a) => a.nivel === 'bloqueo' && /capa de texto/.test(a.texto)));
});

test('microempresas y concurso necesario se detectan', () => {
  const micro = leerSolicitud(textoPlanoAPaginas('Solicitud de apertura del procedimiento especial para microempresas, art. 691 TRLC, de persona física empresaria. '.repeat(3)));
  assert.equal(micro.clasificacion.tipo, 'microempresas');
  const nec = leerSolicitud(textoPlanoAPaginas('Solicitud de concurso necesario de persona física instada por el acreedor Banco Ficticio, S.A., contra el deudor con DNI 00000000T. '.repeat(3)));
  assert.equal(nec.clasificacion.solicitante, 'acreedor');
  assert.ok(nec.alertas.some((a) => /necesario/.test(a.texto)));
});

test('la lectura se convierte en expediente sin decisión judicial y con importes en euros', async () => {
  const e = lecturaAExpedienteDeclaracion(await leer('01-sin-masa-escrito'));
  assert.deepEqual(e.decision_judicial, {});
  assert.equal(e.deudor.nif, '00000000T');
  assert.equal(e.solicitud.pasivo_declarado, 24790.71);
  assert.equal(e.creditos[1].importe, 1750.21);
  assert.equal(e.solicitud.documentos.memoria, true);
  const c = declaracionAExpedienteConclusion(e, { fecha_declaracion: '2026-03-20', solicitud_epi_fecha: '2026-04-20' });
  assert.equal(c.tramite.solicitud_nombramiento_ac, null); // no se presume
  assert.equal(c.creditos.length, 5);
});

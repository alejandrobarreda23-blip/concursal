import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoPlanoAPaginas } from '../src/lector/texto-pdf.mjs';
import { anonimizarDocumentoConcursal } from '../src/adapters/concursal/anonymize-document.mjs';
import { detectDirectIdentifiers } from '../src/core/extraction/pseudonymization.mjs';
import { handler } from '../netlify/functions/extract-solicitud.mjs';

const lectura = {
  campos: {
    deudor_nombre: { valor: 'Juan Pérez Gómez' },
    deudor_nif: { valor: '12345678Z' },
    deudor_domicilio: { valor: 'Calle Ejemplo 12, 2º B, 41000 Sevilla' },
    deudor_localidad: { valor: 'Sevilla' },
    procurador: { valor: 'María López Ruiz' },
    abogado: { valor: 'Carlos Martín Soler' }
  },
  acreedores: [
    { acreedor: 'Banco Ejemplo, S.A.' },
    { acreedor: 'Pedro García León' }
  ]
};

test('anonimización local: identificadores y nombres no salen en el texto para IA', () => {
  const doc = textoPlanoAPaginas([
    'D. Juan Pérez Gómez, con DNI 12345678-Z, domicilio en Calle Ejemplo 12, 2º B, 41000 Sevilla.',
    'Correo: juan.perez@example.com. Teléfono 612 345 678.',
    'Cuenta ES91 2100 0418 4502 0005 1332.',
    'Procuradora María López Ruiz y abogado Carlos Martín Soler.',
    'Acreedores: Banco Ejemplo, S.A. 10.000 euros; Pedro García León 2.000 euros.'
  ].join('\n'));

  const privacy = anonimizarDocumentoConcursal(doc, lectura);
  for (const raw of [
    'Juan Pérez Gómez','12345678-Z','12345678Z','Calle Ejemplo 12',
    'Sevilla','juan.perez@example.com','612 345 678',
    'ES91 2100 0418 4502 0005 1332','María López Ruiz','Carlos Martín Soler','Pedro García León'
  ]) assert.equal(privacy.text.includes(raw), false, raw);

  assert.equal(detectDirectIdentifiers(privacy.text).length, 0);
  assert.match(privacy.text, /\[(?:PERSONA|NOMBRE_PROPIO)_\d{3}\]/);
  assert.match(privacy.text, /\[IDENTIFICADOR_\d{3}\]/);
  assert.match(privacy.text, /\[DOMICILIO_\d{3}\]/);
  assert.equal(privacy.manifest.mapping_shared, false);
  assert.equal(privacy.manifest.asserted_no_direct_identifiers, true);
  assert.ok(privacy.manifest.total_replacements >= 6);
});

test('anonimización local: la rehidratación sucede sólo después de volver al navegador', () => {
  const doc = textoPlanoAPaginas('D. Juan Pérez Gómez, con DNI 12345678-Z, domicilio en Calle Ejemplo 12, 2º B, 41000 Sevilla.');
  const privacy = anonimizarDocumentoConcursal(doc, lectura);
  const nameToken = /\[(?:PERSONA|NOMBRE_PROPIO)_\d{3}\]/.exec(privacy.text)?.[0];
  const idToken = /\[IDENTIFICADOR_\d{3}\]/.exec(privacy.text)?.[0];
  assert.ok(nameToken && idToken);

  const restored = privacy.restore({
    campos: {
      deudor_nombre: { value: nameToken, confidence: 0.95, evidence: { page: 1, line: 1, quote: nameToken } },
      deudor_nif: { value: idToken, confidence: 0.99, evidence: { page: 1, line: 1, quote: idToken } }
    }
  });
  assert.equal(restored.campos.deudor_nombre.value, 'Juan Pérez Gómez');
  assert.equal(restored.campos.deudor_nif.value, '12345678Z');
  assert.match(restored.campos.deudor_nombre.evidence.quote, /Juan Pérez Gómez/);
});

test('endpoint IA: rechaza peticiones sin sobre de privacidad antes de cualquier llamada externa', async () => {
  const r = await handler({ httpMethod: 'POST', body: JSON.stringify({ document_text: 'D. Juan Pérez Gómez con DNI 12345678Z solicita concurso.' }) });
  assert.equal(r.statusCode, 422);
  assert.equal(JSON.parse(r.body).error.code, 'PRIVACY_ENVELOPE_REQUIRED');
});

test('endpoint IA: defensa en profundidad rechaza identificadores directos aunque exista manifest', async () => {
  const r = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      document_text: '[PERSONA_001] con DNI 12345678Z y correo prueba@example.com solicita concurso.',
      privacy: {
        mode: 'pseudonymized',
        version: 'local-pseudonymization-v1',
        replacements: { PERSONA: 1 },
        total_replacements: 1,
        mapping_shared: false,
        asserted_no_direct_identifiers: true
      }
    })
  });
  assert.equal(r.statusCode, 422);
  assert.equal(JSON.parse(r.body).error.code, 'PRIVACY_GUARD_FAILED');
});

// Lector determinista de solicitudes de concurso (persona física, cauce sin masa).
// Entrada: texto por páginas y líneas (de texto-pdf.mjs). Salida: una LECTURA con
//  - la clasificación de la petición,
//  - los campos necesarios para el auto, cada uno con la línea del PDF de la que sale,
//  - la relación de acreedores,
//  - los documentos que el escrito dice acompañar,
//  - alertas para revisión humana.
// No usa IA: con el mismo texto devuelve siempre la misma lectura (y el mismo hash).
import { hash, deepFreeze, aCentimos } from '../util.mjs';
import {
  REGLAS_VERSION, REGLAS_CLASIFICACION, REGLAS_DOCUMENTOS, REGLAS_CLASE_CREDITO,
  INICIO_ACREEDORES, FIN_ACREEDORES, RE_IMPORTE, RE_NIF, RE_EMAIL, RE_FECHA, GARANTIAS, FORMA_JURIDICA
} from './reglas.mjs';

export const LECTOR_VERSION = 'lector/0.1.0';
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

export const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const limpiar = (s) => String(s).replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[,.;:\s]+|[,;:\s]+$/g, '');
const tituloPersona = /^(?:don|dona|doña|d\.|dª|d\.ª|sr\.|sra\.)\s+/i;

function importeACentimos(txt) {
  const m = /(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/.exec(txt);
  return m ? parseInt(m[1].replace(/\./g, ''), 10) * 100 + parseInt(m[2], 10) : null;
}

// Texto corrido con mapa de posiciones → (página, línea), para citar la fuente de cada dato.
function indexar(doc) {
  const lineas = [];
  let texto = '';
  for (const p of doc.paginas) for (const [i, l] of p.lineas.entries()) {
    lineas.push({ inicio: texto.length, pagina: p.pagina, linea: i + 1, texto: l.texto, celdas: l.celdas });
    texto += l.texto + '\n';
  }
  return { texto, lineas };
}

function fuente(idx, posicion) {
  let l = idx.lineas[0];
  for (const x of idx.lineas) { if (x.inicio <= posicion) l = x; else break; }
  return l ? { pagina: l.pagina, linea: l.linea, texto: l.texto } : null;
}

function buscar(idx, regla, patron, grupo = 1, transformar = limpiar) {
  const re = new RegExp(patron.source, patron.flags.includes('i') ? patron.flags : patron.flags + 'i');
  const m = re.exec(idx.texto.replace(/\n/g, ' '));
  if (!m) return null;
  const valor = transformar(m[grupo] ?? m[0]);
  if (valor === null || valor === '') return null;
  const desde = m[grupo] != null ? m.index + Math.max(0, m[0].indexOf(m[grupo])) : m.index;
  return { valor, regla, fuente: fuente(idx, desde) };
}

function primero(...candidatos) { return candidatos.find(Boolean) || null; }

// ---------------- Clasificación ----------------
function clasificar(idx) {
  const n = norm(idx.texto.replace(/\n/g, ' '));
  const out = { sin_masa: false, microempresa: false, solicitante: null, persona: null, empresario: null, insolvencia: null, pide_epi: false, plan_pagos: false, formulario_icab: false, indicio_masa: false };
  const evidencias = [];
  for (const r of REGLAS_CLASIFICACION) {
    const m = r.patron.exec(n);
    if (!m) continue;
    const previo = out[r.campo];
    if (previo !== null && previo !== false && previo !== r.valor) {
      evidencias.push({ regla: r.id, conflicto: `${r.campo}: ${previo} / ${r.valor}`, fuente: fuente(idx, m.index) });
      continue;
    }
    out[r.campo] = r.valor;
    evidencias.push({ regla: r.id, fuente: fuente(idx, m.index) });
  }
  let tipo = 'concurso_ordinario';
  if (out.microempresa) tipo = 'microempresas';
  else if (out.sin_masa) tipo = 'concurso_sin_masa';
  return { tipo, ...out, evidencias };
}

// Fecha del escrito: última línea con la forma "Lugar, (a) D de mes de AAAA".
function fechaEscrito(idx) {
  for (let i = idx.lineas.length - 1; i >= 0; i--) {
    const l = idx.lineas[i];
    const m = /^(?:[Ee]n\s+)?([A-ZÁÉÍÓÚÑ][\wáéíóúñà'· -]*?),\s*(?:a\s+)?(\d{1,2}) de ([a-zA-Z]+) de (\d{4})/.exec(l.texto);
    const mes = m && MESES[norm(m[3])];
    if (mes) return { valor: `${m[4]}-${String(mes).padStart(2, '0')}-${m[2].padStart(2, '0')}`, lugar: m[1].trim(), regla: 'ESCRITO.fecha', fuente: { pagina: l.pagina, linea: l.linea, texto: l.texto } };
  }
  return null;
}

const tituloCiudad = (s) => limpiar(s).toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase());

// ---------------- Campos ----------------
function extraerCampos(idx) {
  const c = {};
  c.deudor_nombre = primero(
    buscar(idx, 'DEUDOR.nombre.formulario', /nombre y apellidos\s*:\s*([^\n|]+?)(?=\s+nif\b|\s+\d+\.\s|$)/),
    buscar(idx, 'DEUDOR.nombre.representacion', /representaci[oó]n de\s+((?:don|doña|dona|d\.|dª)\s+[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ .'-]+?)\s*,/, 1, (s) => limpiar(s).replace(tituloPersona, '')),
    buscar(idx, 'DEUDOR.nombre.en_nombre', /en nombre de\s+((?:don|doña|dona|d\.|dª)\s+[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ .'-]+?)\s*,/, 1, (s) => limpiar(s).replace(tituloPersona, ''))
  );
  c.deudor_nif = primero(
    buscar(idx, 'DEUDOR.nif.etiqueta', /\b(?:dni|nie|nif)\s*(?:n\.?º|núm\.?|:)?\s*([0-9XYZ][0-9]{7}[A-Z])\b/, 1, (s) => s.toUpperCase())
  );
  c.deudor_domicilio = primero(
    buscar(idx, 'DEUDOR.domicilio.formulario', /domicilio\s*:\s*([^\n]+?\))/),
    buscar(idx, 'DEUDOR.domicilio.escrito', /domicilio en\s+(.+?\))\s*,/),
    buscar(idx, 'DEUDOR.domicilio.domiciliado', /domiciliad[oa] en\s+([^,]+)/)
  );
  c.deudor_localidad = primero(
    buscar(idx, 'DEUDOR.localidad.cp', /\b\d{5}\s+([A-ZÁÉÍÓÚÑÜ][\wÁÉÍÓÚÑÜáéíóúñüà'·-]+(?:\s+(?:de|del|la|les|el)\s+[\wÁÉÍÓÚÑÜáéíóúñüà'·-]+)*)/),
    buscar(idx, 'DEUDOR.localidad.domiciliado', /domiciliad[oa] en\s+([^,]+)/)
  );
  c.estado_civil = primero(
    buscar(idx, 'DEUDOR.estado_civil.casilla', /estado civil\s*:\s*\[x\]\s*([a-záéíóú ]+?)(?=\s*(?:\d+\.|\[|$))/, 1, (s) => norm(limpiar(s))),
    buscar(idx, 'DEUDOR.estado_civil.texto', /estado civil\s*:?\s*(solter[oa]|casad[oa]|separad[oa]|divorciad[oa]|viud[oa]|pareja de hecho)/, 1, (s) => norm(s))
  );
  c.regimen_economico = buscar(idx, 'DEUDOR.regimen', /r[eé]gimen econ[oó]mico matrimonial\s*:?\s*(?:\[x\]\s*)?(gananciales|separaci[oó]n de bienes|participaci[oó]n)/, 1, (s) => norm(s));
  c.personas_a_cargo = primero(
    buscar(idx, 'DEUDOR.cargas.casilla', /personas a su cargo[^[]*\[x\]\s*(s[ií]|no)(?![a-záéíóú])/, 1, (s) => norm(s) === 'si'),
    buscar(idx, 'DEUDOR.cargas.texto', /(no tiene|tiene) personas a su cargo/, 1, (s) => norm(s) === 'tiene')
  );
  c.procurador = buscar(idx, 'PARTES.procurador', /(?:^|\n|\s)((?:don|doña|dona|d\.|dª)\s+[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ .'-]+?)\s*,\s*procurador/i, 1, (s) => limpiar(s).replace(tituloPersona, ''));
  c.abogado = buscar(idx, 'PARTES.abogado', /direcci[oó]n letrada de\s+((?:don|doña|dona|d\.|dª)\s+[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ .'-]+?)\s*,/, 1, (s) => limpiar(s).replace(tituloPersona, ''));
  c.organo_destino = primero(
    buscar(idx, 'ORGANO.seccion', /secci[oó]n de lo mercantil del tribunal de instancia de\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)/, 1, (s) => `Sección de lo Mercantil del Tribunal de Instancia de ${tituloCiudad(s)}`),
    buscar(idx, 'ORGANO.juzgado', /al juzgado de lo mercantil (?:n[.ºo°]*\s*\d+\s*)?de\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)/, 1, (s) => `Juzgado de lo Mercantil de ${tituloCiudad(s)}`)
  );
  c.fecha_escrito = fechaEscrito(idx);
  c.pasivo_declarado = primero(
    buscar(idx, 'IMPORTES.pasivo.formulario', /importe global de las deudas\s*:\s*([\d.]+,\d{2})/, 1, importeACentimos),
    buscar(idx, 'IMPORTES.pasivo.escrito', /importe global de sus deudas[^0-9]{0,40}([\d.]+,\d{2})/, 1, importeACentimos)
  );
  c.activo_declarado = primero(
    buscar(idx, 'IMPORTES.activo.formulario', /valor de los bienes y derechos\s*:\s*([\d.]+,\d{2})/, 1, importeACentimos),
    buscar(idx, 'IMPORTES.activo.escrito', /valor total de sus bienes y derechos[^0-9]{0,40}([\d.]+,\d{2})/, 1, importeACentimos)
  );
  c.numero_acreedores = buscar(idx, 'ACREEDORES.numero', /n[uú]mero de acreedores\s*:\s*(\d+)/, 1, (s) => parseInt(s, 10));
  c.causas = buscar(idx, 'INSOLVENCIA.causas', /(desempleo|sobreendeudamiento|p[eé]rdidas empresariales|disminuci[oó]n de las ventas|inflaci[oó]n)/, 0, () => {
    const n = norm(idx.texto);
    const lista = ['desempleo', 'sobreendeudamiento', 'perdidas empresariales', 'disminucion de las ventas', 'aumento de los gastos', 'costes financieros', 'morosidad', 'inflacion'].filter((k) => n.includes(k));
    return lista.length ? lista : null;
  });
  for (const k of Object.keys(c)) if (c[k] == null) delete c[k];
  return c;
}

// ---------------- Relación de acreedores ----------------
function claseCredito(acreedor, concepto, garantia) {
  const n = norm(`${acreedor} ${concepto} ${garantia || ''}`);
  for (const r of REGLAS_CLASE_CREDITO) if (r.patron.test(n)) return { clase: r.clase, regla: r.id };
  return { clase: 'ordinario', regla: 'CLASE.ordinario' };
}

function partirNombreConcepto(txt) {
  const m = FORMA_JURIDICA.exec(txt);
  if (m && m[2]) return [m[1].trim(), m[2].trim()];
  const entidades = /^(agencia estatal de administraci[oó]n tributaria|tesorer[ií]a general de la seguridad social|ayuntamiento(?: de)? [\wáéíóúñ]+|ajuntament(?: de)? [\wáéíóúñ]+)\s+(.*)$/i.exec(txt);
  if (entidades) return [entidades[1].trim(), entidades[2].trim()];
  return [txt.trim(), ''];
}

function filaAcreedor(l) {
  const importes = [...l.texto.matchAll(RE_IMPORTE)];
  if (!importes.length) return null;
  const ultimo = importes[importes.length - 1];
  const importe = importeACentimos(ultimo[0]);
  if (!importe) return null;

  let resto = (l.texto.slice(0, ultimo.index) + ' ' + l.texto.slice(ultimo.index + ultimo[0].length)).trim();
  resto = resto.replace(RE_EMAIL, ' ').replace(RE_FECHA, ' ');
  const nif = RE_NIF.exec(resto)?.[0] || null;

  let garantia = null;
  const partes = resto.split('|').map((x) => x.trim()).filter(Boolean);
  const ultimaParte = partes[partes.length - 1] || '';
  const g = GARANTIAS.exec(ultimaParte);
  if (g) { garantia = g[1].toLowerCase(); partes[partes.length - 1] = ultimaParte.slice(0, g.index).trim(); }

  let acreedor, concepto;
  const sinVacios = partes.filter(Boolean);
  if (nif) {
    const plano = sinVacios.join(' | ');
    const i = plano.indexOf(nif);
    acreedor = limpiar(plano.slice(0, i));
    concepto = limpiar(plano.slice(i + nif.length));
  } else if (sinVacios.length >= 2) {
    [acreedor, concepto] = [limpiar(sinVacios[0]), limpiar(sinVacios.slice(1).join(' '))];
    // si la primera "columna" contiene nombre + concepto pegados (celdas mal separadas)
    if (!concepto) [acreedor, concepto] = partirNombreConcepto(acreedor);
  } else {
    [acreedor, concepto] = partirNombreConcepto(limpiar(sinVacios[0] || ''));
  }
  if (!acreedor) return null;
  const { clase, regla } = claseCredito(acreedor, concepto, garantia);
  return { acreedor, nif, concepto: concepto || 'Sin concepto indicado', garantia, importe, clase, regla_clase: regla };
}

function extraerAcreedores(idx) {
  const filas = [];
  let dentro = false;
  for (const l of idx.lineas) {
    const n = norm(l.texto);
    if (!dentro) { if (INICIO_ACREEDORES.test(n)) dentro = true; continue; }
    if (FIN_ACREEDORES.test(n) && !/\d{1,3}(?:\.\d{3})*,\d{2}/.test(l.texto)) { dentro = false; continue; }
    if (/\bacreedor\b/.test(n) && /importe|cuant/.test(n)) continue; // cabecera de tabla
    const f = filaAcreedor(l);
    if (f) filas.push({ ...f, fuente: { pagina: l.pagina, linea: l.linea, texto: l.texto } });
  }
  return filas.map((f, i) => ({ id: `C${i + 1}`, ...f }));
}

// ---------------- Documentos ----------------
function extraerDocumentos(idx) {
  const n = norm(idx.texto.replace(/\n/g, ' '));
  const docs = {};
  for (const r of REGLAS_DOCUMENTOS) {
    const m = r.patron.exec(n);
    docs[r.doc] = m ? { presente: true, regla: r.id, fuente: fuente(idx, m.index) } : { presente: false, regla: r.id };
  }
  return docs;
}

// ---------------- Lectura completa ----------------
export function leerSolicitud(doc, { nombre_fichero = null } = {}) {
  const idx = indexar(doc);
  const alertas = [];
  if (doc.sin_texto) {
    alertas.push({ nivel: 'bloqueo', texto: 'El PDF no tiene capa de texto (¿escaneado?). El lector determinista no puede leerlo: hace falta un PDF generado por ordenador o introducir los datos a mano.' });
  }
  const clasificacion = clasificar(idx);
  const campos = extraerCampos(idx);
  const acreedores = extraerAcreedores(idx);
  const documentos = extraerDocumentos(idx);

  // Coherencia y alcance
  if (clasificacion.tipo === 'microempresas') alertas.push({ nivel: 'bloqueo', texto: 'La solicitud parece del procedimiento especial de microempresas: no es el cauce del concurso sin masa.' });
  if (clasificacion.tipo === 'concurso_ordinario') alertas.push({ nivel: 'bloqueo', texto: 'La solicitud no se formula como concurso sin masa (arts. 37 bis y ss. TRLC).' });
  if (clasificacion.solicitante === 'acreedor') alertas.push({ nivel: 'bloqueo', texto: 'Es una solicitud de concurso necesario (instada por acreedor).' });
  if (clasificacion.persona === 'juridica') alertas.push({ nivel: 'aviso', texto: 'El deudor parece persona jurídica: no cabe exoneración del pasivo insatisfecho.' });
  if (clasificacion.indicio_masa) alertas.push({ nivel: 'aviso', texto: 'El escrito menciona bienes con valor (p. ej. vivienda): revisar si concurre algún supuesto del art. 37 bis TRLC.' });
  if (clasificacion.plan_pagos) alertas.push({ nivel: 'aviso', texto: 'Se menciona un plan de pagos: la exoneración con plan de pagos no es el cauce del concurso sin masa simple.' });
  if (clasificacion.empresario === true) alertas.push({ nivel: 'aviso', texto: 'El deudor parece empresario o profesional: revisar el régimen aplicable.' });

  for (const [k, etiqueta] of [['deudor_nombre', 'nombre del deudor'], ['deudor_nif', 'NIF/NIE del deudor'], ['deudor_domicilio', 'domicilio del deudor'], ['pasivo_declarado', 'pasivo declarado'], ['activo_declarado', 'activo declarado']]) {
    if (!campos[k]) alertas.push({ nivel: 'aviso', texto: `No se ha encontrado el ${etiqueta}: complételo a mano.` });
  }
  if (!acreedores.length) alertas.push({ nivel: 'aviso', texto: 'No se ha encontrado la relación de acreedores en el escrito: complétela a mano.' });
  for (const [k, d] of Object.entries(documentos)) {
    if (!d.presente && k !== 'formulario_anexo_i') alertas.push({ nivel: 'aviso', texto: `No se menciona el documento: ${k.replace(/_/g, ' ')} (art. 7 TRLC).` });
  }
  if (!documentos.formulario_anexo_i.presente) alertas.push({ nivel: 'info', texto: 'No se menciona el formulario del Anexo I de los Acuerdos de los Mercantiles de Barcelona (diciembre de 2023).' });

  const sumaAcreedores = acreedores.reduce((s, a) => s + a.importe, 0);
  if (campos.pasivo_declarado && acreedores.length && sumaAcreedores !== campos.pasivo_declarado.valor) {
    alertas.push({ nivel: 'aviso', texto: `La suma de la relación de acreedores (${(sumaAcreedores / 100).toFixed(2)} €) no coincide con el pasivo declarado (${(campos.pasivo_declarado.valor / 100).toFixed(2)} €).` });
  }
  if (campos.numero_acreedores && acreedores.length !== campos.numero_acreedores.valor) {
    alertas.push({ nivel: 'aviso', texto: `Se declaran ${campos.numero_acreedores.valor} acreedores y se han leído ${acreedores.length}.` });
  }
  for (const a of acreedores) if (a.clase === 'garantia_real') alertas.push({ nivel: 'aviso', texto: `Crédito con garantía real (${a.acreedor}): falta el valor de la garantía.` });

  const lectura = {
    version: LECTOR_VERSION,
    reglas: REGLAS_VERSION,
    fichero: nombre_fichero,
    hash_texto: hash(idx.texto),
    clasificacion,
    campos,
    acreedores,
    suma_acreedores: sumaAcreedores,
    documentos,
    alertas
  };
  lectura.hash_lectura = hash(lectura);
  return deepFreeze(lectura);
}

export { importeACentimos, aCentimos };

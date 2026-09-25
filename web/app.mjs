// Página local: arrastrar la solicitud → leer (sin IA) → revisar → auto de declaración → auto de conclusión.
// Todo ocurre en el navegador. Nada se envía fuera del ordenador.
import * as pdfjs from '/node_modules/pdfjs-dist/build/pdf.mjs';
import { extraerTextoPdf } from '/src/lector/texto-pdf.mjs';
import { leerSolicitud } from '/src/lector/lector.mjs';
import { lecturaAExpedienteDeclaracion, declaracionAExpedienteConclusion, DATOS_JUZGADO_VACIOS } from '/src/lector/a-expediente.mjs';
import { generarAutoDeclaracion, SUPUESTOS_37_BIS } from '/src/declaracion.mjs';
import { generarAutoConclusion } from '/src/motor.mjs';
import { prepararPack } from '/src/bloques.mjs';
import { CLASES_CREDITO } from '/src/validar-expediente.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
const getDocument = (opts) => pdfjs.getDocument({ ...opts, standardFontDataUrl: '/node_modules/pdfjs-dist/standard_fonts/' });

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euros = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const CLAVE_JUZGADO = 'csm.datos_juzgado.v1';

const estado = { lectura: null, expediente: null, conclusion: null, packs: {} };

async function pack(nombre) {
  if (!estado.packs[nombre]) {
    const r = await fetch(`/packs/${nombre}.v1.json`, { cache: 'no-store' });
    estado.packs[nombre] = prepararPack(await r.json());
  }
  return estado.packs[nombre];
}

// ---------- rutas "a.b.c" sobre objetos ----------
const leerRuta = (o, ruta) => ruta.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
function ponerRuta(o, ruta, v) {
  const ks = ruta.split('.'); const ult = ks.pop();
  const destino = ks.reduce((x, k) => (x[k] ??= {}), o);
  destino[ult] = v;
}
function valorDe(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.dataset.tipo === 'numero') {
    const t = String(el.value).trim();
    if (t === '') return null;
    // "1.750,21" (formato español) o "1750.21": si hay coma, los puntos son de miles
    return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  }
  if (el.dataset.tipo === 'entero') return el.value === '' ? null : parseInt(el.value, 10);
  if (el.dataset.tipo === 'sino') return el.value === '' ? null : el.value === 'si';
  return el.value;
}

function campo({ etiqueta, ruta, raiz = 'expediente', tipo = 'texto', opciones = null, fuente = null }) {
  const obj = estado[raiz];
  const v = leerRuta(obj, ruta);
  const attrs = `data-raiz="${raiz}" data-ruta="${ruta}"`;
  let control;
  if (tipo === 'check') return `<label class="campo check"><input type="checkbox" ${attrs} ${v ? 'checked' : ''}><span>${esc(etiqueta)}</span></label>`;
  if (opciones) control = `<select ${attrs} ${tipo !== 'texto' ? `data-tipo="${tipo}"` : ''}>${opciones.map(([val, txt]) => `<option value="${esc(val)}" ${String(v ?? '') === String(val) || (tipo === 'sino' && ((v === true && val === 'si') || (v === false && val === 'no'))) ? 'selected' : ''}>${esc(txt)}</option>`).join('')}</select>`;
  else control = `<input ${attrs} ${tipo === 'fecha' ? 'type="date"' : 'type="text"'} ${tipo === 'numero' || tipo === 'entero' ? `data-tipo="${tipo}" inputmode="decimal"` : ''} value="${esc(v ?? '')}">`;
  // fuente: objeto de la lectura → cita la línea; null → "no leído"; false → sin indicación
  const f = fuente === false ? '' : fuente
    ? `<span class="fuente" title="${esc(fuente.fuente?.texto || '')}">Leído en p. ${fuente.fuente?.pagina}, l. ${fuente.fuente?.linea} · ${esc(fuente.regla)}</span>`
    : '<span class="fuente manual">No leído: complételo</span>';
  return `<label class="campo"><span>${esc(etiqueta)}</span>${control}${f}</label>`;
}

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.dataset?.ruta) return;
  ponerRuta(estado[el.dataset.raiz], el.dataset.ruta, valorDe(el));
  if (el.dataset.raiz === 'expediente' && el.dataset.ruta.startsWith('creditos.')) pintarSuma();
  if (el.dataset.raiz === 'expediente' && ['organo', 'procedimiento', 'juez'].some((k) => el.dataset.ruta.startsWith(k))) guardarJuzgado();
});
document.addEventListener('change', (ev) => { if (ev.target.dataset?.ruta) ev.target.dispatchEvent(new Event('input', { bubbles: true })); });

// ---------- 1. Arrastrar y leer ----------
const zona = $('zona');
['dragenter', 'dragover'].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add('encima'); }));
['dragleave', 'drop'].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.remove('encima'); }));
zona.addEventListener('drop', (e) => { const f = e.dataTransfer.files?.[0]; if (f) leer(f); });
zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fichero').click(); } });
$('fichero').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) leer(f); });

async function leer(fichero) {
  $('resumen').innerHTML = '<p class="nota">Leyendo…</p>';
  try {
    if (!/\.pdf$/i.test(fichero.name) && fichero.type !== 'application/pdf') throw new Error('El fichero no es un PDF.');
    const texto = await extraerTextoPdf(new Uint8Array(await fichero.arrayBuffer()), getDocument);
    const lectura = leerSolicitud(texto, { nombre_fichero: fichero.name });
    estado.lectura = lectura;
    estado.expediente = lecturaAExpedienteDeclaracion(lectura, cargarJuzgado());
    estado.conclusion = null;
    pintarTodo();
  } catch (err) {
    $('resumen').innerHTML = `<ul class="alertas"><li class="bloqueo">No se ha podido leer el PDF: ${esc(err.message)}</li></ul>`;
  }
}

function pintarResumen() {
  const l = estado.lectura; const c = l.clasificacion;
  const tipoTxt = { concurso_sin_masa: 'Concurso sin masa', concurso_ordinario: 'Concurso ordinario (no sin masa)', microempresas: 'Procedimiento de microempresas' }[c.tipo] || c.tipo;
  const chip = (t, clase = '') => `<span class="chip ${clase}">${esc(t)}</span>`;
  $('resumen').innerHTML = `
    <div class="chips">
      ${chip(tipoTxt, c.tipo === 'concurso_sin_masa' ? 'ok' : 'mal')}
      ${chip(c.solicitante === 'acreedor' ? 'Necesario (acreedor)' : 'Voluntario (deudor)', c.solicitante === 'acreedor' ? 'mal' : '')}
      ${chip(c.persona === 'juridica' ? 'Persona jurídica' : 'Persona física')}
      ${c.insolvencia ? chip(`Insolvencia ${c.insolvencia}`) : chip('Insolvencia: no consta', 'mal')}
      ${chip(c.pide_epi ? 'Pide exoneración (EPI)' : 'No menciona la EPI')}
      ${c.plan_pagos ? chip('Plan de pagos', 'mal') : ''}
      ${c.formulario_icab ? chip('Formulario Anexo I (ICAB)', 'ok') : ''}
      ${chip(`${l.acreedores.length} acreedores leídos`)}
    </div>
    <ul class="alertas">${l.alertas.map((a) => `<li class="${a.nivel}">${esc(a.texto)}</li>`).join('')}</ul>
    <p class="hash">${esc(l.fichero)} · lector ${esc(l.version)} · reglas ${esc(l.reglas)} · hash ${esc(l.hash_lectura.slice(0, 16))}</p>`;
}

// ---------- 2. Revisión ----------
function pintarCampos() {
  const c = estado.lectura.campos;
  $('campos').innerHTML = `<div class="rejilla">
    ${campo({ etiqueta: 'Deudor', ruta: 'deudor.nombre', fuente: c.deudor_nombre || null })}
    ${campo({ etiqueta: 'NIF / NIE', ruta: 'deudor.nif', fuente: c.deudor_nif || null })}
    ${campo({ etiqueta: 'Domicilio', ruta: 'deudor.domicilio', fuente: c.deudor_domicilio || null })}
    ${campo({ etiqueta: 'Tipo de deudor', ruta: 'deudor.tipo', opciones: [['persona_natural', 'Persona física'], ['persona_juridica', 'Persona jurídica']], fuente: false })}
    ${campo({ etiqueta: 'Procurador/a', ruta: 'representacion.procurador', fuente: c.procurador || null })}
    ${campo({ etiqueta: 'Abogado/a', ruta: 'representacion.abogado', fuente: c.abogado || null })}
    ${campo({ etiqueta: 'Fecha de la solicitud', ruta: 'solicitud.fecha', tipo: 'fecha', fuente: c.fecha_escrito || null })}
    ${campo({ etiqueta: 'Insolvencia', ruta: 'solicitud.insolvencia', opciones: [['', '—'], ['actual', 'Actual'], ['inminente', 'Inminente']], fuente: false })}
    ${campo({ etiqueta: 'Pasivo declarado (€)', ruta: 'solicitud.pasivo_declarado', tipo: 'numero', fuente: c.pasivo_declarado || null })}
    ${campo({ etiqueta: 'Activo declarado (€)', ruta: 'solicitud.activo_declarado', tipo: 'numero', fuente: c.activo_declarado || null })}
    ${campo({ etiqueta: 'Pide exoneración (EPI)', ruta: 'solicitud.pide_epi', tipo: 'check' })}
    ${campo({ etiqueta: 'Pide plan de pagos', ruta: 'solicitud.plan_pagos', tipo: 'check' })}
  </div>
  <h3>Documentos del art. 7 TRLC que se dicen acompañar</h3>
  <div class="rejilla">
    ${campo({ etiqueta: 'Poder', ruta: 'solicitud.documentos.poder', tipo: 'check' })}
    ${campo({ etiqueta: 'Memoria', ruta: 'solicitud.documentos.memoria', tipo: 'check' })}
    ${campo({ etiqueta: 'Inventario', ruta: 'solicitud.documentos.inventario', tipo: 'check' })}
    ${campo({ etiqueta: 'Relación de acreedores', ruta: 'solicitud.documentos.relacion_acreedores', tipo: 'check' })}
    ${campo({ etiqueta: 'Formulario Anexo I', ruta: 'solicitud.documentos.formulario_anexo_i', tipo: 'check' })}
  </div>`;
}

function pintarAcreedores() {
  const filas = estado.expediente.creditos;
  const lectura = new Map(estado.lectura.acreedores.map((a) => [a.id, a]));
  const opc = CLASES_CREDITO.map((c) => `<option value="${c}">${c.replace(/_/g, ' ')}</option>`).join('');
  $('acreedores').innerHTML = `<div class="tabla-scroll"><table>
    <thead><tr><th>Id</th><th>Acreedor</th><th>NIF</th><th>Concepto</th><th>Clase</th><th>Importe (€)</th><th>Valor garantía (€)</th><th></th></tr></thead>
    <tbody>${filas.map((f, i) => {
      const src = lectura.get(f.id)?.fuente;
      return `<tr title="${esc(src ? `p. ${src.pagina}, l. ${src.linea}: ${src.texto}` : 'Añadido a mano')}">
        <td>${esc(f.id)}</td>
        <td><input data-raiz="expediente" data-ruta="creditos.${i}.acreedor" value="${esc(f.acreedor)}"></td>
        <td><input data-raiz="expediente" data-ruta="creditos.${i}.nif" value="${esc(f.nif ?? '')}"></td>
        <td><input data-raiz="expediente" data-ruta="creditos.${i}.concepto" value="${esc(f.concepto)}"></td>
        <td><select data-raiz="expediente" data-ruta="creditos.${i}.clase">${opc.replace(`value="${f.clase}"`, `value="${f.clase}" selected`)}</select></td>
        <td class="num-col"><input data-raiz="expediente" data-ruta="creditos.${i}.importe" data-tipo="numero" value="${esc(f.importe ?? '')}"></td>
        <td class="num-col"><input data-raiz="expediente" data-ruta="creditos.${i}.valor_garantia" data-tipo="numero" value="${esc(f.valor_garantia ?? '')}" ${f.clase === 'garantia_real' ? '' : 'placeholder="—"'}></td>
        <td><button class="enlace" data-quitar="${i}" aria-label="Quitar ${esc(f.acreedor)}">Quitar</button></td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="acciones"><button id="anadir-acreedor">Añadir acreedor</button></div>
    <p class="suma" id="suma"></p>`;
  $('anadir-acreedor').onclick = () => {
    const n = estado.expediente.creditos.length + 1;
    let id = `C${n}`; while (estado.expediente.creditos.some((c) => c.id === id)) id += 'b';
    estado.expediente.creditos.push({ id, acreedor: '', nif: '', concepto: '', importe: null, clase: 'ordinario' });
    pintarAcreedores();
  };
  document.querySelectorAll('[data-quitar]').forEach((b) => { b.onclick = () => { estado.expediente.creditos.splice(Number(b.dataset.quitar), 1); pintarAcreedores(); }; });
  pintarSuma();
}

function pintarSuma() {
  const suma = estado.expediente.creditos.reduce((s, c) => s + Math.round((Number(c.importe) || 0) * 100), 0) / 100;
  const decl = estado.expediente.solicitud.pasivo_declarado;
  const el = $('suma');
  const cuadra = decl == null || Math.round(decl * 100) === Math.round(suma * 100);
  el.className = `suma ${cuadra ? '' : 'mal'}`;
  el.textContent = `Suma de la relación: ${euros(suma)}${decl != null ? ` · pasivo declarado: ${euros(decl)}${cuadra ? ' · cuadra' : ' · NO CUADRA'}` : ''}`;
}

// ---------- 3. Juzgado (se recuerda en este navegador) ----------
function cargarJuzgado() {
  try { const g = JSON.parse(localStorage.getItem(CLAVE_JUZGADO) || 'null'); if (g) return { ...structuredClone(DATOS_JUZGADO_VACIOS), ...g, procedimiento: { numero: '', nig: '' }, fecha_resolucion: '', numero_resolucion: '' }; } catch {}
  return structuredClone(DATOS_JUZGADO_VACIOS);
}
function guardarJuzgado() {
  try { const e = estado.expediente; localStorage.setItem(CLAVE_JUZGADO, JSON.stringify({ organo: e.organo, juez: e.juez })); } catch {}
}
function pintarJuzgado() {
  $('juzgado').innerHTML = [
    campo({ etiqueta: 'Tribunal', ruta: 'organo.tribunal', fuente: false }),
    campo({ etiqueta: 'Sección', ruta: 'organo.seccion', fuente: false }),
    campo({ etiqueta: 'Plaza n.º', ruta: 'organo.plaza', tipo: 'entero', fuente: false }),
    campo({ etiqueta: 'Denominación histórica (opcional)', ruta: 'organo.denominacion_historica', fuente: false }),
    campo({ etiqueta: 'Localidad', ruta: 'organo.localidad', fuente: false }),
    campo({ etiqueta: 'N.º de procedimiento', ruta: 'procedimiento.numero', fuente: false }),
    campo({ etiqueta: 'NIG', ruta: 'procedimiento.nig', fuente: false }),
    campo({ etiqueta: 'Juez/a', ruta: 'juez.nombre', fuente: false }),
    campo({ etiqueta: 'Cargo', ruta: 'juez.cargo', opciones: [['Magistrado', 'Magistrado'], ['Magistrada', 'Magistrada'], ['Juez', 'Juez'], ['Jueza', 'Jueza']], fuente: false }),
    campo({ etiqueta: 'Fecha del auto', ruta: 'fecha_resolucion', tipo: 'fecha', fuente: false }),
    campo({ etiqueta: 'N.º de resolución (opcional)', ruta: 'numero_resolucion', fuente: false })
  ].join('');
}

// ---------- 4. Decisión y auto de declaración ----------
function pintarDecision() {
  const d = estado.expediente.decision_judicial;
  d.sentido ??= 'declarar_sin_masa';
  $('decision').innerHTML = [
    campo({ etiqueta: 'Soy competente (territorial y objetivamente)', ruta: 'decision_judicial.competencia_verificada', tipo: 'check' }),
    campo({ etiqueta: 'Aprecio la insolvencia alegada', ruta: 'decision_judicial.insolvencia_apreciada', tipo: 'check' }),
    campo({ etiqueta: 'Supuesto del art. 37 bis.1 TRLC', ruta: 'decision_judicial.supuesto_37_bis', tipo: 'entero', opciones: [['', '— elija —'], ...Object.entries(SUPUESTOS_37_BIS).map(([k, t]) => [k, `${k}.º ${t}`])], fuente: false })
  ].join('');
}

function descargar(nombre, contenido, tipo) {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nombre });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function pintarResultado(destino, r, base, expediente) {
  const titulos = { borrador: 'Borrador generado', borrador_no_ratificado: 'Borrador generado (bloques sin ratificar)', pendiente_decision: 'Falta la decisión del juez', pendiente_tramite: 'El procedimiento no está en fase', fuera_de_alcance: 'Fuera del alcance de la plantilla', expediente_invalido: 'Faltan datos o son incoherentes', bloqueado_por_calidad: 'Bloqueado por los controles de calidad', error_redaccion: 'Error de redacción' };
  const lista = [...(r.errores || []), ...(r.motivos || []), ...(r.controles?.fallos || [])];
  const nivel = r.texto ? 'info' : 'bloqueo';
  $(destino).innerHTML = `<div class="resultado">
    <h3>${esc(titulos[r.estado] || r.estado)}</h3>
    ${lista.length ? `<ul class="alertas">${lista.map((m) => `<li class="${nivel === 'info' ? 'aviso' : 'bloqueo'}">${esc(m)}</li>`).join('')}</ul>` : ''}
    ${r.controles?.avisos?.length ? `<ul class="alertas">${r.controles.avisos.map((m) => `<li class="aviso">${esc(m)}</li>`).join('')}</ul>` : ''}
    ${r.texto ? `<div class="texto-auto">${esc(r.texto)}</div>
      <p class="hash">hash IR ${esc(r.ir.hash_ir.slice(0, 16))} · bloques ${esc(r.ir.procedencia.pack_id)} v${esc(r.ir.procedencia.pack_version)}</p>
      <div class="acciones">
        <button data-d="txt">Descargar .txt</button><button data-d="docx">Descargar Word</button><button data-d="json">Descargar expediente (.json)</button>
      </div>` : `<div class="acciones"><button data-d="json">Descargar expediente (.json)</button></div>`}
  </div>`;
  $(destino).querySelectorAll('[data-d]').forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.d === 'txt') descargar(`${base}.txt`, r.texto, 'text/plain;charset=utf-8');
      if (b.dataset.d === 'json') descargar(`${base}.expediente.json`, JSON.stringify(expediente, null, 2), 'application/json');
      if (b.dataset.d === 'docx') {
        try { const { aDocxBlob } = await import('/src/docx.mjs'); descargar(`${base}.docx`, await aDocxBlob(r.documento)); }
        catch (e) { alertaEn(destino, `No se ha podido generar el Word en el navegador: ${e.message}. Use el .txt o el CLI.`); }
      }
    };
  });
}

function alertaEn(destino, texto) { $(destino).insertAdjacentHTML('beforeend', `<ul class="alertas"><li class="bloqueo">${esc(texto)}</li></ul>`); }

$('generar-declaracion').onclick = async () => {
  const exp = structuredClone(estado.expediente);
  const r = generarAutoDeclaracion(exp, { pack: await pack('declaracion-sin-masa') });
  pintarResultado('resultado-declaracion', r, `auto-declaracion-${(exp.procedimiento.numero || 'sin-numero').replace(/\W+/g, '-')}`, exp);
  if (r.texto) { prepararConclusion(); $('paso-5').classList.remove('oculto'); }
};

// ---------- 5. Conclusión ----------
function prepararConclusion() {
  const e = estado.expediente;
  estado.conclusion = declaracionAExpedienteConclusion(e, { fecha_declaracion: e.fecha_resolucion, solicitud_epi_fecha: e.solicitud.pide_epi && e.deudor.tipo === 'persona_natural' ? '' : null });
  if (estado.conclusion.tramite.solicitud_epi === null && e.solicitud.pide_epi) estado.conclusion.tramite.solicitud_epi = { fecha: '' };
  const conEpi = estado.conclusion.tramite.solicitud_epi != null;
  if (conEpi) { estado.conclusion.tramite.traslado_acreedores ??= null; estado.conclusion.tramite.oposiciones ??= []; }
  estado.conclusion.decision_judicial = { sentido: conEpi ? 'conceder_epi' : 'concluir_sin_epi', buena_fe_verificada: false, excepciones_art_487: [] };
  const sino = [['', '— confirme —'], ['no', 'No'], ['si', 'Sí']];
  $('conclusion').innerHTML = [
    campo({ raiz: 'conclusion', etiqueta: 'Fecha del auto de declaración', ruta: 'tramite.auto_declaracion_sin_masa.fecha', tipo: 'fecha', fuente: false }),
    campo({ raiz: 'conclusion', etiqueta: '¿Algún acreedor pidió administración concursal?', ruta: 'tramite.solicitud_nombramiento_ac', tipo: 'sino', opciones: sino, fuente: false }),
    campo({ raiz: 'conclusion', etiqueta: '¿Auto complementario del art. 37 quinquies?', ruta: 'tramite.auto_complementario_37_quinquies', tipo: 'sino', opciones: sino, fuente: false }),
    ...(conEpi ? [
      campo({ raiz: 'conclusion', etiqueta: 'Fecha de la solicitud de EPI', ruta: 'tramite.solicitud_epi.fecha', tipo: 'fecha', fuente: false }),
      campo({ raiz: 'conclusion', etiqueta: '¿Traslado a los acreedores hecho?', ruta: 'tramite.traslado_acreedores', tipo: 'sino', opciones: sino, fuente: false }),
      campo({ raiz: 'conclusion', etiqueta: 'Confirmo la buena fe del deudor (art. 487 TRLC)', ruta: 'decision_judicial.buena_fe_verificada', tipo: 'check' })
    ] : []),
    campo({ raiz: 'conclusion', etiqueta: 'Fecha del auto de conclusión', ruta: 'fecha_resolucion', tipo: 'fecha', fuente: false }),
    campo({ raiz: 'conclusion', etiqueta: 'N.º de resolución (opcional)', ruta: 'numero_resolucion', fuente: false })
  ].join('') + (conEpi ? '<p class="nota">Si hubo oposiciones a la exoneración, el motor no genera el auto: hay que resolver el incidente.</p>' : '');
}

$('generar-conclusion').onclick = async () => {
  const exp = structuredClone(estado.conclusion);
  const r = generarAutoConclusion(exp, { pack: await pack('concurso-sin-masa') });
  pintarResultado('resultado-conclusion', r, `auto-conclusion-${(exp.procedimiento.numero || 'sin-numero').replace(/\W+/g, '-')}`, exp);
};

function pintarTodo() {
  pintarResumen(); pintarCampos(); pintarAcreedores(); pintarJuzgado(); pintarDecision();
  ['paso-2', 'paso-3', 'paso-4'].forEach((id) => $(id).classList.remove('oculto'));
  $('paso-5').classList.add('oculto');
  $('resultado-declaracion').innerHTML = ''; $('resultado-conclusion').innerHTML = '';
}

// Aplicación local de tramitación del concurso sin masa.
// Dashboard → procedimiento persistente en navegador → workspace → resolución.
// El PDF se procesa localmente; la persistencia guarda la lectura estructurada, no sube datos a ningún servidor.
import * as pdfjs from '/node_modules/pdfjs-dist/build/pdf.mjs';
import { extraerTextoPdf } from '/src/lector/texto-pdf.mjs';
import { leerSolicitud } from '/src/lector/lector.mjs';
import { lecturaAExpedienteDeclaracion, declaracionAExpedienteConclusion, DATOS_JUZGADO_VACIOS } from '/src/lector/a-expediente.mjs';
import { generarAutoDeclaracion } from '/src/declaracion.mjs';
import { generarAutoConclusion } from '/src/motor.mjs';
import { loadKnowledgeRuntimeFromUrl } from '/src/core/knowledge/browser-loader.mjs';
import { creditClassIds } from '/src/core/knowledge/credit-engine.mjs';
import { listProcedimientos, getProcedimiento, putProcedimiento, deleteProcedimiento, findBySourceHash } from '/web/case-store.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
const getDocument = (opts) => pdfjs.getDocument({ ...opts, standardFontDataUrl: '/node_modules/pdfjs-dist/standard_fonts/' });

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euros = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const CLAVE_JUZGADO = 'csm.datos_juzgado.v1';
const SAVE_DELAY = 350;
const knowledge = await loadKnowledgeRuntimeFromUrl('/knowledge/runtime/concursal/concurso-sin-masa-1.0.0.json');

const estado = {
  lectura: null,
  expediente: null,
  conclusion: null,
  resultadoDeclaracion: null,
  resultadoConclusion: null,
  currentCase: null,
  cases: [],
  knowledge,
  activeTab: 'resumen',
  appView: 'dashboard',
  saveTimer: null
};

const plain = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const ahora = () => new Date().toISOString();
const fmtDate = (value) => {
  const d = new Date(value || '');
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
};
const fmtDateTime = (value) => {
  const d = new Date(value || '');
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
};

function pack(nombre) {
  return estado.knowledge.redactionPack(nombre === 'declaracion-sin-masa' ? 'declaracion' : 'conclusion');
}

// ---------- dominio UI del procedimiento ----------
const STATUS = Object.freeze({
  bloqueado: { label: 'Bloqueado', tone: 'blocked' },
  pendiente_decision: { label: 'Necesita decisión', tone: 'attention' },
  listo_auto: { label: 'Listo para auto', tone: 'ready' },
  auto_generado: { label: 'Auto generado', tone: 'generated' },
  concluido: { label: 'Conclusión generada', tone: 'done' }
});

function estadoProcedimiento(caso) {
  const l = caso?.lectura;
  const e = caso?.expediente;
  if (!l || !e) return 'bloqueado';
  if (caso.resultadoConclusion?.texto) return 'concluido';
  if (caso.resultadoDeclaracion?.texto) return 'auto_generado';
  if ((l.alertas || []).some((a) => a.nivel === 'bloqueo')) return 'bloqueado';
  if (!e.deudor?.nombre || !e.deudor?.nif || !e.deudor?.domicilio || !e.creditos?.length) return 'pendiente_decision';
  const d = e.decision_judicial || {};
  const supuestos = estado.knowledge.getCatalog('supuesto_37_bis') || {};
  if (d.competencia_verificada === true && d.insolvencia_apreciada === true && supuestos[String(d.supuesto_37_bis)]) return 'listo_auto';
  return 'pendiente_decision';
}

function casoTitulo(caso) {
  const numero = caso?.expediente?.procedimiento?.numero;
  const deudor = caso?.expediente?.deudor?.nombre;
  return numero || deudor || 'Procedimiento sin identificar';
}

function casoSubtitulo(caso) {
  const e = caso?.expediente || {};
  return [e.deudor?.nombre && e.procedimiento?.numero ? e.deudor.nombre : null, e.deudor?.nif, caso?.source?.name].filter(Boolean).join(' · ');
}

function crearId(lectura) {
  const stamp = Date.now().toString(36).toUpperCase();
  return `CSM-${stamp}-${String(lectura?.hash_texto || 'LOCAL').slice(0, 6).toUpperCase()}`;
}

function documentosPresentes(caso) {
  return Object.values(caso?.expediente?.solicitud?.documentos || {}).filter(Boolean).length;
}

function alertasCaso(caso) {
  return (caso?.lectura?.alertas || []).filter((a) => a.nivel === 'aviso' || a.nivel === 'bloqueo');
}

function siguienteActuacion(caso) {
  const st = estadoProcedimiento(caso);
  if (st === 'concluido') return { label: 'Revisar conclusión', tab: 'resolucion' };
  if (st === 'auto_generado') return { label: 'Revisar auto', tab: 'resolucion' };
  if (st === 'listo_auto') return { label: 'Generar auto', tab: 'resolucion' };
  if (st === 'bloqueado') return { label: 'Revisar solicitud', tab: 'solicitud' };
  return { label: 'Completar decisión', tab: 'resolucion' };
}

// ---------- persistencia del caso ----------
function actividad(tipo, titulo, detalle = '') {
  return { id: `${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, tipo, titulo, detalle, at: ahora() };
}

function snapshotCaso() {
  if (!estado.currentCase) return null;
  const updatedAt = ahora();
  return {
    ...plain(estado.currentCase),
    updatedAt,
    lectura: plain(estado.lectura),
    expediente: plain(estado.expediente),
    conclusion: plain(estado.conclusion),
    resultadoDeclaracion: plain(estado.resultadoDeclaracion),
    resultadoConclusion: plain(estado.resultadoConclusion)
  };
}

async function guardarCasoAhora({ evento = null } = {}) {
  if (!estado.currentCase) return;
  if (evento) {
    estado.currentCase.activity = [...(estado.currentCase.activity || []), evento];
  }
  const record = snapshotCaso();
  estado.currentCase = await putProcedimiento(record);
}

function programarGuardado() {
  if (!estado.currentCase) return;
  clearTimeout(estado.saveTimer);
  estado.saveTimer = setTimeout(() => guardarCasoAhora().catch(() => {}), SAVE_DELAY);
}

function invalidarResultados(raiz = 'expediente') {
  if (raiz === 'expediente' && estado.resultadoDeclaracion) {
    estado.resultadoDeclaracion = null;
    estado.resultadoConclusion = null;
    estado.conclusion = null;
    if ($('resultado-declaracion')) $('resultado-declaracion').innerHTML = '';
    if ($('resultado-conclusion')) $('resultado-conclusion').innerHTML = '';
    if ($('paso-5')) $('paso-5').classList.add('oculto');
  } else if (raiz === 'conclusion' && estado.resultadoConclusion) {
    estado.resultadoConclusion = null;
    if ($('resultado-conclusion')) $('resultado-conclusion').innerHTML = '';
  }
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
  const f = fuente === false ? '' : fuente
    ? `<span class="fuente" title="${esc(fuente.fuente?.texto || '')}">Leído en p. ${fuente.fuente?.pagina}, l. ${fuente.fuente?.linea} · ${esc(fuente.regla)}</span>`
    : '<span class="fuente manual">No leído: complételo</span>';
  return `<label class="campo"><span>${esc(etiqueta)}</span>${control}${f}</label>`;
}

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.dataset?.ruta) return;
  const root = estado[el.dataset.raiz];
  if (!root) return;
  ponerRuta(root, el.dataset.ruta, valorDe(el));
  if (el.dataset.raiz === 'expediente' && el.dataset.ruta.startsWith('creditos.')) pintarSuma();
  if (el.dataset.raiz === 'expediente' && ['organo', 'procedimiento', 'juez'].some((k) => el.dataset.ruta.startsWith(k))) guardarJuzgado();
  invalidarResultados(el.dataset.raiz);
  programarGuardado();
});

document.addEventListener('change', (ev) => {
  if (!ev.target.dataset?.ruta) return;
  ev.target.dispatchEvent(new Event('input', { bubbles: true }));
  pintarCaseHeader();
  pintarOverview();
});

// ---------- navegación ----------
function setAppView(view) {
  estado.appView = view;
  ['dashboard', 'procedimientos', 'workspace'].forEach((id) => {
    $('view-' + id)?.classList.toggle('oculto', id !== view);
  });
  document.querySelectorAll('[data-app-view]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.appView === view || (view === 'workspace' && b.dataset.appView === 'procedimientos'));
  });
  if (view === 'dashboard') {
    $('topbar-title').textContent = 'Bandeja concursal';
    $('topbar-subtitle').textContent = 'Procedimientos guardados únicamente en este navegador';
  } else if (view === 'procedimientos') {
    $('topbar-title').textContent = 'Procedimientos';
    $('topbar-subtitle').textContent = 'Expedientes locales y estado de tramitación';
  } else if (view === 'workspace') {
    $('topbar-title').textContent = casoTitulo(estado.currentCase);
    $('topbar-subtitle').textContent = 'Expediente concursal · entorno local de tramitación';
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function mostrarTab(tab) {
  estado.activeTab = tab;
  document.querySelectorAll('[data-case-tab]').forEach((b) => b.classList.toggle('active', b.dataset.caseTab === tab));
  document.querySelectorAll('.case-tab').forEach((el) => el.classList.toggle('oculto', el.id !== `case-tab-${tab}`));
  $('view-workspace')?.querySelector('.case-workspace-content')?.classList.toggle('resolution-mode', tab === 'resolucion');
}

document.addEventListener('click', async (ev) => {
  const viewBtn = ev.target.closest('[data-app-view]');
  if (viewBtn) {
    ev.preventDefault();
    if (estado.appView === 'workspace') await guardarCasoAhora().catch(() => {});
    setAppView(viewBtn.dataset.appView);
    if (viewBtn.dataset.appView !== 'workspace') await cargarCasos();
    return;
  }
  const uploadBtn = ev.target.closest('[data-trigger-upload], #nuevo-procedimiento');
  if (uploadBtn) {
    ev.preventDefault();
    if (estado.appView === 'workspace') await guardarCasoAhora().catch(() => {});
    setAppView('dashboard');
    $('fichero').click();
    return;
  }

  const openBtn = ev.target.closest('[data-open-case]');
  if (openBtn) { ev.preventDefault(); await abrirCaso(openBtn.dataset.openCase); return; }

  const deleteBtn = ev.target.closest('[data-delete-case]');
  if (deleteBtn) {
    ev.preventDefault(); ev.stopPropagation();
    const caso = estado.cases.find((x) => x.id === deleteBtn.dataset.deleteCase);
    if (confirm(`Eliminar del navegador “${casoTitulo(caso)}”? Esta acción no afecta al PDF original.`)) {
      await deleteProcedimiento(deleteBtn.dataset.deleteCase);
      if (estado.currentCase?.id === deleteBtn.dataset.deleteCase) {
        estado.currentCase = null; estado.lectura = null; estado.expediente = null;
        setAppView('procedimientos');
      }
      await cargarCasos();
    }
    return;
  }

  const tabBtn = ev.target.closest('[data-case-tab], [data-open-tab]');
  if (tabBtn && estado.currentCase) {
    mostrarTab(tabBtn.dataset.caseTab || tabBtn.dataset.openTab);
    return;
  }

  const back = ev.target.closest('[data-close-case]');
  if (back) {
    await guardarCasoAhora().catch(() => {});
    await cargarCasos();
    setAppView('procedimientos');
  }
});

// ---------- lectura de nueva solicitud ----------
const zona = $('zona');
['dragenter', 'dragover'].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add('encima'); }));
['dragleave', 'drop'].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.remove('encima'); }));
zona.addEventListener('drop', (e) => { const f = e.dataTransfer.files?.[0]; if (f) leerNuevaSolicitud(f); });
zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fichero').click(); } });
$('fichero').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) leerNuevaSolicitud(f);
  e.target.value = '';
});

async function leerNuevaSolicitud(fichero) {
  const status = $('upload-status');
  status.innerHTML = '<p class="nota loading-note">Leyendo y estructurando la solicitud…</p>';
  try {
    if (!/\.pdf$/i.test(fichero.name) && fichero.type !== 'application/pdf') throw new Error('El fichero no es un PDF.');
    const texto = await extraerTextoPdf(new Uint8Array(await fichero.arrayBuffer()), getDocument);
    const lectura = leerSolicitud(texto, { nombre_fichero: fichero.name });

    const duplicado = await findBySourceHash(lectura.hash_texto);
    if (duplicado && confirm('Esta solicitud ya figura en el panel. ¿Abrir el procedimiento existente?')) {
      status.innerHTML = '';
      await abrirCaso(duplicado.id);
      return;
    }

    const expediente = lecturaAExpedienteDeclaracion(lectura, cargarJuzgado());
    const createdAt = ahora();
    const record = {
      id: crearId(lectura),
      createdAt,
      updatedAt: createdAt,
      source: { name: fichero.name, size: fichero.size, lastModified: fichero.lastModified, hash: lectura.hash_texto },
      lectura: plain(lectura),
      expediente: plain(expediente),
      conclusion: null,
      resultadoDeclaracion: null,
      resultadoConclusion: null,
      activity: [actividad('upload', 'Solicitud incorporada', `${fichero.name} · lectura determinista completada`)]
    };
    await putProcedimiento(record);
    status.innerHTML = '';
    await cargarCasos();
    await abrirCaso(record.id);
  } catch (err) {
    status.innerHTML = `<ul class="alertas"><li class="bloqueo">No se ha podido leer el PDF: ${esc(err.message)}</li></ul>`;
  }
}

// ---------- dashboard y listado ----------
async function cargarCasos() {
  estado.cases = await listProcedimientos();
  pintarDashboard();
  pintarProcedimientos();
  const counter = $('nav-case-count');
  if (counter) {
    counter.textContent = estado.cases.length;
    counter.classList.toggle('oculto', !estado.cases.length);
  }
}

function metricas() {
  const counts = { total: estado.cases.length, pending: 0, ready: 0, generated: 0, blocked: 0 };
  for (const caso of estado.cases) {
    const st = estadoProcedimiento(caso);
    if (st === 'pendiente_decision') counts.pending += 1;
    if (st === 'listo_auto') counts.ready += 1;
    if (st === 'auto_generado' || st === 'concluido') counts.generated += 1;
    if (st === 'bloqueado') counts.blocked += 1;
  }
  return counts;
}

function caseRow(caso) {
  const st = estadoProcedimiento(caso);
  const meta = STATUS[st] || STATUS.pendiente_decision;
  const e = caso.expediente || {};
  const updated = fmtDate(caso.updatedAt);
  return `<article class="case-row">
    <button class="case-row-main" data-open-case="${esc(caso.id)}">
      <span class="case-status-icon tone-${meta.tone}">${meta.tone === 'ready' ? '✓' : meta.tone === 'blocked' ? '!' : meta.tone === 'generated' || meta.tone === 'done' ? 'A' : '·'}</span>
      <span class="case-row-body">
        <span class="case-row-titleline"><strong>${esc(casoTitulo(caso))}</strong><span class="case-status-chip tone-${meta.tone}">${esc(meta.label)}</span></span>
        <span class="case-row-subtitle">${esc(casoSubtitulo(caso))}</span>
        <span class="case-row-meta"><span>${esc(e.solicitud?.insolvencia ? 'Insolvencia ' + e.solicitud.insolvencia : 'Insolvencia pendiente')}</span><span>${e.creditos?.length || 0} acreedores</span><span>Actualizado ${updated}</span></span>
      </span>
      <span class="case-row-amount"><small>Pasivo</small><b>${euros(e.solicitud?.pasivo_declarado)}</b></span>
      <span class="case-row-action">Abrir →</span>
    </button>
    <button class="case-row-delete" data-delete-case="${esc(caso.id)}" title="Eliminar procedimiento">×</button>
  </article>`;
}

function emptyList(texto) {
  return `<div class="judicial-empty-state"><span class="empty-glyph">◇</span><strong>Sin procedimientos</strong><span>${esc(texto)}</span></div>`;
}

function pintarDashboard() {
  const m = metricas();
  $('metric-total').textContent = m.total;
  $('metric-pending').textContent = m.pending;
  $('metric-ready').textContent = m.ready;
  $('metric-generated').textContent = m.generated;

  const recent = estado.cases.slice(0, 6);
  $('dashboard-recent').innerHTML = recent.length ? recent.map(caseRow).join('') : emptyList('Sube la primera solicitud para crear tu bandeja concursal.');

  const attention = estado.cases.filter((c) => ['bloqueado', 'pendiente_decision', 'listo_auto'].includes(estadoProcedimiento(c))).slice(0, 5);
  $('dashboard-attention').innerHTML = attention.length ? attention.map((caso) => {
    const st = estadoProcedimiento(caso); const meta = STATUS[st];
    return `<button class="attention-case" data-open-case="${esc(caso.id)}"><span class="attention-dot tone-${meta.tone}"></span><span><b>${esc(casoTitulo(caso))}</b><small>${esc(meta.label)} · ${euros(caso.expediente?.solicitud?.pasivo_declarado)}</small></span><span>→</span></button>`;
  }).join('') : '<div class="judicial-mini-empty">✓ No hay asuntos que requieran atención inmediata.</div>';
}

function pintarProcedimientos() {
  const q = String($('case-search')?.value || '').trim().toLowerCase();
  const filter = $('case-filter')?.value || 'todos';
  const rows = estado.cases.filter((caso) => {
    const searchable = [casoTitulo(caso), casoSubtitulo(caso), caso.expediente?.deudor?.nombre, caso.expediente?.deudor?.nif].filter(Boolean).join(' ').toLowerCase();
    const statusOk = filter === 'todos' || estadoProcedimiento(caso) === filter;
    return statusOk && (!q || searchable.includes(q));
  });
  $('procedure-list').innerHTML = rows.length ? rows.map(caseRow).join('') : emptyList(q || filter !== 'todos' ? 'No hay resultados con estos filtros.' : 'Todavía no hay procedimientos registrados.');
}
$('case-search').addEventListener('input', pintarProcedimientos);
$('case-filter').addEventListener('change', pintarProcedimientos);

// ---------- abrir expediente ----------
async function abrirCaso(id) {
  const caso = await getProcedimiento(id);
  if (!caso) return;
  estado.currentCase = caso;
  estado.lectura = plain(caso.lectura);
  estado.expediente = plain(caso.expediente);
  estado.conclusion = plain(caso.conclusion);
  estado.resultadoDeclaracion = plain(caso.resultadoDeclaracion);
  estado.resultadoConclusion = plain(caso.resultadoConclusion);
  estado.activeTab = 'resumen';
  pintarTodo();
  setAppView('workspace');
  mostrarTab('resumen');
}

function pintarCaseHeader() {
  if (!estado.currentCase || !estado.expediente) return;
  const caso = snapshotCaso() || estado.currentCase;
  const e = estado.expediente;
  const st = estadoProcedimiento(caso);
  const meta = STATUS[st];
  const alertas = alertasCaso(caso).length;
  $('case-header').innerHTML = `
    <div class="case-ejcat-topline">
      <button class="case-ejcat-back" data-close-case>← Procedimientos</button>
      <div class="case-ejcat-institution"><span>Concurso sin masa</span><b>Administración de Justicia · entorno local</b></div>
      <div class="case-ejcat-unit">${esc(e.organo?.localidad || 'Órgano pendiente')} · ${esc(meta.label)}</div>
    </div>
    <div class="case-ejcat-matter">
      <div class="min-w-0">
        <div class="case-ejcat-kicker">Asunto · concurso voluntario sin masa</div>
        <div class="case-ejcat-title-row"><h1>${esc(e.procedimiento?.numero || e.deudor?.nombre || 'Procedimiento')}</h1><span class="case-ejcat-phase tone-${meta.tone}">${esc(meta.label)}</span></div>
        <p>${esc(e.deudor?.nombre || 'Deudor pendiente')}${e.deudor?.nif ? ` <span>·</span> ${esc(e.deudor.nif)}` : ''}</p>
      </div>
      <div class="case-ejcat-identifiers">
        <div><span>Pasivo</span><b>${euros(e.solicitud?.pasivo_declarado)}</b></div>
        <div><span>Acreedores</span><b>${e.creditos?.length || 0}</b></div>
        <div><span>Documentos</span><b>${documentosPresentes(caso)}</b></div>
        <div><span>Alertas</span><b class="${alertas ? 'is-attention' : ''}">${alertas}</b></div>
      </div>
    </div>`;
}

function pintarOverview() {
  if (!estado.currentCase || !estado.expediente || !estado.lectura) return;
  const caso = snapshotCaso() || estado.currentCase;
  const e = estado.expediente;
  const st = estadoProcedimiento(caso);
  const meta = STATUS[st];
  const next = siguienteActuacion(caso);
  const alerts = alertasCaso(caso);
  const source = caso.source || {};
  $('case-overview').innerHTML = `<div class="case-overview">
    <section class="case-overview-lead">
      <div><span class="case-section-kicker">Situación procesal</span><h2>${esc(meta.label)}</h2><p>${st === 'listo_auto' ? 'Los datos esenciales y las decisiones judiciales necesarias están preparados.' : st === 'auto_generado' ? 'Existe un borrador de auto de declaración generado.' : st === 'concluido' ? 'Existe un borrador de auto de conclusión.' : st === 'bloqueado' ? 'La lectura contiene una incidencia que impide seguir el cauce normal.' : 'Falta completar o confirmar una decisión antes de redactar.'}</p></div>
      <div class="case-next-actions"><button data-open-tab="${next.tab}">${esc(next.label)} →</button></div>
    </section>
    ${alerts.length ? `<section class="case-attention-strip"><span>!</span><div><b>${alerts.length} advertencia(s) de revisión</b><span>${esc(alerts[0].texto)}${alerts.length > 1 ? ' · y ' + (alerts.length - 1) + ' más' : ''}</span></div><button data-open-tab="solicitud">Revisar</button></section>` : ''}
    <section class="case-summary-grid">
      <article><span>Deudor</span><b>${esc(e.deudor?.nombre || 'Pendiente')}</b><small>${esc(e.deudor?.nif || 'NIF no leído')}</small></article>
      <article><span>Insolvencia</span><b>${esc(e.solicitud?.insolvencia || 'Pendiente')}</b><small>${e.solicitud?.tipo === 'concurso_sin_masa' ? 'Cauce sin masa detectado' : 'Revisar cauce'}</small></article>
      <article><span>Pasivo</span><b>${euros(e.solicitud?.pasivo_declarado)}</b><small>${e.creditos?.length || 0} acreedores relacionados</small></article>
      <article><span>Activo declarado</span><b>${euros(e.solicitud?.activo_declarado)}</b><small>Dato leído o completado manualmente</small></article>
    </section>
    <section class="case-process-card">
      <div class="case-section-heading"><div><span class="case-section-kicker">Origen</span><h3>Solicitud incorporada</h3></div><button data-open-tab="solicitud">Abrir datos →</button></div>
      <div class="case-origin-grid">
        <div><span>Archivo</span><b>${esc(source.name || estado.lectura.fichero || '—')}</b></div>
        <div><span>Fecha de solicitud</span><b>${esc(e.solicitud?.fecha || '—')}</b></div>
        <div><span>Huella de lectura</span><b class="mono">${esc(String(estado.lectura.hash_lectura || '').slice(0, 16) || '—')}</b></div>
        <div><span>Persistencia</span><b>Este navegador</b><small>Se conserva el expediente estructurado; el PDF original no se replica.</small></div>
      </div>
    </section>
  </div>`;
}

function pintarActivity() {
  if (!estado.currentCase) return;
  const events = [...(estado.currentCase.activity || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  $('case-activity').innerHTML = `<div class="case-activity-workspace">
    <header class="case-activity-hero"><div><span class="case-section-kicker">Actividad</span><h2>Tramitación del expediente</h2><p>Hitos del procedimiento guardados localmente. Las ediciones ordinarias actualizan la fecha sin llenar la cronología.</p></div><div class="case-activity-metrics"><article><span>Actuaciones</span><strong>${events.length}</strong></article><article><span>Última modificación</span><strong class="date-small">${fmtDate(estado.currentCase.updatedAt)}</strong></article></div></header>
    <section class="case-activity-stream">${events.length ? events.map((item) => `<article class="case-activity-event"><span class="case-activity-marker">${item.tipo === 'upload' ? '＋' : item.tipo === 'declaration' ? 'A' : item.tipo === 'conclusion' ? '✓' : '·'}</span><div><strong>${esc(item.titulo)}</strong><small>${fmtDateTime(item.at)}</small>${item.detalle ? `<p>${esc(item.detalle)}</p>` : ''}</div></article>`).join('') : '<div class="case-activity-empty">No hay actuaciones registradas.</div>'}</section>
  </div>`;
}

// ---------- contenido de la solicitud ----------
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
  const opc = creditClassIds(estado.knowledge).map((c) => `<option value="${c}">${c.replace(/_/g, ' ')}</option>`).join('');
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
    invalidarResultados('expediente'); pintarAcreedores(); programarGuardado(); pintarCaseHeader(); pintarOverview();
  };
  document.querySelectorAll('[data-quitar]').forEach((b) => { b.onclick = () => {
    estado.expediente.creditos.splice(Number(b.dataset.quitar), 1);
    invalidarResultados('expediente'); pintarAcreedores(); programarGuardado(); pintarCaseHeader(); pintarOverview();
  }; });
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

// ---------- datos del juzgado ----------
function cargarJuzgado() {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_JUZGADO) || 'null');
    if (g) return { ...plain(DATOS_JUZGADO_VACIOS), ...g, procedimiento: { numero: '', nig: '' }, fecha_resolucion: '', numero_resolucion: '' };
  } catch {}
  return plain(DATOS_JUZGADO_VACIOS);
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

// ---------- decisión y resoluciones ----------
function pintarDecision() {
  const d = estado.expediente.decision_judicial;
  d.sentido ??= 'declarar_sin_masa';
  const supuestos = estado.knowledge.getCatalog('supuesto_37_bis') || {};
  $('decision').innerHTML = [
    campo({ etiqueta: 'Soy competente (territorial y objetivamente)', ruta: 'decision_judicial.competencia_verificada', tipo: 'check' }),
    campo({ etiqueta: 'Aprecio la insolvencia alegada', ruta: 'decision_judicial.insolvencia_apreciada', tipo: 'check' }),
    campo({ etiqueta: 'Supuesto del art. 37 bis TRLC', ruta: 'decision_judicial.supuesto_37_bis', tipo: 'entero', opciones: [['', '— elija —'], ...Object.entries(supuestos).map(([k, v]) => [k, `${v.codigo}) ${v.texto}`])], fuente: false })
  ].join('');
}

function descargar(nombre, contenido, tipo) {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nombre });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function documentoHtml(doc) {
  return `<article class="resolucion-preview">${doc.filter((el) => el.tipo !== 'aviso').map((el) => {
    if (el.tipo === 'encabezado') return `<div class="auto-meta">${esc(el.texto)}</div>`;
    if (el.tipo === 'titulo') {
      const clase = /^AUTO\\b/.test(el.texto) ? 'auto-resolucion' : 'auto-seccion';
      return `<h4 class="${clase}">${esc(el.texto)}</h4>`;
    }
    if (el.tipo === 'apartado') {
      const pref = `${el.numero}.${el.titulo ? ` ${el.titulo}.` : ''}`;
      return `<p class="auto-apartado"><strong>${esc(pref)}</strong> ${esc(el.texto)}</p>`;
    }
    if (el.tipo === 'dispositivo') return `<p class="auto-dispositivo"><strong>${el.numero}.º</strong> ${esc(el.texto)}</p>`;
    if (el.tipo === 'tabla') {
      const conNotas = el.lineas.some((l) => l.nota);
      return `<div class="tabla-auto-wrap"><table class="tabla-auto"><thead><tr><th>N.º</th><th>Acreedor</th><th>Concepto</th><th>Importe</th>${conNotas ? '<th>Observaciones</th>' : ''}</tr></thead><tbody>${el.lineas.map((l) => `<tr><td>${l.n}</td><td>${esc(l.acreedor)}</td><td>${esc(l.concepto)}</td><td class="importe">${esc(l.importe)}</td>${conNotas ? `<td>${esc(l.nota || '')}</td>` : ''}</tr>`).join('')}<tr class="total"><td></td><td>TOTAL</td><td></td><td class="importe">${esc(el.total)}</td>${conNotas ? '<td></td>' : ''}</tr></tbody></table></div>`;
    }
    if (el.tipo === 'firma') return `<p class="auto-firma">${esc(el.texto)}</p>`;
    return `<p class="auto-parrafo">${esc(el.texto)}</p>`;
  }).join('')}</article>`;
}

function pintarResultado(destino, r, base, expediente) {
  const titulos = { borrador: 'Borrador generado', borrador_no_ratificado: 'Borrador generado (bloques sin ratificar)', pendiente_decision: 'Falta la decisión del juez', pendiente_tramite: 'El procedimiento no está en fase', fuera_de_alcance: 'Fuera del alcance de la plantilla', expediente_invalido: 'Faltan datos o son incoherentes', bloqueado_por_calidad: 'Bloqueado por los controles de calidad', error_redaccion: 'Error de redacción' };
  const lista = [...(r.errores || []), ...(r.motivos || []), ...(r.controles?.fallos || [])];
  const nivel = r.texto ? 'info' : 'bloqueo';
  $(destino).innerHTML = `<div class="resultado">
    <h3>${esc(titulos[r.estado] || r.estado)}</h3>
    ${lista.length ? `<ul class="alertas">${lista.map((m) => `<li class="${nivel === 'info' ? 'aviso' : 'bloqueo'}">${esc(m)}</li>`).join('')}</ul>` : ''}
    ${r.controles?.avisos?.length ? `<ul class="alertas">${r.controles.avisos.map((m) => `<li class="aviso">${esc(m)}</li>`).join('')}</ul>` : ''}
    ${r.texto ? `<div class="texto-auto">${documentoHtml(r.documento)}</div>
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
  const exp = plain(estado.expediente);
  const r = generarAutoDeclaracion(exp, { knowledge: estado.knowledge, pack: pack('declaracion-sin-masa') });
  pintarResultado('resultado-declaracion', r, `auto-declaracion-${(exp.procedimiento.numero || 'sin-numero').replace(/\W+/g, '-')}`, exp);
  if (r.texto) {
    estado.resultadoDeclaracion = plain(r);
    if (!estado.conclusion) prepararConclusion();
    $('paso-5').classList.remove('oculto');
    await guardarCasoAhora({ evento: actividad('declaration', 'Auto de declaración generado', `IR ${r.ir.hash_ir.slice(0, 16)}`) });
    pintarCaseHeader(); pintarOverview(); pintarActivity(); await cargarCasos();
  } else {
    await guardarCasoAhora();
  }
};

function prepararConclusion() {
  const e = estado.expediente;
  estado.conclusion = declaracionAExpedienteConclusion(e, { fecha_declaracion: e.fecha_resolucion, solicitud_epi_fecha: e.solicitud.pide_epi && e.deudor.tipo === 'persona_natural' ? '' : null });
  if (estado.conclusion.tramite.solicitud_epi === null && e.solicitud.pide_epi) estado.conclusion.tramite.solicitud_epi = { fecha: '' };
  const conEpi = estado.conclusion.tramite.solicitud_epi != null;
  if (conEpi) { estado.conclusion.tramite.traslado_acreedores ??= null; estado.conclusion.tramite.oposiciones ??= []; }
  estado.conclusion.decision_judicial = { sentido: conEpi ? 'conceder_epi' : 'concluir_sin_epi', buena_fe_verificada: false, excepciones_art_487: [] };
  pintarConclusion();
}

function pintarConclusion() {
  if (!estado.conclusion) return;
  const conEpi = estado.conclusion.tramite.solicitud_epi != null;
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
  const exp = plain(estado.conclusion);
  const r = generarAutoConclusion(exp, { knowledge: estado.knowledge, pack: pack('concurso-sin-masa') });
  pintarResultado('resultado-conclusion', r, `auto-conclusion-${(exp.procedimiento.numero || 'sin-numero').replace(/\W+/g, '-')}`, exp);
  if (r.texto) {
    estado.resultadoConclusion = plain(r);
    await guardarCasoAhora({ evento: actividad('conclusion', 'Auto de conclusión generado', `IR ${r.ir.hash_ir.slice(0, 16)}`) });
    pintarCaseHeader(); pintarOverview(); pintarActivity(); await cargarCasos();
  } else {
    await guardarCasoAhora();
  }
};

function pintarTodo() {
  pintarResumen(); pintarCampos(); pintarAcreedores(); pintarJuzgado(); pintarDecision();
  pintarCaseHeader(); pintarOverview(); pintarActivity();

  if (estado.resultadoDeclaracion?.texto) {
    pintarResultado('resultado-declaracion', estado.resultadoDeclaracion, `auto-declaracion-${(estado.expediente.procedimiento.numero || 'sin-numero').replace(/\W+/g, '-')}`, estado.expediente);
    if (estado.conclusion) {
      pintarConclusion();
      $('paso-5').classList.remove('oculto');
    }
  } else {
    $('resultado-declaracion').innerHTML = '';
    $('paso-5').classList.add('oculto');
  }

  if (estado.resultadoConclusion?.texto && estado.conclusion) {
    pintarResultado('resultado-conclusion', estado.resultadoConclusion, `auto-conclusion-${(estado.conclusion.procedimiento.numero || 'sin-numero').replace(/\W+/g, '-')}`, estado.conclusion);
  } else {
    $('resultado-conclusion').innerHTML = '';
  }
}

// ---------- inicio ----------
await cargarCasos();
setAppView('dashboard');

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
import { prepareKnowledgeRuntime } from '/src/core/knowledge/runtime.mjs';
import { createKnowledgeRegistry } from '/src/core/knowledge/registry.mjs';
import { creditClassIds } from '/src/core/knowledge/credit-engine.mjs';
import { adaptPersonaFisicaKnowledgeSource, personaFisicaKnowledgeSummary } from '/src/adapters/concursal/knowledge-persona-fisica.mjs';
import { fusionarLecturaConIA } from '/src/adapters/concursal/ai-extraction.mjs';
import { anonimizarDocumentoConcursal } from '/src/adapters/concursal/anonymize-document.mjs';
import { buildSafeCaseSnapshot, buildKnowledgeContext, validateSafeCaseSnapshot, relevantKnowledgeModules } from '/src/adapters/concursal/ai-tools.mjs';
import { evaluarIndicadoresBuenaFe } from '/src/adapters/concursal/good-faith.mjs';
import { buildConcursalFamilies, buildConcursalReport, buildReviewQueue, buildLearningSummary, concursalTags } from '/src/adapters/concursal/insights.mjs';
import { listProcedimientos, getProcedimiento, putProcedimiento, deleteProcedimiento, findBySourceHash } from '/web/case-store.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
const getDocument = (opts) => pdfjs.getDocument({ ...opts, standardFontDataUrl: '/node_modules/pdfjs-dist/standard_fonts/' });

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euros = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const CLAVE_JUZGADO = 'csm.datos_juzgado.v1';
const CLAVE_EXTRACTOR_IA = 'csm.extractor_ia.v1';
const SAVE_DELAY = 350;
const todayLocal = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const [knowledge, sourceKnowledgeRaw] = await Promise.all([
  loadKnowledgeRuntimeFromUrl('/knowledge/runtime/concursal/concurso-sin-masa-1.1.0.json'),
  fetch('/knowledge/source/concursal/kb-concurso-persona-fisica-1.0.0.json', { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`No se ha podido cargar el Knowledge de persona física (${r.status}).`);
    return r.json();
  })
]);
const personaFisicaKnowledge = prepareKnowledgeRuntime(adaptPersonaFisicaKnowledgeSource(sourceKnowledgeRaw));
const knowledgeRegistry = createKnowledgeRegistry([knowledge, personaFisicaKnowledge]);
const knowledgeSummary = personaFisicaKnowledgeSummary(sourceKnowledgeRaw);

const estado = {
  lectura: null,
  expediente: null,
  conclusion: null,
  resultadoDeclaracion: null,
  resultadoConclusion: null,
  currentCase: null,
  cases: [],
  knowledge,
  personaFisicaKnowledge,
  knowledgeRegistry,
  knowledgeSummary,
  sourceKnowledgeRaw,
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
    : '<span class="fuente manual">No leído · puede dejarse pendiente en el borrador</span>';
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
  ['dashboard', 'review', 'procedimientos', 'families', 'reports', 'learnings', 'knowledge', 'workspace'].forEach((id) => {
    $('view-' + id)?.classList.toggle('oculto', id !== view);
  });
  document.querySelectorAll('[data-app-view]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.appView === view || (view === 'workspace' && b.dataset.appView === 'procedimientos'));
  });
  if (view === 'dashboard') {
    $('topbar-title').textContent = 'Bandeja concursal';
    $('topbar-subtitle').textContent = 'Procedimientos guardados únicamente en este navegador';
  } else if (view === 'review') {
    $('topbar-title').textContent = 'Para revisar';
    $('topbar-subtitle').textContent = 'Decisiones pendientes, incidencias y señales de buena fe';
  } else if (view === 'procedimientos') {
    $('topbar-title').textContent = 'Procedimientos';
    $('topbar-subtitle').textContent = 'Expedientes locales y estado de tramitación';
  } else if (view === 'families') {
    $('topbar-title').textContent = 'Familias';
    $('topbar-subtitle').textContent = 'Patrones de asuntos sin propagación automática de criterio';
  } else if (view === 'reports') {
    $('topbar-title').textContent = 'Informes';
    $('topbar-subtitle').textContent = 'Actividad y composición de la bandeja local';
  } else if (view === 'learnings') {
    $('topbar-title').textContent = 'Aprendizajes';
    $('topbar-subtitle').textContent = 'Correcciones humanas para mejorar extracción y Knowledge';
  } else if (view === 'knowledge') {
    $('topbar-title').textContent = 'Knowledge';
    $('topbar-subtitle').textContent = 'Conocimiento jurídico separado del Legal Core';
    pintarKnowledge();
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

async function extraerSolicitudConIA(privacy) {
  const response = await fetch('/.netlify/functions/extract-solicitud', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      document_text: privacy.text,
      privacy: privacy.manifest
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Extractor IA HTTP ${response.status}`);
    error.code = payload?.error?.code || 'AI_EXTRACTION_ERROR';
    throw error;
  }
  return {
    ...payload,
    proposal: privacy.restore(payload.proposal),
    privacy: privacy.manifest
  };
}

async function leerNuevaSolicitud(fichero) {
  const status = $('upload-status');
  status.innerHTML = '<p class="nota loading-note">Leyendo y estructurando la solicitud…</p>';
  try {
    if (!/\.pdf$/i.test(fichero.name) && fichero.type !== 'application/pdf') throw new Error('El fichero no es un PDF.');
    const texto = await extraerTextoPdf(new Uint8Array(await fichero.arrayBuffer()), getDocument);
    const determinista = leerSolicitud(texto, { nombre_fichero: fichero.name });
    let lectura = determinista;
    let extractionMode = 'deterministic';
    let extractionError = null;
    let privacyDocument = null;
    try {
      privacyDocument = anonimizarDocumentoConcursal(texto, determinista);
    } catch (privacyError) {
      extractionError = { code: privacyError.code || 'LOCAL_PRIVACY_GUARD_FAILED', message: privacyError.message };
    }
    const useAi = $('ai-extraction-toggle')?.checked === true;
    if (useAi && privacyDocument) {
      status.innerHTML = '<p class="nota loading-note">Lectura local terminada · usando texto pseudonimizado con IA…</p>';
      try {
        const assisted = await extraerSolicitudConIA(privacyDocument);
        lectura = fusionarLecturaConIA(determinista, assisted.proposal, { provider: assisted.provider, model: assisted.model });
        extractionMode = 'hybrid_ai_anonymized';
        lectura = plain(lectura);
        lectura.extractor = {
          ...(lectura.extractor || {}),
          privacy: assisted.privacy
        };
      } catch (error) {
        extractionError = { code: error.code || 'AI_EXTRACTION_ERROR', message: error.message };
        status.innerHTML = `<ul class="alertas"><li class="aviso">La IA no está disponible: se continúa con la lectura determinista. ${esc(error.message)}</li></ul>`;
      }
    }

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
      source: { name: fichero.name, size: fichero.size, lastModified: fichero.lastModified, hash: lectura.hash_texto, extraction_mode: extractionMode, extraction_error: extractionError },
      ai_context: privacyDocument ? {
        safe_document_text: privacyDocument.text,
        privacy: privacyDocument.manifest
      } : null,
      ai_results: {},
      lectura: plain(lectura),
      expediente: plain(expediente),
      conclusion: null,
      resultadoDeclaracion: null,
      resultadoConclusion: null,
      activity: [actividad('upload', 'Solicitud incorporada', `${fichero.name} · ${extractionMode === 'hybrid_ai_anonymized' ? 'extracción híbrida con anonimización local' : 'lectura determinista'}`)]
    };
    await putProcedimiento(record);
    status.innerHTML = '';
    await cargarCasos();
    await abrirCaso(record.id);
  } catch (err) {
    status.innerHTML = `<ul class="alertas"><li class="bloqueo">No se ha podido leer el PDF: ${esc(err.message)}</li></ul>`;
  }
}

// ---------- Knowledge ----------
const knowledgeUi = { section: 'reglas', query: '', selected: null };

function knowledgeCollection(section) {
  const raw = estado.sourceKnowledgeRaw;
  return ({
    reglas: raw.reglas || [],
    normas: raw.normas || [],
    fases: raw.fases || [],
    resoluciones: raw.resoluciones || [],
    fundamentos: raw.fundamentos_tipo || [],
    jurisprudencia: raw.jurisprudencia || [],
    huecos: raw.pendiente_verificar || []
  })[section] || [];
}

function knowledgeTitle(section, item, index) {
  if (section === 'normas') return item.titulo || [item.norma, item.art].filter(Boolean).join(' · ') || item.id || `Norma ${index + 1}`;
  if (section === 'jurisprudencia') return [item.organo, item.resolucion].filter(Boolean).join(' · ') || item.id || `Precedente ${index + 1}`;
  if (section === 'huecos') return item.que || item.ref || `Pendiente ${index + 1}`;
  return item.titulo || item.nombre || item.descripcion || item.id || item.codigo || `${section} ${index + 1}`;
}

function knowledgeSummaryText(section, item) {
  const value = item.mensaje || item.texto || item.descripcion || item.nota || item.objeto || item.que || item.finalidad;
  if (Array.isArray(value)) return value.join(' · ');
  return String(value || '').slice(0, 260);
}

function knowledgeBadges(section, item) {
  const values = [
    item.modulo,
    item.tipo,
    item.severidad,
    item.verificado === true ? 'verificado' : item.verificado === false ? 'no verificado' : null,
    section === 'jurisprudencia' ? item.fecha : null
  ].filter(Boolean);
  return values.map((v) => `<span class="knowledge-badge">${esc(String(v).replaceAll('_',' '))}</span>`).join('');
}

function pintarKnowledgeDetail(section, item, index) {
  const target = $('knowledge-detail');
  if (!target) return;
  if (!item) {
    target.innerHTML = '<div class="knowledge-detail-empty"><span>Selecciona un elemento</span><p>Aquí podrás leer el contenido completo, su procedencia y su estructura técnica.</p></div>';
    return;
  }
  const title = knowledgeTitle(section, item, index);
  const fields = [];
  if (item.id) fields.push(['ID', item.id]);
  if (item.modulo) fields.push(['Módulo', item.modulo]);
  if (item.tipo) fields.push(['Tipo', item.tipo]);
  if (item.severidad) fields.push(['Severidad', item.severidad]);
  if (item.norma) fields.push(['Norma', item.norma]);
  if (item.art) fields.push(['Artículo', item.art]);
  if (item.fundamento?.length) fields.push(['Fundamento', item.fundamento.join(', ')]);
  if (item.verificado != null) fields.push(['Verificación', String(item.verificado)]);
  target.innerHTML = `
    <div class="knowledge-detail-head"><span class="judicial-kicker">${esc(section)}</span><h2>${esc(title)}</h2>${knowledgeBadges(section,item)}</div>
    ${fields.length ? `<dl class="knowledge-detail-grid">${fields.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
    ${knowledgeSummaryText(section,item) ? `<div class="knowledge-detail-text">${esc(knowledgeSummaryText(section,item))}</div>` : ''}
    <details class="knowledge-json"><summary>Ver estructura técnica</summary><pre>${esc(JSON.stringify(item,null,2))}</pre></details>`;
}

function pintarKnowledgeBrowser() {
  const section = knowledgeUi.section;
  const query = knowledgeUi.query.toLowerCase().trim();
  const items = knowledgeCollection(section);
  const filtered = items.map((item,index)=>({item,index,title:knowledgeTitle(section,item,index)}))
    .filter(({item,title}) => !query || JSON.stringify(item).toLowerCase().includes(query) || title.toLowerCase().includes(query));
  $('knowledge-browser').innerHTML = filtered.length ? filtered.map(({item,index,title}) => `
    <button class="knowledge-row ${knowledgeUi.selected === index ? 'active' : ''}" data-knowledge-item="${index}">
      <span class="knowledge-row-main"><b>${esc(title)}</b><small>${esc(knowledgeSummaryText(section,item) || 'Sin resumen')}</small></span>
      <span class="knowledge-row-tags">${knowledgeBadges(section,item)}</span>
    </button>`).join('') : '<div class="judicial-mini-empty">No hay elementos que coincidan con la búsqueda.</div>';
  const selected = items[knowledgeUi.selected];
  pintarKnowledgeDetail(section, selected || null, knowledgeUi.selected);
}

function pintarKnowledge() {
  const s = estado.knowledgeSummary;
  const raw = estado.sourceKnowledgeRaw;
  if (!$('knowledge-summary')) return;
  $('knowledge-summary').innerHTML = `
    <section class="knowledge-hero-card">
      <div><span class="judicial-kicker">Fuente incorporada</span><h2>${esc(raw.meta?.titulo || 'Knowledge concursal')}</h2><p>Versión ${esc(s.version || '—')} · corte normativo ${esc(s.fecha_corte_normativa || '—')} · el contenido completo es inspeccionable, no sólo sus métricas.</p></div>
      <span class="knowledge-state">Pendiente de certificación</span>
    </section>
    <section class="knowledge-metrics">
      <article><span>Normas</span><strong>${s.normas}</strong></article>
      <article><span>Reglas</span><strong>${s.reglas}</strong><small>${s.automaticas} automáticas · ${s.mixtas} mixtas · ${s.valoracion_judicial} judiciales</small></article>
      <article><span>Fases</span><strong>${s.fases}</strong></article>
      <article><span>Resoluciones</span><strong>${s.resoluciones}</strong></article>
      <article><span>Fundamentos tipo</span><strong>${s.fundamentos_tipo}</strong></article>
      <article><span>Pendiente verificar</span><strong class="${s.pendiente_verificar ? 'is-attention' : ''}">${s.pendiente_verificar}</strong></article>
    </section>`;

  const modules = Object.entries((raw.reglas || []).reduce((acc, rule) => {
    const key = rule.modulo || 'otros'; acc[key] = (acc[key] || 0) + 1; return acc;
  }, {})).sort((a,b) => b[1] - a[1]);
  $('knowledge-modules').innerHTML = modules.map(([name, count]) => `<button class="knowledge-module" data-knowledge-module="${esc(name)}"><span>${esc(name.replaceAll('_',' '))}</span><b>${count}</b></button>`).join('');
  $('knowledge-warnings').innerHTML = (raw.meta?.advertencias || []).map((warning) => `<li>${esc(warning)}</li>`).join('');
  document.querySelectorAll('[data-knowledge-section]').forEach((b) => b.classList.toggle('active', b.dataset.knowledgeSection === knowledgeUi.section));
  pintarKnowledgeBrowser();
}

// ---------- dashboard y listado ----------
async function cargarCasos() {
  estado.cases = await listProcedimientos();
  pintarDashboard();
  pintarProcedimientos();
  pintarReviewView();
  pintarFamiliesView();
  pintarReportsView();
  pintarLearningsView();
  const counter = $('nav-case-count');
  if (counter) {
    counter.textContent = estado.cases.length;
    counter.classList.toggle('oculto', !estado.cases.length);
  }
  const reviewCounter = $('nav-review-count');
  if (reviewCounter) {
    const count = buildReviewQueue(estado.cases).length;
    reviewCounter.textContent = count;
    reviewCounter.classList.toggle('oculto', !count);
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

function buenaFeLabel(estadoBF) {
  return ({
    prioridad_alta: ['Revisión prioritaria', 'high'],
    revisar: ['Revisar buena fe', 'medium'],
    senal_debil: ['Señal débil', 'low'],
    sin_indicios_detectados: ['Sin indicios automáticos', 'neutral']
  })[estadoBF] || ['Revisar', 'neutral'];
}

function pintarReviewView() {
  if (!$('review-view')) return;
  const queue = buildReviewQueue(estado.cases);
  $('review-view').innerHTML = queue.length ? `
    <div class="review-list">${queue.map(({caso,goodFaith,needsDecision}) => {
      const [label,tone] = buenaFeLabel(goodFaith.estado);
      return `<article class="review-row">
        <button data-open-case="${esc(caso.id)}">
          <span class="review-priority tone-${tone}">!</span>
          <span class="review-main"><b>${esc(casoTitulo(caso))}</b><small>${esc(casoSubtitulo(caso))}</small></span>
          <span class="review-reasons">${needsDecision ? '<em>decisión pendiente</em>' : ''}${goodFaith.estado !== 'sin_indicios_detectados' ? `<em class="tone-${tone}">${esc(label)}</em>` : ''}</span>
          <span>→</span>
        </button>
      </article>`;
    }).join('')}</div>` : emptyList('No hay asuntos que requieran una revisión especial.');
}

function pintarFamiliesView() {
  if (!$('families-view')) return;
  const families = buildConcursalFamilies(estado.cases);
  $('families-view').innerHTML = families.length ? `<div class="families-grid">${families.map((family) => `
    <article class="family-card">
      <header><div><span class="judicial-kicker">Familia</span><h3>${esc(family.label)}</h3></div><strong>${family.total}</strong></header>
      <div class="family-stats"><span>${family.generated} con resolución</span><span>${family.pending} pendientes</span><span>${euros(family.pasivo)} pasivo</span></div>
      <div class="family-cases">${family.cases.slice(0,6).map((caso)=>`<button data-open-case="${esc(caso.id)}"><span>${esc(casoTitulo(caso))}</span><small>${euros(caso.expediente?.solicitud?.pasivo_declarado)}</small></button>`).join('')}</div>
      ${family.cases.length>6 ? `<small class="family-more">+${family.cases.length-6} asuntos más</small>` : ''}
    </article>`).join('')}</div>` : emptyList('Las familias aparecerán cuando incorpores procedimientos.');
}

function pintarReportsView() {
  if (!$('reports-view')) return;
  const report = buildConcursalReport(estado.cases);
  const tagCounts = new Map();
  for (const caso of estado.cases) for (const tag of concursalTags(caso)) tagCounts.set(tag,(tagCounts.get(tag)||0)+1);
  const tags=[...tagCounts.entries()].sort((a,b)=>b[1]-a[1]);
  $('reports-view').innerHTML = `
    <section class="report-kpis">
      <article><span>Procedimientos</span><b>${report.total}</b></article>
      <article><span>Autos declaración</span><b>${report.declaracion_generada}</b></article>
      <article><span>Conclusiones</span><b>${report.conclusion_generada}</b></article>
      <article><span>Con EPI</span><b>${report.epi}</b></article>
      <article><span>Con crédito público</span><b>${report.credito_publico}</b></article>
      <article><span>Pasivo total</span><b>${euros(report.pasivo_total)}</b></article>
    </section>
    <div class="report-grid">
      <section class="judicial-section-card report-panel"><div class="judicial-section-heading"><div><div class="judicial-kicker">Composición</div><h2>Familias jurídicas</h2></div></div>
        <div class="report-bars">${tags.length ? tags.map(([tag,count])=>`<div><span>${esc(tag)}</span><div><i style="width:${report.total ? Math.max(5,(count/report.total)*100) : 0}%"></i></div><b>${count}</b></div>`).join('') : '<p class="judicial-mini-empty">Sin datos todavía.</p>'}</div>
      </section>
      <section class="judicial-section-card report-panel"><div class="judicial-section-heading"><div><div class="judicial-kicker">Magnitudes</div><h2>Expediente medio</h2></div></div>
        <div class="report-facts"><div><span>Pasivo medio</span><b>${euros(report.pasivo_medio)}</b></div><div><span>Acreedores por asunto</span><b>${report.acreedores_medio.toFixed(1)}</b></div><div><span>Garantía real</span><b>${report.garantia_real}</b></div><div><span>Última actividad</span><b>${fmtDate(report.ultima_actividad)}</b></div></div>
      </section>
    </div>`;
}

function pintarLearningsView() {
  if (!$('learnings-view')) return;
  const learning=buildLearningSummary(estado.cases);
  const labels={deudor:'Nombre deudor',nif:'NIF/NIE',domicilio:'Domicilio',pasivo:'Pasivo',activo:'Activo',acreedores:'N.º acreedores',clase_credito:'Clase crédito'};
  const entries=Object.entries(learning.counters).sort((a,b)=>b[1]-a[1]);
  $('learnings-view').innerHTML = `
    <section class="learning-intro"><span class="judicial-kicker">Aprendizaje supervisado</span><h2>Qué corrige el usuario después de la extracción</h2><p>Estas correcciones sirven para saber dónde falla el extractor. No modifican automáticamente reglas, prompts ni Knowledge.</p></section>
    <section class="learning-metrics">${entries.map(([key,count])=>`<article><span>${esc(labels[key]||key)}</span><b>${count}</b><small>correcciones detectadas</small></article>`).join('')}</section>
    <section class="judicial-section-card"><div class="judicial-section-heading"><div><div class="judicial-kicker">Casos corregidos</div><h2>Ejemplos recientes</h2></div></div>
      <div class="learning-examples">${learning.examples.length ? learning.examples.map((x)=>`<button data-open-case="${esc(x.id)}"><b>${esc(x.titulo)}</b><span>${esc(x.changed.join(' · '))}</span><em>Abrir →</em></button>`).join('') : '<div class="judicial-mini-empty">Todavía no se han detectado correcciones respecto de la lectura original.</div>'}</div>
    </section>`;
}

// ---------- abrir expediente ----------
async function abrirCaso(id) {
  const caso = await getProcedimiento(id);
  if (!caso) return;
  estado.currentCase = caso;
  estado.lectura = plain(caso.lectura);
  estado.expediente = plain(caso.expediente);
  if (estado.expediente && !estado.expediente.fecha_resolucion) estado.expediente.fecha_resolucion = todayLocal();
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

function renderAiResult(mode, payload) {
  if (!payload?.result) return '<div class="ai-result-empty">Todavía no se ha ejecutado esta asistencia.</div>';
  const result = payload.result;
  if (mode === 'document_audit') {
    return `<div class="ai-result">
      <div class="ai-result-meta">Revisión humana obligatoria · ${esc(payload.model || 'modelo')}</div>
      ${(result.hallazgos || []).map((h)=>`<article class="ai-finding severity-${esc(h.severidad)}"><span>${esc(h.severidad)}</span><div><b>${esc(h.categoria)}</b><p>${esc(h.descripcion)}</p>${h.evidence?.page ? `<small>p. ${h.evidence.page}, l. ${h.evidence.line || '—'} · ${esc(h.evidence.quote || '')}</small>` : ''}</div></article>`).join('')}
      ${result.contradicciones?.length ? `<h4>Contradicciones</h4>${result.contradicciones.map((x)=>`<p class="ai-question">⚠ ${esc(x.descripcion)}</p>`).join('')}` : ''}
      ${result.preguntas_revision?.length ? `<h4>Preguntas para revisar</h4><ul>${result.preguntas_revision.map((x)=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }
  return `<div class="ai-result">
    <div class="ai-result-meta">Basado sólo en el Knowledge suministrado · revisión humana obligatoria</div>
    ${(result.cuestiones || []).map((q)=>`<article class="ai-issue"><span class="knowledge-badge">${esc(q.relevancia)}</span><div><b>${esc(q.titulo)}</b><p>${esc(q.por_que_importa)}</p><small>Reglas: ${esc((q.rule_ids || []).join(', ') || '—')}${q.requiere_decision_judicial ? ' · decisión judicial' : ''}</small>${q.hechos_faltantes?.length ? `<ul>${q.hechos_faltantes.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div></article>`).join('')}
  </div>`;
}

function pintarAnalysis() {
  if (!estado.currentCase || !estado.expediente) return;
  const modules = relevantKnowledgeModules(estado.expediente);
  const rules = (estado.sourceKnowledgeRaw.reglas || []).filter((r)=>modules.includes(r.modulo));
  const results = estado.currentCase.ai_results || {};
  const hasSafeDoc = Boolean(estado.currentCase.ai_context?.safe_document_text);
  const goodFaith = evaluarIndicadoresBuenaFe({
    expediente: estado.expediente,
    lectura: estado.lectura,
    aiResults: results,
    safeDocumentText: estado.currentCase.ai_context?.safe_document_text || ''
  });
  const [goodFaithLabel, goodFaithTone] = buenaFeLabel(goodFaith.estado);
  $('case-analysis').innerHTML = `<div class="case-analysis-workspace">
    <section class="analysis-hero">
      <div><span class="case-section-kicker">Análisis</span><h2>Motor determinista + Knowledge + asistencias IA opcionales</h2><p>Las reglas estructuradas siguen siendo la columna vertebral. La IA se reserva para tareas semánticas donde un sistema determinista puede perder matices, contradicciones o relevancia contextual.</p></div>
    </section>
    <section class="good-faith-card tone-${goodFaithTone}">
      <header>
        <div><span class="case-section-kicker">Buena fe · art. 487 TRLC</span><h3>${esc(goodFaithLabel)}</h3><p>${esc(goodFaith.conclusion)}</p></div>
        <button data-jump-rule="EPI_017">Abrir criterio EPI_017 →</button>
      </header>
      <div class="good-faith-grid">
        <div class="good-faith-signals">
          <h4>Señales detectadas</h4>
          ${goodFaith.signals.length ? goodFaith.signals.map((s)=>`<article><span class="tone-${s.nivel}">${esc(s.nivel)}</span><div><b>${esc(s.titulo)}</b><p>${esc(s.detalle)}</p><small>${esc(s.origen)}</small></div></article>`).join('') : '<p class="good-faith-empty">Ninguna señal automática. Eso no sustituye la valoración judicial de las circunstancias.</p>'}
        </div>
        <div class="good-faith-factors">
          <h4>Factores que conviene comprobar</h4>
          ${goodFaith.factors.map((f)=>`<div><span class="factor-state state-${esc(f.estado)}"></span><p><b>${esc(f.titulo)}</b><small>${esc(f.nota)}</small></p></div>`).join('')}
        </div>
      </div>
    </section>
    <section class="analysis-grid">
      <article class="analysis-card deterministic">
        <span class="analysis-number">D</span><div><h3>Knowledge determinista</h3><p>Módulos potencialmente relevantes: <b>${esc(modules.join(' · '))}</b>. Hay ${rules.length} reglas disponibles en esos módulos.</p><div class="analysis-rule-list">${rules.slice(0,8).map(r=>`<button data-jump-rule="${esc(r.id)}"><span>${esc(r.id)}</span>${esc(r.titulo || r.mensaje || '')}</button>`).join('')}</div></div>
      </article>
      <article class="analysis-card ai">
        <span class="analysis-number">IA 2</span><div><h3>Auditor documental semántico</h3><p>Busca contradicciones internas, omisiones semánticas, cifras incompatibles y puntos que merecen revisión. No decide ninguna cuestión jurídica.</p>
        <button class="analysis-run" data-run-ai="document_audit" ${hasSafeDoc ? '' : 'disabled'}>Ejecutar auditoría</button>
        ${!hasSafeDoc ? '<small>Requiere un procedimiento creado después de activar la capa de pseudonimización local.</small>' : ''}
        <div id="ai2-result">${renderAiResult('document_audit', results.document_audit)}</div></div>
      </article>
      <article class="analysis-card ai">
        <span class="analysis-number">IA 3</span><div><h3>Mapa de cuestiones jurídicas</h3><p>Recibe sólo un snapshot desidentificado y el subconjunto relevante del Knowledge. Señala reglas, hechos faltantes y cuestiones a revisar, sin proponer el sentido de la resolución.</p>
        <button class="analysis-run" data-run-ai="knowledge_issue_spotter">Analizar cuestiones</button>
        <div id="ai3-result">${renderAiResult('knowledge_issue_spotter', results.knowledge_issue_spotter)}</div></div>
      </article>
    </section>
  </div>`;
}

async function ejecutarAsistenciaIA(mode) {
  if (!estado.currentCase || !estado.expediente) return;
  const target = mode === 'document_audit' ? $('ai2-result') : $('ai3-result');
  target.innerHTML = '<p class="nota loading-note">Preparando contexto seguro…</p>';
  let body = { mode };
  if (mode === 'document_audit') {
    const ctx = estado.currentCase.ai_context;
    if (!ctx?.safe_document_text || !ctx?.privacy) {
      target.innerHTML = '<ul class="alertas"><li class="aviso">Este expediente no conserva un texto pseudonimizado reutilizable. Reincorpora la solicitud para habilitar esta asistencia.</li></ul>';
      return;
    }
    body.document_text = ctx.safe_document_text;
    body.privacy = ctx.privacy;
  } else {
    const snapshot = buildSafeCaseSnapshot(estado.expediente);
    const validation = validateSafeCaseSnapshot(snapshot);
    if (!validation.ok) {
      target.innerHTML = '<ul class="alertas"><li class="bloqueo">El snapshot no supera la frontera de privacidad. No se enviará nada.</li></ul>';
      return;
    }
    body.case_snapshot = snapshot;
    body.knowledge_context = buildKnowledgeContext(estado.sourceKnowledgeRaw, estado.expediente);
  }
  try {
    const response = await fetch('/.netlify/functions/assist-case', {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)
    });
    const payload = await response.json().catch(()=>({}));
    if (!response.ok) throw Object.assign(new Error(payload?.error?.message || `IA HTTP ${response.status}`), { code:payload?.error?.code });
    estado.currentCase.ai_results ||= {};
    estado.currentCase.ai_results[mode] = { ...payload, created_at: ahora() };
    await guardarCasoAhora({ evento: actividad('ai', mode === 'document_audit' ? 'IA 2 · auditoría documental' : 'IA 3 · mapa de cuestiones', 'Resultado asistido pendiente de revisión humana') });
    pintarAnalysis();
  } catch (error) {
    target.innerHTML = `<ul class="alertas"><li class="aviso">${esc(error.code === 'AI_NOT_CONFIGURED' ? 'La asistencia está preparada pero aún no hemos conectado la API.' : error.message)}</li></ul>`;
  }
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
  const opc = creditClassIds(estado.knowledge).map((clase) => `<option value="${clase}">${clase.replace(/_/g, ' ')}</option>`).join('');
  const rangos = [
    ['', '— no consta —'],
    ['subordinado', 'Subordinado'],
    ['ordinario', 'Ordinario'],
    ['privilegio_general', 'Privilegio general'],
    ['privilegio_especial', 'Privilegio especial'],
  ];
  const opcionesRango = (value) => rangos.map(([v, label]) => `<option value="${v}" ${String(value || '') === v ? 'selected' : ''}>${label}</option>`).join('');

  $('acreedores').innerHTML = `<div class="credit-guidance">
    <b>Crédito público</b><span>Para aplicar correctamente la exoneración por acreedor, indique la clase concursal y, si hay varios créditos de la misma clase, su fecha de origen. Los subordinados se tratan separadamente.</span>
  </div>
  <div class="tabla-scroll"><table>
    <thead><tr><th>Id</th><th>Acreedor</th><th>NIF</th><th>Concepto</th><th>Tipo</th><th>Rango concursal</th><th>Antigüedad</th><th>Importe (€)</th><th>Garantía (€)</th><th></th></tr></thead>
    <tbody>${filas.map((f, i) => {
      const src = lectura.get(f.id)?.fuente;
      return `<tr title="${esc(src ? `p. ${src.pagina}, l. ${src.linea}: ${src.texto}` : 'Añadido a mano')}">
        <td>${esc(f.id)}</td>
        <td><input data-raiz="expediente" data-ruta="creditos.${i}.acreedor" value="${esc(f.acreedor)}"></td>
        <td><input data-raiz="expediente" data-ruta="creditos.${i}.nif" value="${esc(f.nif ?? '')}"></td>
        <td><input data-raiz="expediente" data-ruta="creditos.${i}.concepto" value="${esc(f.concepto)}"></td>
        <td><select data-raiz="expediente" data-ruta="creditos.${i}.clase">${opc.replace(`value="${f.clase}"`, `value="${f.clase}" selected`)}</select></td>
        <td><select data-raiz="expediente" data-ruta="creditos.${i}.rango_concursal">${opcionesRango(f.rango_concursal)}</select></td>
        <td><input type="date" data-raiz="expediente" data-ruta="creditos.${i}.fecha_origen" value="${esc(f.fecha_origen ?? '')}"></td>
        <td class="num-col"><input data-raiz="expediente" data-ruta="creditos.${i}.importe" data-tipo="numero" value="${esc(f.importe ?? '')}"></td>
        <td class="num-col"><input data-raiz="expediente" data-ruta="creditos.${i}.valor_garantia" data-tipo="numero" value="${esc(f.valor_garantia ?? '')}" ${f.clase === 'garantia_real' ? '' : 'placeholder="—"'}></td>
        <td><button class="enlace" data-quitar="${i}" aria-label="Quitar ${esc(f.acreedor)}">Quitar</button></td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="acciones"><button id="anadir-acreedor">Añadir acreedor</button></div>
    <p class="suma" id="suma"></p>`;
  $('anadir-acreedor').onclick = () => {
    const n = estado.expediente.creditos.length + 1;
    let id = `C${n}`; while (estado.expediente.creditos.some((c) => c.id === id)) id += 'b';
    estado.expediente.creditos.push({ id, acreedor: '', nif: '', concepto: '', importe: null, clase: 'ordinario', rango_concursal: '', fecha_origen: '' });
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
  const base = plain(DATOS_JUZGADO_VACIOS);
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_JUZGADO) || 'null');
    if (g) return {
      ...base,
      ...g,
      organo: { ...base.organo, ...(g.organo || {}) },
      juez: { ...base.juez, ...(g.juez || {}) },
      procedimiento: { numero: '', nig: '' },
      fecha_resolucion: todayLocal(),
      numero_resolucion: ''
    };
  } catch {}
  return { ...base, fecha_resolucion: todayLocal() };
}
function guardarJuzgado() {
  try { const e = estado.expediente; localStorage.setItem(CLAVE_JUZGADO, JSON.stringify({ organo: e.organo, juez: e.juez })); } catch {}
}
function pintarJuzgado() {
  if (!estado.expediente.fecha_resolucion) estado.expediente.fecha_resolucion = todayLocal();
  const principal = campo({ etiqueta: 'N.º de procedimiento (opcional)', ruta: 'procedimiento.numero', fuente: false });
  const avanzados = [
    campo({ etiqueta: 'NIG (opcional)', ruta: 'procedimiento.nig', fuente: false }),
    campo({ etiqueta: 'Tribunal', ruta: 'organo.tribunal', fuente: false }),
    campo({ etiqueta: 'Sección', ruta: 'organo.seccion', fuente: false }),
    campo({ etiqueta: 'Plaza n.º', ruta: 'organo.plaza', tipo: 'entero', fuente: false }),
    campo({ etiqueta: 'Denominación histórica (opcional)', ruta: 'organo.denominacion_historica', fuente: false }),
    campo({ etiqueta: 'Localidad', ruta: 'organo.localidad', fuente: false }),
    campo({ etiqueta: 'Juez/a (opcional en borrador)', ruta: 'juez.nombre', fuente: false }),
    campo({ etiqueta: 'Cargo', ruta: 'juez.cargo', opciones: [['Magistrado', 'Magistrado'], ['Magistrada', 'Magistrada'], ['Juez', 'Juez'], ['Jueza', 'Jueza']], fuente: false }),
    campo({ etiqueta: 'Fecha del auto', ruta: 'fecha_resolucion', tipo: 'fecha', fuente: false }),
    campo({ etiqueta: 'N.º de resolución (opcional)', ruta: 'numero_resolucion', fuente: false })
  ].join('');
  $('juzgado').innerHTML = `
    <div class="minimal-court-fields">
      ${principal}
      <div class="auto-date-chip"><span>Fecha de resolución</span><b>${esc(estado.expediente.fecha_resolucion)}</b><small>se completa automáticamente con la fecha local del navegador</small></div>
    </div>
    <details class="advanced-court-fields">
      <summary>Datos avanzados de cabecera</summary>
      <p>Solo son necesarios si quieres que el borrador salga completamente identificado. Los datos del órgano y del juez se recuerdan en este navegador.</p>
      <div class="rejilla">${avanzados}</div>
    </details>`;
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
  estado.conclusion = declaracionAExpedienteConclusion(e, {
    fecha_declaracion: e.fecha_resolucion,
    fecha_resolucion: todayLocal(),
    solicitud_epi_fecha: e.solicitud.pide_epi && e.deudor.tipo === 'persona_natural' ? '' : null
  });
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
  pintarCaseHeader(); pintarOverview(); pintarAnalysis(); pintarActivity();

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

// ---------- interacción Knowledge / privacidad / IA ----------
$('ai-privacy-info')?.addEventListener('click', () => $('ai-privacy-dialog')?.showModal());
$('ai-privacy-close')?.addEventListener('click', () => $('ai-privacy-dialog')?.close());
$('ai-privacy-dialog')?.addEventListener('click', (event) => {
  if (event.target === $('ai-privacy-dialog')) $('ai-privacy-dialog').close();
});
$('knowledge-search')?.addEventListener('input', (event) => {
  knowledgeUi.query = event.target.value || '';
  pintarKnowledgeBrowser();
});
document.addEventListener('click', async (event) => {
  const section = event.target.closest('[data-knowledge-section]');
  if (section) {
    knowledgeUi.section = section.dataset.knowledgeSection;
    knowledgeUi.selected = null;
    document.querySelectorAll('[data-knowledge-section]').forEach((b)=>b.classList.toggle('active', b === section));
    pintarKnowledgeBrowser();
    return;
  }
  const item = event.target.closest('[data-knowledge-item]');
  if (item) {
    knowledgeUi.selected = Number(item.dataset.knowledgeItem);
    pintarKnowledgeBrowser();
    return;
  }
  const moduleBtn = event.target.closest('[data-knowledge-module]');
  if (moduleBtn) {
    knowledgeUi.section = 'reglas';
    knowledgeUi.query = moduleBtn.dataset.knowledgeModule;
    knowledgeUi.selected = null;
    if ($('knowledge-search')) $('knowledge-search').value = knowledgeUi.query;
    document.querySelectorAll('[data-knowledge-section]').forEach((b)=>b.classList.toggle('active', b.dataset.knowledgeSection === 'reglas'));
    pintarKnowledgeBrowser();
    return;
  }
  const jumpRule = event.target.closest('[data-jump-rule]');
  if (jumpRule) {
    setAppView('knowledge');
    knowledgeUi.section = 'reglas';
    knowledgeUi.query = jumpRule.dataset.jumpRule;
    knowledgeUi.selected = null;
    if ($('knowledge-search')) $('knowledge-search').value = knowledgeUi.query;
    pintarKnowledge();
    return;
  }
  const runAi = event.target.closest('[data-run-ai]');
  if (runAi) {
    runAi.disabled = true;
    await ejecutarAsistenciaIA(runAi.dataset.runAi);
    runAi.disabled = false;
  }
});

// ---------- inicio ----------
try { $('ai-extraction-toggle').checked = localStorage.getItem(CLAVE_EXTRACTOR_IA) === 'true'; } catch {}
$('ai-extraction-toggle')?.addEventListener('change', (event) => {
  try { localStorage.setItem(CLAVE_EXTRACTOR_IA, event.target.checked ? 'true' : 'false'); } catch {}
});
pintarKnowledge();
await cargarCasos();
setAppView('dashboard');

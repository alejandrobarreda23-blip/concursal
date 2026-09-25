// Adaptador de dominio: Knowledge base externa de concurso de persona física -> Knowledge Pack del Legal Core.
// El Core no conoce TRLC, EPI, concurso sin masa ni los ids SOL_/SM_/EPI_: esa traducción vive aquí.

const arr = (value) => Array.isArray(value) ? value : [];

function sourceVerification(value) {
  return value === true || value === 'verificado' || value === 'boe'
    ? 'verificado_con_ficha'
    : value === 'sentencia' || value === 'texto_integro'
      ? 'verificado_con_sentencia'
      : 'resumen_no_verificado';
}

function sourceMap(kb) {
  return new Map(arr(kb?.normas).map((item) => [item.id, item]));
}

function ruleMaturity(rule, sources) {
  if (rule?.tipo === 'valoracion_judicial' || rule?.tipo === 'mixta') return 'tentativo';
  const refs = arr(rule?.fundamento);
  if (!refs.length) return 'tentativo';
  return refs.every((id) => sources.get(id)?.verificado === true) ? 'regla_normativa' : 'tentativo';
}

function matterForModule(module) {
  const map = {
    solicitud_declaracion: 'solicitud_concurso_persona_fisica',
    sin_masa: 'concurso_sin_masa',
    epi_general: 'epi',
    epi_liquidacion: 'epi_liquidacion',
    epi_plan_pagos: 'epi_plan_pagos',
    liquidacion_vivienda: 'liquidacion_vivienda'
  };
  return map[module] || 'concurso_persona_fisica';
}

function procedencia(kb, sourceId) {
  return {
    origen: kb?.meta?.id || 'kb_concurso_persona_fisica',
    version_origen: kb?.meta?.version || null,
    fecha_corte_normativa: kb?.meta?.fecha_corte_normativa || null,
    source_id: sourceId
  };
}

function itemState({ fuente = 'resumen_no_verificado', madurez = 'tentativo' } = {}) {
  return { fuente, madurez };
}

function mapSources(kb) {
  return arr(kb.normas).map((n) => ({
    id: `KB.SRC.${n.id}`,
    source_id: n.id,
    tipo: 'fuente_juridica',
    titulo: n.titulo || `${n.norma || ''} ${n.art || ''}`.trim() || n.id,
    materias: ['concurso_persona_fisica'],
    cuestiones: [],
    superficie: 'decision',
    estado: itemState({
      fuente: sourceVerification(n.verificado),
      madurez: n.verificado === true ? 'regla_normativa' : 'tentativo'
    }),
    procedencia: procedencia(kb, n.id),
    norma: n.norma || null,
    articulo: n.art || null,
    literal: n.literal === true,
    verificado: n.verificado ?? null,
    texto: n.texto || '',
    nota: n.nota || null
  }));
}

function mapQuestions(kb) {
  return arr(kb.reglas).map((r) => ({
    id: `KB.Q.${r.id}`,
    source_id: r.id,
    tipo: 'cuestion_juridica',
    titulo: r.titulo || r.id,
    materias: [matterForModule(r.modulo)],
    cuestiones: [],
    superficie: 'decision',
    estado: itemState({
      fuente: arr(r.fundamento).every((id) => arr(kb.normas).find((n) => n.id === id)?.verificado === true)
        ? 'verificado_con_ficha'
        : 'resumen_no_verificado',
      madurez: r.tipo === 'automatica' ? 'regla_normativa' : 'tentativo'
    }),
    procedencia: procedencia(kb, r.id),
    modulo: r.modulo || null,
    tipo_regla_origen: r.tipo || null,
    severidad: r.severidad || null,
    mensaje: r.mensaje || null
  }));
}

function mapRules(kb) {
  const sources = sourceMap(kb);
  return arr(kb.reglas).map((r) => ({
    id: `KB.R.${r.id}`,
    source_id: r.id,
    tipo: r.tipo === 'valoracion_judicial' ? 'criterio_valorativo' : r.tipo === 'mixta' ? 'criterio_valorativo' : 'regla_determinista',
    titulo: r.titulo || r.id,
    materias: [matterForModule(r.modulo)],
    cuestiones: [`KB.Q.${r.id}`],
    superficie: 'decision',
    estado: itemState({
      fuente: arr(r.fundamento).every((id) => sources.get(id)?.verificado === true) ? 'verificado_con_ficha' : 'resumen_no_verificado',
      madurez: ruleMaturity(r, sources)
    }),
    procedencia: procedencia(kb, r.id),
    modulo: r.modulo || null,
    severidad: r.severidad || null,
    fundamento: arr(r.fundamento).map((id) => `KB.SRC.${id}`),
    condicion: r.condicion ?? null,
    sub_condiciones: arr(r.sub_condiciones),
    efecto: r.efecto ?? null,
    else: r.else ?? null,
    mensaje: r.mensaje || null,
    notas: r.notas || null
  }));
}

function mapSchemes(kb) {
  return arr(kb.checklists).map((c) => ({
    id: `KB.CHK.${c.id}`,
    source_id: c.id,
    tipo: 'esquema_probatorio',
    titulo: c.titulo || c.id,
    materias: ['concurso_persona_fisica'],
    cuestiones: [],
    superficie: 'decision',
    estado: itemState({ fuente: 'resumen_no_verificado', madurez: 'tentativo' }),
    procedencia: procedencia(kb, c.id),
    items: arr(c.items)
  }));
}

function mapPrecedents(kb) {
  return arr(kb.jurisprudencia).map((j) => ({
    id: `KB.JUR.${j.id}`,
    source_id: j.id,
    tipo: 'precedente_calibracion',
    titulo: [j.organo, j.resolucion].filter(Boolean).join(' · ') || j.id,
    materias: ['concurso_persona_fisica'],
    cuestiones: [],
    superficie: 'decision',
    estado: itemState({
      fuente: j.verificado === true || j.verificado === 'texto_integro' ? 'verificado_con_sentencia' : 'resumen_no_verificado',
      madurez: 'tentativo'
    }),
    procedencia: procedencia(kb, j.id),
    organo: j.organo || null,
    resolucion: j.resolucion || null,
    fecha: j.fecha || null,
    recurso: j.recurso || null,
    ponente: j.ponente || null,
    doctrina: arr(j.doctrina),
    aplicacion: arr(j.aplicacion),
    fuentes_web: arr(j.fuentes),
    verificado: j.verificado ?? null
  }));
}

function mapDrafting(kb) {
  return arr(kb.fundamentos_tipo).map((b, index) => ({
    id: `KB.DRAFT.${b.id}`,
    legacy_id: b.id,
    source_id: b.id,
    tipo: 'bloque_redaccion',
    titulo: b.titulo || b.id,
    materias: ['concurso_persona_fisica'],
    cuestiones: [],
    superficie: 'redaccion',
    estado: itemState({
      fuente: b.verificado === true ? 'verificado_con_ficha' : 'resumen_no_verificado',
      madurez: b.tipo === 'valoracion_judicial' ? 'tentativo' : 'regla_normativa'
    }),
    procedencia: procedencia(kb, b.id),
    perfil_redaccion: 'persona_fisica_reference',
    orden: index,
    seccion: 'fundamentos',
    variantes: ['referencia'],
    texto: b.texto || '',
    fundamento: arr(b.fundamento).map((id) => `KB.SRC.${id}`),
    nota: b.nota || null
  }));
}

function mapGaps(kb) {
  return arr(kb.pendiente_verificar).map((g, index) => ({
    id: `KB.GAP.${String(g.ref || index).replace(/[^A-Za-z0-9_.-]+/g, '_')}`,
    source_id: g.ref || String(index),
    tipo: 'hueco_sin_criterio',
    titulo: `Pendiente de verificar: ${g.ref || index}`,
    materias: ['concurso_persona_fisica'],
    cuestiones: [],
    superficie: 'gobernanza',
    estado: itemState({ fuente: 'resumen_no_verificado', madurez: 'sin_criterio' }),
    procedencia: procedencia(kb, g.ref || String(index)),
    descripcion: g.que || ''
  }));
}

export function adaptPersonaFisicaKnowledgeSource(kb) {
  if (!kb?.meta || !Array.isArray(kb?.reglas) || !Array.isArray(kb?.normas)) {
    throw new Error('Knowledge fuente de persona física inválido.');
  }
  const stats = kb.meta.estadisticas || {};
  return {
    contract_version: 'knowledge-pack-contract-v1',
    pack_id: 'KP-CONCURSAL-PERSONA-FISICA',
    version: kb.meta.version || '1.0.0',
    titulo: kb.meta.titulo || 'Knowledge — Concurso de persona física',
    materias: ['concurso_persona_fisica', 'concurso_sin_masa', 'epi', 'liquidacion_vivienda'],
    gobernanza: {
      runtime_status: 'fuente_importada_pendiente_certificacion',
      owner: kb.meta.autor || 'autor_del_corpus',
      approval_required_for_activation: true,
      evaluation_data_allowed: false,
      fecha_corte_normativa: kb.meta.fecha_corte_normativa || null,
      source_schema_version: kb.meta.esquema_version || null,
      source_id: kb.meta.id || null,
      advertencias: arr(kb.meta.advertencias),
      alcance: arr(kb.meta.alcance),
      fuera_de_alcance: arr(kb.meta.fuera_de_alcance),
      routing: {
        primary_matter: 'concurso_persona_fisica',
        accepted_profiles: ['persona_fisica', 'solicitud_declaracion', 'sin_masa', 'epi_general', 'epi_liquidacion', 'epi_plan_pagos', 'liquidacion_vivienda'],
        role: 'base',
        precedence: 50,
        load_policy: 'eager',
        extends: [],
        specializes: [],
        merge_mode: 'standalone',
        display_order: 50
      },
      catalogos: {
        variables: kb.variables || {},
        calculos: arr(kb.calculos),
        plazos: arr(kb.plazos),
        fases: arr(kb.fases),
        resoluciones: arr(kb.resoluciones),
        estadisticas_fuente: stats,
        convenciones: kb.meta.convenciones || {},
        orden_ejecucion: arr(kb.meta.orden_ejecucion)
      },
      redaccion: {
        persona_fisica_reference: {
          pack_id: 'kb-concurso-persona-fisica',
          version: kb.meta.version || '1.0.0',
          descripcion: 'Fundamentos tipo importados como referencia; no sustituyen los perfiles activos de resolución.',
          ratificacion: {
            estado: 'pendiente',
            ratificado_por: null,
            fecha: null,
            hash_bloques: null,
            nota: 'Knowledge importado: revisar y certificar antes de activar bloques de redacción.'
          },
          variables_permitidas: []
        }
      }
    },
    cuestiones: mapQuestions(kb),
    reglas: mapRules(kb),
    esquemas_probatorios: mapSchemes(kb),
    precedentes: mapPrecedents(kb),
    fuentes: mapSources(kb),
    bloques_redaccion: mapDrafting(kb),
    antipatrones: [],
    conflictos: [],
    huecos: mapGaps(kb)
  };
}

export function personaFisicaKnowledgeSummary(kb) {
  return Object.freeze({
    id: kb?.meta?.id || null,
    version: kb?.meta?.version || null,
    fecha_corte_normativa: kb?.meta?.fecha_corte_normativa || null,
    normas: arr(kb?.normas).length,
    reglas: arr(kb?.reglas).length,
    automaticas: arr(kb?.reglas).filter((r) => r.tipo === 'automatica').length,
    mixtas: arr(kb?.reglas).filter((r) => r.tipo === 'mixta').length,
    valoracion_judicial: arr(kb?.reglas).filter((r) => r.tipo === 'valoracion_judicial').length,
    fases: arr(kb?.fases).length,
    resoluciones: arr(kb?.resoluciones).length,
    fundamentos_tipo: arr(kb?.fundamentos_tipo).length,
    jurisprudencia: arr(kb?.jurisprudencia).length,
    pendiente_verificar: arr(kb?.pendiente_verificar).length
  });
}

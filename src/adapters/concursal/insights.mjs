import { evaluarIndicadoresBuenaFe } from './good-faith.mjs';

const arr = (v) => Array.isArray(v) ? v : [];
const euros = (v) => Number(v || 0);

function caseDate(caso) { return caso.updatedAt || caso.createdAt || null; }

export function concursalTags(caso) {
  const e = caso?.expediente || {};
  const tags = [];
  if (e.solicitud?.tipo === 'concurso_sin_masa') tags.push('sin masa');
  if (e.solicitud?.pide_epi) tags.push('EPI');
  if (e.solicitud?.plan_pagos) tags.push('plan de pagos');
  if (arr(e.creditos).some(c => String(c.clase).startsWith('publico_'))) tags.push('crédito público');
  if (arr(e.creditos).some(c => c.rango_concursal === 'subordinado' && String(c.clase).startsWith('publico_'))) tags.push('público subordinado');
  if (arr(e.creditos).some(c => c.clase === 'garantia_real')) tags.push('garantía real');
  if (e.deudor?.tipo === 'persona_juridica') tags.push('persona jurídica');
  return [...new Set(tags)];
}

export function buildConcursalFamilies(cases = []) {
  const groups = new Map();
  for (const caso of arr(cases)) {
    const tags = concursalTags(caso);
    const key = tags.length ? tags.sort().join('|') : 'sin-etiquetas';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(caso);
  }
  return [...groups.entries()].map(([key, rows]) => ({
    key,
    label: key === 'sin-etiquetas' ? 'Sin familia definida' : key.split('|').join(' · '),
    tags: key === 'sin-etiquetas' ? [] : key.split('|'),
    cases: rows,
    total: rows.length,
    pasivo: rows.reduce((s,c)=>s+euros(c.expediente?.solicitud?.pasivo_declarado),0),
    generated: rows.filter(c=>c.resultadoDeclaracion?.texto || c.resultadoConclusion?.texto).length,
    pending: rows.filter(c=>!(c.resultadoDeclaracion?.texto || c.resultadoConclusion?.texto)).length
  })).sort((a,b)=>b.total-a.total || a.label.localeCompare(b.label,'es'));
}

export function buildConcursalReport(cases = []) {
  const rows = arr(cases);
  const totalPasivo = rows.reduce((s,c)=>s+euros(c.expediente?.solicitud?.pasivo_declarado),0);
  const creditors = rows.reduce((s,c)=>s+arr(c.expediente?.creditos).length,0);
  return Object.freeze({
    total: rows.length,
    declaracion_generada: rows.filter(c=>c.resultadoDeclaracion?.texto).length,
    conclusion_generada: rows.filter(c=>c.resultadoConclusion?.texto).length,
    epi: rows.filter(c=>c.expediente?.solicitud?.pide_epi).length,
    credito_publico: rows.filter(c=>arr(c.expediente?.creditos).some(x=>String(x.clase).startsWith('publico_'))).length,
    garantia_real: rows.filter(c=>arr(c.expediente?.creditos).some(x=>x.clase==='garantia_real')).length,
    pasivo_total: totalPasivo,
    pasivo_medio: rows.length ? totalPasivo/rows.length : 0,
    acreedores_medio: rows.length ? creditors/rows.length : 0,
    ultima_actividad: rows.map(caseDate).filter(Boolean).sort().at(-1) || null
  });
}

export function buildReviewQueue(cases = []) {
  return arr(cases).map((caso) => {
    const goodFaith = evaluarIndicadoresBuenaFe({
      expediente: caso.expediente,
      lectura: caso.lectura,
      aiResults: caso.ai_results,
      safeDocumentText: caso.ai_context?.safe_document_text || ''
    });
    const d = caso.expediente?.decision_judicial || {};
    const needsDecision = d.competencia_verificada !== true || d.insolvencia_apreciada !== true || !d.supuesto_37_bis;
    return { caso, goodFaith, needsDecision };
  }).filter(row => row.needsDecision || row.goodFaith.estado !== 'sin_indicios_detectados')
    .sort((a,b) => {
      const rank={prioridad_alta:3,revisar:2,senal_debil:1,sin_indicios_detectados:0};
      return (rank[b.goodFaith.estado]||0)-(rank[a.goodFaith.estado]||0);
    });
}

export function buildLearningSummary(cases = []) {
  const counters = { deudor:0, nif:0, domicilio:0, pasivo:0, activo:0, acreedores:0, clase_credito:0 };
  const examples = [];
  for (const caso of arr(cases)) {
    const l=caso.lectura, e=caso.expediente;
    if(!l||!e) continue;
    const original = {
      deudor:l.campos?.deudor_nombre?.valor || '',
      nif:l.campos?.deudor_nif?.valor || '',
      domicilio:l.campos?.deudor_domicilio?.valor || '',
      pasivo:l.campos?.pasivo_declarado?.valor == null ? null : l.campos.pasivo_declarado.valor/100,
      activo:l.campos?.activo_declarado?.valor == null ? null : l.campos.activo_declarado.valor/100,
      acreedores:arr(l.acreedores).length
    };
    const changed=[];
    if(original.deudor && original.deudor!==e.deudor?.nombre){counters.deudor++;changed.push('deudor');}
    if(original.nif && original.nif!==e.deudor?.nif){counters.nif++;changed.push('NIF');}
    if(original.domicilio && original.domicilio!==e.deudor?.domicilio){counters.domicilio++;changed.push('domicilio');}
    if(original.pasivo!=null && Number(original.pasivo)!==Number(e.solicitud?.pasivo_declarado)){counters.pasivo++;changed.push('pasivo');}
    if(original.activo!=null && Number(original.activo)!==Number(e.solicitud?.activo_declarado)){counters.activo++;changed.push('activo');}
    if(original.acreedores!==arr(e.creditos).length){counters.acreedores++;changed.push('n.º acreedores');}
    const readClasses=new Map(arr(l.acreedores).map(x=>[x.id,x.clase]));
    if(arr(e.creditos).some(x=>readClasses.has(x.id)&&readClasses.get(x.id)!==x.clase)){counters.clase_credito++;changed.push('clase crédito');}
    if(changed.length) examples.push({ id:caso.id, titulo:e.procedimiento?.numero||e.deudor?.nombre||caso.id, changed });
  }
  return Object.freeze({ counters:Object.freeze(counters), examples:Object.freeze(examples.slice(0,12)), total_cases:arr(cases).length });
}

// Señales de revisión de buena fe / art. 487 TRLC.
// No decide ni califica al deudor: reúne indicadores que requieren valoración judicial.

const arr = (v) => Array.isArray(v) ? v : [];

const LEVEL = Object.freeze({ baja: 1, media: 2, alta: 3 });

function signal(id, nivel, titulo, detalle, origen, ruleIds = ['EPI_017']) {
  return Object.freeze({ id, nivel, titulo, detalle, origen, rule_ids: Object.freeze(ruleIds) });
}

function aiSignals(aiResults) {
  const findings = arr(aiResults?.document_audit?.result?.hallazgos);
  const out = [];
  const re = /ocult|fals[oa]|engaños|deuda.{0,20}(?:omit|no declar)|acreedor.{0,20}(?:omit|no declar)|patrimonio.{0,20}(?:omit|no declar)|informaci[oó]n.{0,20}(?:inexact|contradict)/i;
  for (const [i, finding] of findings.entries()) {
    const text = `${finding.categoria || ''} ${finding.descripcion || ''}`;
    if (!re.test(text)) continue;
    out.push(signal(
      `ai2-${i}`,
      finding.severidad === 'alta' ? 'alta' : 'media',
      'Posible inconsistencia relevante para buena fe',
      finding.descripcion || 'La auditoría semántica ha señalado una posible inconsistencia.',
      'IA 2 · auditor documental'
    ));
  }
  return out;
}

function localTextSignals(text) {
  const source = String(text || '');
  const patterns = [
    ['texto-ocultacion', /\bocult(?:a|aci[oó]n|ado|ar)\b/i, 'Posible referencia a ocultación', 'El documento contiene lenguaje relativo a ocultación. Debe comprobarse el contexto antes de atribuir relevancia.'],
    ['texto-falsedad', /\b(?:informaci[oó]n|datos?)\s+(?:fals[oa]s?|engaños[oa]s?|inexact[oa]s?)\b/i, 'Posible referencia a información inexacta', 'Se ha detectado una mención textual a información falsa, engañosa o inexacta.'],
    ['texto-endeudamiento', /\bendeudamiento\s+(?:temerario|negligente|irresponsable)\b/i, 'Mención a endeudamiento temerario o negligente', 'La propia documentación emplea una expresión vinculada al art. 487.1.6.º TRLC.'],
    ['texto-juego', /\b(?:apuestas?|juego\s+de\s+azar|casino|ludopat)/i, 'Posible factor personal de sobreendeudamiento', 'Aparece una referencia a juego o apuestas; es solo una señal fáctica para contextualizar el sobreendeudamiento.']
  ];
  return patterns.filter(([,re]) => re.test(source)).map(([id,,title,detail]) => signal(id, 'baja', title, detail, 'detección local'));
}

export function evaluarIndicadoresBuenaFe({ expediente = {}, lectura = {}, aiResults = {}, safeDocumentText = '' } = {}) {
  const signals = [];
  const antecedentes = expediente.antecedentes || {};

  if (antecedentes.incumplimiento_colaboracion === true) {
    signals.push(signal('colaboracion', 'alta', 'Incumplimiento de colaboración o información', 'Consta una señal estructurada de incumplimiento de los deberes de colaboración/información.', 'expediente', ['EPI_016']));
  }
  if (antecedentes.indicios_endeudamiento_temerario === true) {
    signals.push(signal('temerario', 'alta', 'Indicios de endeudamiento temerario o negligente', 'El expediente contiene una marca expresa que exige valoración judicial del art. 487.1.6.º.', 'expediente'));
  }
  if (antecedentes.informacion_falsa_enganosa === true) {
    signals.push(signal('falsa', 'alta', 'Posible información falsa o engañosa', 'El expediente contiene una marca expresa de posible información falsa o engañosa.', 'expediente'));
  }

  for (const alerta of arr(lectura.alertas)) {
    const t = String(alerta.texto || '');
    if (/suma de la relaci[oó]n de acreedores.+no coincide/i.test(t)) {
      signals.push(signal('pasivo-no-cuadra', 'media', 'El pasivo no cuadra con la relación de acreedores', t, 'lector'));
    } else if (/se declaran \d+ acreedores y se han le[ií]do/i.test(t)) {
      signals.push(signal('acreedores-no-cuadran', 'media', 'No coincide el número de acreedores', t, 'lector'));
    } else if (/no se ha encontrado la relaci[oó]n de acreedores/i.test(t)) {
      signals.push(signal('sin-relacion', 'media', 'Relación de acreedores no localizada', 'La ausencia de una relación localizable no implica mala fe, pero obliga a revisar exhaustividad y documentación.', 'lector'));
    }
  }

  signals.push(...localTextSignals(safeDocumentText), ...aiSignals(aiResults));

  const unique = [...new Map(signals.map((s) => [s.id, s])).values()];
  const max = unique.reduce((n, s) => Math.max(n, LEVEL[s.nivel] || 0), 0);
  const estado = max >= 3 ? 'prioridad_alta' : max >= 2 ? 'revisar' : max >= 1 ? 'senal_debil' : 'sin_indicios_detectados';

  const empresario = expediente.deudor?.tipo === 'persona_natural' && lectura.clasificacion?.empresario === true;
  const factors = [
    { id:'487.1.6.a', titulo:'Información patrimonial facilitada antes de obtener financiación', estado:'pendiente', nota:'Requiere documentación del préstamo/solvencia o alegación específica.' },
    { id:'487.1.6.b', titulo:'Nivel social y profesional del deudor', estado:'pendiente', nota:'No debe inferirse de forma automática.' },
    { id:'487.1.6.c', titulo:'Circunstancias personales del sobreendeudamiento', estado: unique.some(s=>s.id==='texto-juego') ? 'senal' : 'pendiente', nota:'Contextualizar el origen del endeudamiento sin convertirlo en reproche automático.' },
    { id:'487.1.6.d', titulo:'Uso de herramientas de alerta temprana', estado: empresario ? 'pendiente' : 'no_aplica', nota: empresario ? 'Relevante si el deudor ejercía actividad empresarial/profesional.' : 'Factor específico para empresarios.' },
    { id:'STS264.exhaustividad', titulo:'Exhaustividad de la relación de deudas', estado: unique.some(s=>['pasivo-no-cuadra','acreedores-no-cuadran','sin-relacion'].includes(s.id)) ? 'revisar' : 'sin_incidencia', nota:'La exhaustividad permite controlar la causa del art. 487.1.6.º; una discrepancia no equivale por sí sola a mala fe.' }
  ];

  return Object.freeze({
    estado,
    human_decision_required: true,
    rule_ids: Object.freeze(['EPI_016','EPI_017']),
    signals: Object.freeze(unique),
    factors: Object.freeze(factors),
    conclusion: estado === 'sin_indicios_detectados'
      ? 'No se han detectado indicadores automáticos; esto no equivale a declarar buena fe.'
      : 'Existen señales que aconsejan revisión judicial específica; el sistema no concluye mala fe.'
  });
}

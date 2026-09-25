// Puente entre la LECTURA de la solicitud y los expedientes de los autos.
// La lectura propone; el expediente es lo que el juez/LAJ confirma (en la página web o a mano).
// Nada de lo leído se convierte en decisión: `decision_judicial` siempre empieza vacía.

const centimosAEuros = (c) => (c == null ? null : c / 100);
const valor = (campo) => (campo == null ? null : campo.valor);

// Datos del órgano y del procedimiento que NO están en la solicitud (los pone el juzgado).
export const DATOS_JUZGADO_VACIOS = Object.freeze({
  organo: { tribunal: '', seccion: 'Sección de lo Mercantil', plaza: 1, denominacion_historica: '', localidad: '' },
  procedimiento: { numero: '', nig: '' },
  juez: { nombre: '', cargo: 'Magistrado' },
  fecha_resolucion: '',
  numero_resolucion: ''
});

export function lecturaAExpedienteDeclaracion(lectura, datosJuzgado = DATOS_JUZGADO_VACIOS) {
  const c = lectura.campos;
  const cl = lectura.clasificacion;
  const docs = lectura.documentos;
  return {
    _procedencia: {
      fichero: lectura.fichero,
      lector: lectura.version,
      reglas: lectura.reglas,
      hash_texto: lectura.hash_texto,
      hash_lectura: lectura.hash_lectura,
      nota: 'Propuesta generada por el lector determinista. Revise cada dato antes de generar el auto.'
    },
    ...structuredClone(datosJuzgado),
    deudor: {
      nombre: valor(c.deudor_nombre) || '',
      tipo: cl.persona === 'juridica' ? 'persona_juridica' : 'persona_natural',
      nif: valor(c.deudor_nif) || '',
      domicilio: valor(c.deudor_domicilio) || ''
    },
    representacion: { procurador: valor(c.procurador) || '', abogado: valor(c.abogado) || '' },
    solicitud: {
      fecha: valor(c.fecha_escrito) || '',
      tipo: cl.tipo,
      solicitante: cl.solicitante || 'deudor',
      insolvencia: cl.insolvencia || '',
      pide_epi: cl.pide_epi === true,
      plan_pagos: cl.plan_pagos === true,
      documentos: {
        poder: docs.poder?.presente === true,
        memoria: docs.memoria?.presente === true,
        inventario: docs.inventario?.presente === true,
        relacion_acreedores: docs.relacion_acreedores?.presente === true,
        formulario_anexo_i: docs.formulario_anexo_i?.presente === true
      },
      activo_declarado: centimosAEuros(valor(c.activo_declarado)),
      pasivo_declarado: centimosAEuros(valor(c.pasivo_declarado))
    },
    creditos: lectura.acreedores.map((a) => ({
      id: a.id,
      acreedor: a.acreedor,
      nif: a.nif,
      concepto: a.concepto,
      importe: centimosAEuros(a.importe),
      clase: a.clase,
      ...(a.clase === 'garantia_real' ? { valor_garantia: null } : {})
    })),
    decision_judicial: {}
  };
}

// Tras la declaración (y el trámite del art. 37 ter), el expediente de declaración
// alimenta el auto de conclusión con o sin exoneración que ya generaba el motor.
export function declaracionAExpedienteConclusion(expDecl, { fecha_declaracion, fecha_resolucion = '', numero_resolucion = '', solicitud_epi_fecha = null } = {}) {
  const natural = expDecl.deudor.tipo === 'persona_natural';
  const conEpi = natural && Boolean(solicitud_epi_fecha);
  return {
    organo: structuredClone(expDecl.organo),
    procedimiento: structuredClone(expDecl.procedimiento),
    juez: structuredClone(expDecl.juez),
    fecha_resolucion,
    numero_resolucion,
    deudor: { nombre: expDecl.deudor.nombre, tipo: expDecl.deudor.tipo },
    representacion: structuredClone(expDecl.representacion),
    tramite: {
      auto_declaracion_sin_masa: { fecha: fecha_declaracion || '' },
      solicitud_nombramiento_ac: null,          // a confirmar: no se presume
      auto_complementario_37_quinquies: null,   // a confirmar: no se presume
      solicitud_epi: conEpi ? { fecha: solicitud_epi_fecha } : null,
      ...(conEpi ? { traslado_acreedores: null, oposiciones: [] } : {})
    },
    exoneracion_previa: { existe: false },
    creditos: structuredClone(expDecl.creditos),
    decision_judicial: {}
  };
}

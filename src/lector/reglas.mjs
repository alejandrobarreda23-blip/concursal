// Reglas del lector de solicitudes (versionadas). Son datos, no código: cada una tiene un id
// que aparece en la lectura junto a la línea del PDF que la activó, para que se pueda revisar
// por qué el motor ha concluido lo que ha concluido.

export const REGLAS_VERSION = 'lector-solicitud/1.1.0';

// Clasificación de la petición. Se evalúan sobre el texto completo normalizado (minúsculas, sin tildes).
export const REGLAS_CLASIFICACION = Object.freeze([
  { id: 'TIPO.sin_masa', campo: 'sin_masa', valor: true, patron: /concurso\s+(?:voluntario\s+)?sin\s+masa|art(?:iculo|\.)?s?\s*37\s*bis/ },
  { id: 'TIPO.microempresa', campo: 'microempresa', valor: true, patron: /microempresa|procedimiento especial|art(?:iculo|\.)?\s*691/ },
  { id: 'TIPO.necesario', campo: 'solicitante', valor: 'acreedor', patron: /concurso\s+necesario/ },
  { id: 'TIPO.voluntario', campo: 'solicitante', valor: 'deudor', patron: /concurso\s+voluntario|solicitud de concurso sin masa de persona fisica/ },
  { id: 'PERSONA.fisica', campo: 'persona', valor: 'natural', patron: /persona\s+(?:fisica|natural)|\bdni\b|\bnie\b/ },
  { id: 'PERSONA.juridica', campo: 'persona', valor: 'juridica', patron: /\b(?:sociedad limitada|sociedad anonima|s\.\s?l\.\s?u?\.?|s\.\s?a\.\s?u?\.?)\s*,?\s*(?:con\s+)?(?:cif|nif)\b|en nombre y representacion de la mercantil/ },
  { id: 'EMPRESARIO', campo: 'empresario', valor: true, patron: /persona fisica (?:empresaria|comerciante)|autonom[oa]|actividad (?:empresarial|profesional)/ },
  { id: 'NO_EMPRESARIO', campo: 'empresario', valor: false, patron: /no empresari[oa]/ },
  { id: 'INSOLVENCIA.actual', campo: 'insolvencia', valor: 'actual', patron: /insolvencia\s+actual|\[x\]\s*actual/ },
  { id: 'INSOLVENCIA.inminente', campo: 'insolvencia', valor: 'inminente', patron: /insolvencia\s+inminente|\[x\]\s*inminente/ },
  { id: 'EPI.solicitada', campo: 'pide_epi', valor: true, patron: /exoneracion del pasivo insatisfecho/ },
  { id: 'EPI.plan_pagos', campo: 'plan_pagos', valor: true, patron: /plan de pagos/ },
  { id: 'FORM.icab', campo: 'formulario_icab', valor: true, patron: /anexo i\b.*formulario|formulario de solicitud de concurso sin masa/ },
  { id: 'MASA.vivienda', campo: 'indicio_masa', valor: true, patron: /titular de la vivienda|vivienda habitual.*valorad|inmueble.*valorad/ }
]);

// Documentos del art. 7 TRLC y del formulario del Anexo I (Mercantiles de Barcelona).
export const REGLAS_DOCUMENTOS = Object.freeze([
  { id: 'DOC.poder', doc: 'poder', patron: /\bpoder\b/ },
  { id: 'DOC.memoria', doc: 'memoria', patron: /\bmemoria\b/ },
  { id: 'DOC.inventario', doc: 'inventario', patron: /inventario/ },
  { id: 'DOC.relacion_acreedores', doc: 'relacion_acreedores', patron: /relacion de acreedores/ },
  { id: 'DOC.formulario_anexo_i', doc: 'formulario_anexo_i', patron: /anexo i\b/ }
]);

// Clase de crédito a partir del nombre del acreedor y del concepto.
export const REGLAS_CLASE_CREDITO = Object.freeze([
  { id: 'CLASE.garantia_real', clase: 'garantia_real', patron: /hipotec|garantia real|prendari|reserva de dominio/ },
  { id: 'CLASE.aeat', clase: 'publico_aeat', patron: /agencia (?:estatal )?(?:de administracion )?tributaria|\baeat\b|hacienda publica/ },
  { id: 'CLASE.tgss', clase: 'publico_tgss', patron: /tesoreria general de la seguridad social|\btgss\b|seguridad social/ },
  { id: 'CLASE.alimentos', clase: 'alimentos', patron: /alimentos/ },
  { id: 'CLASE.publico_otro', clase: 'publico_otro', patron: /ayuntamiento|ajuntament|diputaci|organisme de gestio tributaria|agencia tributaria de catalunya|agencia tributaria de|generalitat|consell comarcal|\bdgt\b|direccion general de trafico/ },
  { id: 'CLASE.multa', clase: 'multa_sancion', patron: /multa penal|sancion muy grave/ }
]);

// Encabezados que abren y cierran la relación de acreedores.
export const INICIO_ACREEDORES = /^(?:(?:[ivx]+|primero|segundo|tercero|cuarto|quinto|sexto|septimo|octavo|noveno|decimo)\.\s*)?(?:relacion(?:\s+simplificada)?\s+de\s+acreedores|acreedores\s*(?:,|y\b|contratos)|pasivo\b)/;
export const FIN_ACREEDORES = /^(?:(?:[ivx]+|primero|segundo|tercero|cuarto|quinto|sexto|septimo|octavo|noveno|decimo)\.\s|\d+\.\s*relacion de gastos|fundamentos|suplico|otrosi|documentos|inventario|en [a-z].*, a \d|[a-z].*, \d{1,2} de [a-z]+ de \d{4})/;

// Conserva el formato previo con decimales (la moneda puede omitirse) y admite,
// además, importes enteros cuando llevan una unidad monetaria: "18.000 EUR", "340 euros".
export const RE_IMPORTE = /(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}\s*(?:€|euros?\b|eur\b)?|(?:\d{1,3}(?:\.\d{3})*|\d+)\s*(?:€|euros?\b|eur\b)/gi;
export const RE_NIF = /\b(?:[0-9]{8}[-\s]?[A-Z]|[XYZ][0-9]{7}[-\s]?[A-Z]|[ABCDEFGHJNPQRSUVW][0-9]{7}[-\s]?[0-9A-J])\b/;
export const RE_EMAIL = /\S+@\S+\.\S+/;
export const RE_FECHA = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
export const GARANTIAS = /\b(personal|hipotecaria|real|prendaria|reserva de dominio)\s*$/i;
export const FORMA_JURIDICA = /^(.*?\b(?:S\.\s?A\.\s?U\.?|S\.\s?L\.\s?U\.?|S\.\s?A\.|S\.\s?L\.|S\.\s?C\.|SLU|SAU|SL|SA))(?=\s)\s+(.*)$/;

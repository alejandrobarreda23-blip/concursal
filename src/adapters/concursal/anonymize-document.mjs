
import { createPseudonymVault, detectDirectIdentifiers, PSEUDONYMIZATION_VERSION } from '../../core/extraction/pseudonymization.mjs';
import { documentoATextoMarcado } from './ai-extraction.mjs';

const PERSONA_EXCLUSIONS = /\b(?:Banco|Banc|Financiera|Caixa|Agencia|Tesorer[ií]a|Ayuntamiento|Ajuntament|Juzgado|Tribunal|Secci[oó]n|Registro|Bolet[ií]n|Estado|Seguridad\s+Social|Administraci[oó]n|Hacienda|Mercantil|Sociedad|Comunidad|Provincia|Ministerio|Direcci[oó]n\s+General|Concurso|Insolvencia|Exoneraci[oó]n|Pasivo|Activo|Acreedores|Antecedentes|Fundamentos)\b/i;
const ENTITY_MARKERS = /\b(?:S\.?\s*A\.?|S\.?\s*L\.?|S\.?\s*L\.?\s*U\.?|S\.?\s*C\.?|S\.?\s*Coop\.?|AIE|UTE|Fundaci[oó]n|Asociaci[oó]n)\b/i;

const rawValue = (field) => field && typeof field === 'object' && 'valor' in field ? field.valor : null;

function maskKnownFields(text, lectura, vault) {
  let out = text;
  const fields = lectura?.campos || {};
  const known = [
    ['PERSONA', rawValue(fields.deudor_nombre)],
    ['IDENTIFICADOR', rawValue(fields.deudor_nif)],
    ['DOMICILIO', rawValue(fields.deudor_domicilio)],
    ['LOCALIDAD', rawValue(fields.deudor_localidad)],
    ['PERSONA', rawValue(fields.procurador)],
    ['PERSONA', rawValue(fields.abogado)]
  ];
  for (const [category, value] of known) {
    if (value) out = vault.replaceLiteral(out, value, category, { caseInsensitive: true });
  }

  for (const creditor of lectura?.acreedores || []) {
    const name = creditor?.acreedor;
    if (!name || ENTITY_MARKERS.test(name) || PERSONA_EXCLUSIONS.test(name)) continue;
    if (/^[A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü'’.-]+(?:\s+(?:de|del|la|las|los|y)?\s*[A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü'’.-]+){1,5}$/.test(name)) {
      out = vault.replaceLiteral(out, name, 'PERSONA', { caseInsensitive: true });
    }
  }
  return out;
}

function maskStructuredIdentifiers(text, vault) {
  let out = text;
  out = vault.replaceRegex(out, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'EMAIL');
  out = vault.replaceRegex(out, /\bES\d{2}(?:[\s-]?\d{4}){5}\b/gi, 'IBAN');
  out = vault.replaceRegex(out, /\b(?:\d{8}|[XYZ]\d{7})[-\s]?[A-Z]\b/gi, 'IDENTIFICADOR');
  out = vault.replaceRegex(out, /(?<!\d)(?:\+34[\s.-]?)?(?:[6789]\d{2})(?:[\s.-]?\d{3}){2}(?!\d)/g, 'TELEFONO');
  out = vault.replaceRegex(out, /\b\d{2}[\s/-]?\d{8}[\s/-]?\d{2}\b/g, 'NSS');
  return out;
}

function maskAddresses(text, vault) {
  let out = text;
  const street = /\b(?:Calle|C\/|Carrer|Avenida|Avda\.?|Avinguda|Plaza|Plaça|Paseo|Passeig|Rambla|Carretera|Camino|Camí|Traves[ií]a|Ronda)\s+[A-ZÁÉÍÓÚÑÜ0-9][^\n;]{2,110}?(?=(?:\s*[.;]|\s+comparece\b|\s+formula\b|\s+EXPONE\b|\s+MANIFIESTA\b|$))/gim;
  out = vault.replaceRegex(out, street, 'DOMICILIO');
  return out;
}

function maskLabelledPeople(text, vault) {
  let out = text;
  out = vault.replaceRegex(
    out,
    /\b(?:D\.?ª?|Don|Doña|Dona|Sr\.?|Sra\.?)\s+([A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü'’.-]+(?:\s+(?:de|del|la|las|los|y)?\s*[A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü'’.-]+){1,5})/g,
    'PERSONA',
    (groups) => groups[1]
  );
  out = vault.replaceRegex(
    out,
    /\b(?:procurador(?:a)?|abogad[oa]|letrad[oa]|c[oó]nyuge|pareja)\s+(?:D\.?ª?|Don|Doña|Dona|Sr\.?|Sra\.?)?\s*([A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü'’.-]+(?:\s+(?:de|del|la|las|los|y)?\s*[A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü'’.-]+){1,5})/g,
    'PERSONA',
    (groups) => groups[1]
  );
  return out;
}

function maskHighRecallProperNames(text, vault) {
  const re = /\b([A-ZÁÉÍÓÚÑÜ][a-záéíóúñüàèòç'’.-]{2,}(?:\s+(?:(?:de|del|la|las|los|y)\s+)?[A-ZÁÉÍÓÚÑÜ][a-záéíóúñüàèòç'’.-]{2,}){1,4})\b/g;
  return String(text).replace(re, (whole, candidate) => {
    if (PERSONA_EXCLUSIONS.test(candidate) || ENTITY_MARKERS.test(candidate)) return whole;
    return whole.replace(candidate, vault.tokenFor(candidate, 'NOMBRE_PROPIO'));
  });
}

export function anonimizarDocumentoConcursal(doc, lecturaDeterminista) {
  const vault = createPseudonymVault();
  let text = documentoATextoMarcado(doc);

  text = maskKnownFields(text, lecturaDeterminista, vault);
  text = maskStructuredIdentifiers(text, vault);
  text = maskAddresses(text, vault);
  text = maskLabelledPeople(text, vault);
  text = maskHighRecallProperNames(text, vault);

  const leaks = detectDirectIdentifiers(text);
  const knownSensitive = [
    rawValue(lecturaDeterminista?.campos?.deudor_nombre),
    rawValue(lecturaDeterminista?.campos?.deudor_nif),
    rawValue(lecturaDeterminista?.campos?.deudor_domicilio),
    rawValue(lecturaDeterminista?.campos?.procurador),
    rawValue(lecturaDeterminista?.campos?.abogado)
  ].filter(Boolean).filter((value) =>
    String(text).toLocaleLowerCase('es').includes(String(value).toLocaleLowerCase('es'))
  );

  if (leaks.length || knownSensitive.length) {
    const error = new Error('La anonimización local no ha superado el control de fugas. No se ha enviado ningún texto al servidor.');
    error.code = 'LOCAL_PRIVACY_GUARD_FAILED';
    error.details = { pattern_leaks: leaks, known_values_remaining: knownSensitive.length };
    throw error;
  }

  const manifest = {
    ...vault.manifest(),
    asserted_no_direct_identifiers: true
  };

  return Object.freeze({
    version: PSEUDONYMIZATION_VERSION,
    text,
    manifest,
    restore: (value) => vault.restore(value),
    local_mapping_count: vault.entries().length
  });
}

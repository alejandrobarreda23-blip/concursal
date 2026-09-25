// Motor de resolución sobre Legal Core + Knowledge.
// La orquestación es estable; workflow, clasificación jurídica y redacción vienen del pack.
import { validarExpediente, advertenciasFormalesExpediente } from './validar-expediente.mjs';
import { determinarFase, ESTADOS } from './fases.mjs';
import { clasificarCreditos } from './creditos.mjs';
import { construirIR } from './resolucion-ir.mjs';
import { redactar, aTextoPlano } from './render.mjs';
import { controlesCalidad } from './controles-calidad.mjs';

export function generarAutoConclusion(expediente, { knowledge, pack = null } = {}) {
  if (!knowledge) throw new Error('generarAutoConclusion: falta Knowledge Runtime.');
  const draftPack = pack || knowledge.redactionPack('conclusion');
  const errores = validarExpediente(expediente, { knowledge });
  if (errores.length) return { estado: 'expediente_invalido', errores };

  const fase = determinarFase(expediente, { knowledge });
  if (fase.estado !== ESTADOS.LISTO) return { estado: fase.estado, variante: fase.variante, motivos: fase.motivos };

  const clasificacion = clasificarCreditos(expediente.creditos, knowledge);
  const ir = construirIR({ expediente, fase, clasificacion, pack: draftPack, knowledge });

  let documento, texto;
  try {
    documento = redactar(ir);
    texto = aTextoPlano(documento);
  } catch (err) {
    return { estado: 'error_redaccion', errores: [err.message], ir };
  }

  const controlesBase = controlesCalidad(ir, documento, texto);
  const controles = Object.freeze({
    ...controlesBase,
    avisos: [...new Set([...(controlesBase.avisos || []), ...(clasificacion.avisos || []), ...advertenciasFormalesExpediente(expediente)])]
  });
  if (!controles.ok) return { estado: 'bloqueado_por_calidad', controles, ir };

  return {
    estado: ir.procedencia.bloques_ratificados ? 'borrador' : 'borrador_no_ratificado',
    variante: ir.variante,
    ir,
    documento,
    texto,
    controles
  };
}

export { validarExpediente, determinarFase, clasificarCreditos, construirIR, redactar, aTextoPlano, controlesCalidad };

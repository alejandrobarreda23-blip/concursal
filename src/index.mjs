// Punto de entrada: expediente JSON → borrador de auto (o motivos por los que no se genera).
// Flujo: validar → fase → clasificar créditos → IR → redactar → controles de calidad.
// Cualquier fallo detiene el proceso sin producir texto (fail-closed).
import { fileURLToPath } from 'node:url';
import { validarExpediente } from './validar-expediente.mjs';
import { determinarFase, ESTADOS } from './fases.mjs';
import { clasificarCreditos } from './creditos.mjs';
import { cargarPack } from './bloques.mjs';
import { construirIR } from './resolucion-ir.mjs';
import { redactar, aTextoPlano } from './render.mjs';
import { controlesCalidad } from './controles-calidad.mjs';

export const PACK_POR_DEFECTO = fileURLToPath(new URL('../packs/concurso-sin-masa.v1.json', import.meta.url));

export function generarAuto(expediente, { pack = cargarPack(PACK_POR_DEFECTO) } = {}) {
  const errores = validarExpediente(expediente);
  if (errores.length) return { estado: 'expediente_invalido', errores };

  const fase = determinarFase(expediente);
  if (fase.estado !== ESTADOS.LISTO) return { estado: fase.estado, variante: fase.variante, motivos: fase.motivos };

  const clasificacion = clasificarCreditos(expediente.creditos);
  const ir = construirIR({ expediente, fase, clasificacion, pack });

  let documento, texto;
  try {
    documento = redactar(ir);
    texto = aTextoPlano(documento);
  } catch (err) {
    return { estado: 'error_redaccion', errores: [err.message], ir };
  }

  const controles = controlesCalidad(ir, documento, texto);
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

export { validarExpediente, determinarFase, clasificarCreditos, construirIR, redactar, aTextoPlano, controlesCalidad, cargarPack };

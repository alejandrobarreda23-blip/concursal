// Punto de entrada en Node: los mismos motores con los paquetes de bloques cargados desde disco.
import { generarAutoConclusion } from './motor.mjs';
import { generarAutoDeclaracion } from './declaracion.mjs';
import { cargarPack, PACK_POR_DEFECTO, PACK_DECLARACION } from './cargar-pack.mjs';

export function generarAuto(expediente, { pack = cargarPack(PACK_POR_DEFECTO) } = {}) {
  return generarAutoConclusion(expediente, { pack });
}

export function generarDeclaracion(expediente, { pack = cargarPack(PACK_DECLARACION) } = {}) {
  return generarAutoDeclaracion(expediente, { pack });
}

export { PACK_POR_DEFECTO, PACK_DECLARACION, cargarPack };
export * from './motor.mjs';
export { validarExpedienteDeclaracion, determinarFaseDeclaracion, SUPUESTOS_37_BIS } from './declaracion.mjs';

// Adaptador concursal sobre el motor genérico de clasificación configurado por Knowledge.
import { classifyCreditsWithKnowledge } from './core/knowledge/credit-engine.mjs';

export function exoneracionPublicaLimitada(totalCentimos, knowledge) {
  if (!knowledge) throw new Error('exoneracionPublicaLimitada: falta Knowledge Runtime.');
  const cfg = knowledge.getCatalog('creditos')?.clases?.publico_aeat;
  if (!cfg?.limit) throw new Error('Knowledge: falta límite de crédito público.');
  const { tramo_integro, maximo, porcentaje_resto } = cfg.limit;
  const integro = Math.min(totalCentimos, tramo_integro);
  const resto = Math.max(totalCentimos - tramo_integro, 0);
  return Math.min(integro + Math.floor((resto * porcentaje_resto) / 100), maximo);
}

export function clasificarCreditos(creditosRaw, knowledge) {
  if (!knowledge) throw new Error('clasificarCreditos: falta Knowledge Runtime.');
  return classifyCreditsWithKnowledge(creditosRaw, knowledge);
}

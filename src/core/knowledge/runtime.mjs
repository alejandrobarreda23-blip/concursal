import { compileKnowledgePack } from './contracts.mjs';

const arr = (value) => Array.isArray(value) ? value : [];

function byId(items) {
  return new Map(arr(items).map((item) => [item.id, item]));
}

export function createKnowledgeRuntime(compiled) {
  if (!compiled?.superficies) throw new Error('Knowledge compilado inválido.');
  const decision = compiled.superficies.decision;
  const questions = byId(decision.cuestiones);
  const rules = byId(decision.reglas);
  const sources = byId(decision.fuentes);
  const draftingBlocks = arr(compiled.superficies.redaccion.bloques_redaccion);

  return Object.freeze({
    compiled,
    pack_id: compiled.pack_id,
    version: compiled.version,
    pack_hash: compiled.pack_hash,
    getQuestion(id) { return questions.get(id) || null; },
    getRule(id) { return rules.get(id) || null; },
    getSource(id) { return sources.get(id) || null; },
    rulesForQuestion(id) { return [...rules.values()].filter((rule) => arr(rule.cuestiones).includes(id)); },
    getCatalog(name) { return compiled.gobernanza?.catalogos?.[name] || null; },
    getWorkflow(name) { return compiled.gobernanza?.workflows?.[name] || null; },
    getRedactionProfile(name) { return compiled.gobernanza?.redaccion?.[name] || null; },
    redactionPack(name) {
      const profile = compiled.gobernanza?.redaccion?.[name];
      if (!profile) throw new Error(`Perfil de redacción inexistente: ${name}`);
      const bloques = draftingBlocks
        .filter((item) => item.perfil_redaccion === name)
        .sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0))
        .map((item) => ({
          id: item.legacy_id || item.id,
          seccion: item.seccion,
          variantes: item.variantes,
          ...(item.solo_si ? { solo_si: item.solo_si } : {}),
          ...(item.block_title ? { titulo: item.block_title } : {}),
          texto: item.texto,
          ...(item.tabla ? { tabla: item.tabla } : {}),
          ...(item.legacy_has_verificar ? { verificar: item.verificar ?? null } : {})
        }));
      return {
        pack_id: profile.pack_id,
        version: profile.version,
        descripcion: profile.descripcion || compiled.titulo,
        ...(profile.extra || {}),
        ratificacion: profile.ratificacion,
        bloques
      };
    }
  });
}

export function prepareKnowledgeRuntime(pack) {
  return createKnowledgeRuntime(compileKnowledgePack(pack));
}

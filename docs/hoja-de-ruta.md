# Hoja de ruta

## Qué se ha reaprovechado de `justicia_aeroport`

| En la app | Aquí |
|---|---|
| `runtime/sha256-sync.mjs` + `knowledge/contracts.mjs` (JSON canónico + SHA-256) | `src/sha256-sync.mjs`, `src/util.mjs` |
| `criteria/resolution-ir.mjs` (IR inmutable con hash, fail-closed) | `src/resolucion-ir.mjs` |
| `criteria/writing-block-catalog.mjs` (bloques con id, hash y rechazo de plantillas sin resolver) | `src/bloques.mjs`, `packs/` |
| `criteria/ratification-domain.mjs` (ratificación humana de criterios) | `scripts/ratificar.mjs` |
| `criteria/ejcat-renderer.mjs` (IR → cuerpo de texto, fórmulas de fallo) | `src/render.mjs` |
| Máquina de Fases Procesal (trámite reglado determinista) | `src/fases.mjs` |
| Spec `human-decision-boundary` | `decision_judicial` obligatoria; nada es definitivo |
| Manifiestos de integridad | `integridad/manifiesto.json`, `scripts/integridad.mjs` |
| Tests de paridad / goldens | `test/golden/` |
| Exportación `docx` | `src/docx.mjs` |

## Próximos pasos

1. **Ratificación de los bloques** por el magistrado (citas, pie de recursos, transcripción o remisión al art. 489.1).
2. **Contraste con autos reales publicados** (CENDOJ, Mercantil de Girona): extraer la relación de créditos y comprobar que el motor reproduce las mismas cifras exoneradas.
3. **Variante: archivo de la sección de calificación** por propuesta de concurso fortuito (art. 450.6 TRLC), también frecuente en Girona.
4. **Variante: EPI con plan de pagos** y exoneración provisional.
5. **Extracción de la relación de créditos** desde la solicitud del deudor (PDF), como paso previo opcional y siempre revisable; el motor seguiría sin IA.
6. **Integración en la app** como un tipo de resolución más.

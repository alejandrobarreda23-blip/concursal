# Legal Core + Knowledge · arquitectura de concursal

## Objetivo

Separar la infraestructura procesal reutilizable del conocimiento jurídico de un procedimiento concreto. El patrón se toma de `alejandrobarreda23-blip/legal`: el runtime ejecuta contratos estables y el derecho se incorpora mediante Knowledge Packs versionados.

La regla de diseño es:

> **el Core sabe ejecutar; el Knowledge sabe derecho; el juez decide.**

## Capas

### 1. Legal Core

`src/core/` contiene piezas reutilizables que no deberían conocer el TRLC ni términos como concurso sin masa, EPI, AEAT o artículo 37 bis.

Actualmente incluye:

- contrato y compilador de Knowledge Packs;
- runtime y registro de packs;
- routing por perfiles;
- workflow declarativo;
- motor configurable de clasificación de créditos;
- política de resultado (`criterio disponible / falta prueba / conflicto / hueco`);
- frontera de decisión humana.

La redacción, IR, controles de calidad y persistencia existentes se irán aproximando progresivamente a esta frontera sin romper paridad.

### 2. Knowledge

`knowledge/runtime/concursal/concurso-sin-masa-1.0.0.json` es la fuente jurídica de runtime del dominio actual.

El contrato conserva las colecciones del proyecto `legal`:

- `cuestiones`;
- `reglas`;
- `esquemas_probatorios`;
- `precedentes`;
- `fuentes`;
- `bloques_redaccion`;
- `antipatrones`;
- `conflictos`;
- `huecos`.

Además, `gobernanza` contiene routing, catálogos operativos, workflows y perfiles de redacción.

El pack inicial es deliberadamente pequeño. Debe crecer incorporando conocimiento curado, no añadiendo condicionales al motor.

### 3. Frontera humana

La arquitectura mantiene la misma regla que `legal`: una ejecución automática nunca sustituye una decisión judicial.

En la declaración siguen siendo decisiones expresas, entre otras:

- competencia;
- apreciación de insolvencia;
- selección del supuesto del artículo 37 bis.

El Knowledge puede describir opciones y reglas, pero no rellenar esas decisiones silenciosamente.

## Qué se ha extraído ya

La primera migración mueve fuera del motor:

- catálogo de supuestos del artículo 37 bis;
- requisitos de workflow de declaración y conclusión;
- avisos por documentación incompleta;
- clases y estrategias de crédito a efectos de EPI;
- límites configurados de crédito público;
- bloques de redacción de declaración y conclusión;
- variables permitidas de cada perfil de redacción;
- fuentes y cuestiones jurídicas básicas;
- antipatrones y huecos de alcance conocidos.

## Paridad legacy

Los ficheros `packs/declaracion-sin-masa.v1.json` y `packs/concurso-sin-masa.v1.json` se mantienen, por ahora, como referencia congelada.

El gate de paridad exige que:

1. el Knowledge Pack cumpla el contrato;
2. su proyección de redacción sea estructuralmente idéntica a las plantillas legacy;
3. los workflows conserven los estados de los casos existentes;
4. la clasificación de créditos conserve los resultados;
5. los golden de resolución continúen controlando cualquier cambio visible.

Cuando esta fase esté estabilizada, esos JSON podrán convertirse en artefactos compilados o eliminarse como fuente manual.

## Cómo añadir otro procedimiento

El objetivo no es copiar `concursal`. Un nuevo dominio debería aportar:

1. un Knowledge Pack con `pack_id`, versión, routing y colecciones;
2. un catálogo de hechos que pueda producir la ingesta documental;
3. workflows declarativos;
4. cuestiones y reglas;
5. perfiles de redacción;
6. fixtures y golden propios.

Dashboard, expediente, persistencia, actividad, frontera humana y componentes del Legal Core permanecen comunes.

## Próximos incrementos previstos

La migración no intenta copiar todo `legal` de una vez. Quedan como extensiones naturales:

- catálogo formal de hechos y normalizadores;
- cobertura decisiva/condicional por cuestión;
- retriever de Knowledge por cuestión activa;
- conflictos y huecos realmente poblados;
- inspector de Knowledge en la interfaz;
- ledger/ratificación de criterio separado de la ratificación de redacción;
- persistencia de servidor cuando deje de ser suficiente el navegador;
- separación física definitiva entre adaptadores concursales y core.

La prioridad es que cada incremento preserve la paridad antes de ampliar el conocimiento.


## Knowledge fuente de persona física

Se ha incorporado como fuente canónica de trabajo:

`knowledge/source/concursal/kb-concurso-persona-fisica-1.0.0.json`

No se reescribe silenciosamente. El adaptador `src/adapters/concursal/knowledge-persona-fisica.mjs` conserva la semántica de origen y la proyecta al contrato común:

- `normas` → `fuentes`;
- `reglas` → `reglas` + una cuestión trazable por regla;
- `checklists` → `esquemas_probatorios`;
- `jurisprudencia` → `precedentes`;
- `fundamentos_tipo` → `bloques_redaccion` de referencia;
- `pendiente_verificar` → `huecos`;
- variables, cálculos, plazos, fases y resoluciones permanecen como catálogos de gobernanza.

Las reglas que el corpus califica como `valoracion_judicial` o `mixta` no se convierten en decisiones automáticas. El rule engine devuelve esas activaciones en `judicial_questions`.

El pack de paridad `KP-CONCURSAL-CSM` conserva por ahora la autoridad de runtime para los autos ya cubiertos. El nuevo `KP-CONCURSAL-PERSONA-FISICA` amplía cobertura sin alterar golden ni redacción activa hasta que se ratifiquen módulos concretos.

## Rule engine JSON Logic

`src/core/knowledge/json-logic.mjs` implementa el subconjunto determinista requerido por el corpus actual (`var`, booleanos, comparaciones, `in`, `some`, `reduce`, aritmética e `if`).

`src/core/knowledge/rule-engine.mjs` evalúa reglas sin conocer la materia jurídica y separa:

- reglas automáticas activadas;
- cuestiones que exigen decisión humana;
- efectos declarativos;
- reglas bloqueantes, de requerimiento o derivación.

El Core ejecuta expresiones; el adaptador y el Knowledge definen qué significan.

## Extracción híbrida

La extracción documental se separa también del conocimiento.

- `src/core/extraction/contracts.mjs`: contrato genérico de propuestas, evidencia, confianza y fusión.
- `src/adapters/concursal/ai-extraction.mjs`: traducción entre la propuesta estructurada y la lectura concursal.
- `netlify/functions/extract-solicitud.mjs`: endpoint server-side opcional; ninguna clave se expone al navegador.

La IA se limita a extraer hechos expresos del escrito y debe devolver evidencia de página/línea. No puede decidir competencia, insolvencia, art. 37 bis, buena fe ni EPI. El resultado es una propuesta revisable y el lector determinista permanece disponible como fallback.

La interfaz deja la extracción IA desactivada por defecto. Cuando se activa, la anonimización ocurre **antes** de la llamada a Netlify. El navegador mantiene un vault efímero con la correspondencia entre tokens y valores reales; ese vault no se persiste, no se serializa y no forma parte del body HTTP. El servidor sólo recibe el texto pseudonimizado y un manifiesto con conteos por categoría.

La función aplica defensa en profundidad: rechaza peticiones sin manifiesto de privacidad, sin pseudónimos locales o con patrones de identificadores directos detectables. El prompt del extractor ordena tratar los tokens como valores opacos y prohíbe reconstruir identidades.

Al recibir la respuesta estructurada, el navegador rehidrata los tokens localmente antes de fusionarlos con el lector determinista. Si el control local de fugas falla, no se hace ninguna petición de red.

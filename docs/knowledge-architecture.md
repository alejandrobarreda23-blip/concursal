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

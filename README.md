# autos-concurso-sin-masa

Generador **determinista** de borradores de autos de conclusión del **concurso sin masa**, con o sin **exoneración del pasivo insatisfecho (EPI)**, según el TRLC tras la Ley 16/2022.

No usa IA. Con el mismo expediente produce siempre el mismo auto, con el mismo hash, y deja constancia de por qué. Reaprovecha la arquitectura de `justicia_aeroport` (Programa 26): representación intermedia con hash, catálogo de bloques de redacción ratificables, frontera de decisión humana, funcionamiento *fail-closed* y manifiesto de integridad.

> **Estado: v0.1 básica.** Los bloques de redacción están **pendientes de ratificación**. Hasta que el magistrado los revise y ratifique (`npm run ratificar`), todo borrador sale marcado como **BORRADOR NO RATIFICADO**.

## Qué hace

```
expediente.json ─▶ validar ─▶ máquina de fases ─▶ clasificar créditos ─▶ IR (hash) ─▶ redactar ─▶ controles de calidad ─▶ .txt / .docx
```

| Paso | Módulo | Qué decide |
|---|---|---|
| Validar | `src/validar-expediente.mjs` | Que no falte ningún dato ni haya incoherencias (fechas, importes, clases, ids). No se presume nada. |
| Fase | `src/fases.mjs` | Qué auto procede (**con EPI** / **sin EPI**) o por qué no hay plantilla: oposición, solicitud de administración concursal, auto complementario del art. 37 quinquies, persona jurídica que pide EPI, exoneración previa, causas del art. 487, o falta la decisión del juez. |
| Créditos | `src/creditos.mjs` | Qué se exonera y qué no (art. 489.1 TRLC), en céntimos. Límites del crédito público AEAT/TGSS (5.000 € íntegros, 50 % hasta un tope de 10.000 € por organismo) y garantía real (solo el exceso sobre el valor de la garantía). |
| IR | `src/resolucion-ir.mjs` | Todo lo que dirá el auto, en estructura inmutable, con hash y procedencia (versión del motor, paquete, hash de los bloques, hash del expediente). |
| Redactar | `src/render.mjs` | Texto con bloques del paquete; falla si queda alguna variable sin valor. |
| Calidad | `src/controles-calidad.mjs` | Bloquea el borrador si hay restos de plantilla (`[a / b]`, `{{…}}`, `NUM000`), importes que no cuadran o no salen del expediente, partes cruzadas o numeración con saltos. |

### Lo que **no** hace (frontera de decisión humana)

- No aprecia la buena fe: el juez la confirma en `decision_judicial.buena_fe_verificada`.
- No resuelve oposiciones ni incidentes: los devuelve como `fuera_de_alcance`.
- No firma ni da nada por definitivo: el resultado es siempre un **borrador**.

## Uso

```bash
npm install
npm test                                   # integridad + 26 pruebas
node cli/generar.mjs ejemplos/01-epi-sin-oposicion.json --docx
npm run ejemplos                           # genera los 4 ejemplos en ./salida
```

Salida del CLI: estado, motivos o avisos, el texto (`.txt`), el IR (`.ir.json`) y, con `--docx`, el Word.

### Estados posibles

| Estado | Significado |
|---|---|
| `borrador` | Auto generado con bloques ratificados. |
| `borrador_no_ratificado` | Auto generado, pero los bloques aún no se han ratificado. |
| `pendiente_decision` | Falta la decisión expresa del juez. |
| `pendiente_tramite` | El procedimiento no está en fase (p. ej. falta el traslado a los acreedores). |
| `fuera_de_alcance` | Requiere otra resolución o valoración judicial. |
| `expediente_invalido` | Datos incompletos o incoherentes. |
| `bloqueado_por_calidad` | El texto no supera los controles de calidad. |

## El expediente

Ver `ejemplos/` (todos **ficticios**) y `docs/expediente.md`. Clases de crédito admitidas:

`ordinario` · `publico_aeat` · `publico_tgss` · `publico_otro` · `garantia_real` (con `valor_garantia`) · `alimentos` · `rc_extracontractual` · `rc_delito` · `salarios` · `multa_sancion` · `costas_epi`

## Ratificación de los bloques

Los textos jurídicos están en `packs/concurso-sin-masa.v1.json`. Cada bloque con una nota `verificar` señala qué hay que revisar (citas de artículos, régimen de recursos, si se transcribe la lista del art. 489.1…). Cuando estén revisados:

```bash
npm run ratificar -- "Nombre del magistrado"
npm run golden && npm run integridad && npm test
```

Si después se cambia una coma de cualquier bloque, el hash deja de coincidir y los borradores vuelven a salir como no ratificados.

## Integridad

`integridad/manifiesto.json` guarda el SHA-256 de cada fichero del motor, del paquete y de los textos de referencia. `npm test` falla si algo cambia sin actualizar el manifiesto (`npm run integridad`).

## Privacidad

No subas expedientes reales a este repositorio. `.gitignore` excluye `expedientes/` y `*.real.json`.

## Hoja de ruta

Ver `docs/hoja-de-ruta.md`.

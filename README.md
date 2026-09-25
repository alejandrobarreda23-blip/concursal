# autos-concurso-sin-masa

**Lector determinista de solicitudes de concurso** y generador de borradores de los autos del **concurso sin masa** (TRLC tras la Ley 16/2022):

1. **Declaración** de concurso sin masa (art. 37 ter), a partir de la solicitud del deudor en PDF.
2. **Conclusión**, con o sin **exoneración del pasivo insatisfecho (EPI)**, con los mismos datos.

## Arquitectura: Legal Core + Knowledge

Desde esta versión, el conocimiento jurídico del concurso sin masa deja de residir en el motor. La aplicación adopta el patrón ya utilizado en el repositorio `legal`:

- **Legal Core**: contratos, workflow, clasificación configurable, frontera de decisión humana, IR, redacción, calidad, persistencia y auditoría.
- **Knowledge Pack**: cuestiones jurídicas, reglas, fuentes, catálogos, workflows, bloques de redacción, antipatrones, conflictos y huecos.
- **Adaptadores de dominio**: traducen el expediente concursal al contrato del core, sin convertir reglas jurídicas en infraestructura.

El primer pack vive en `knowledge/runtime/concursal/concurso-sin-masa-1.0.0.json`. El runtime ya consume ese pack para los supuestos del art. 37 bis, la máquina de fases, la clasificación de créditos y las plantillas de declaración/conclusión. Los JSON de `packs/` se conservan temporalmente como fixtures de paridad legacy: las pruebas exigen que la proyección del Knowledge produzca exactamente los mismos bloques.

La idea es que un procedimiento nuevo añada un nuevo Knowledge Pack y, cuando sea necesario, un adaptador de hechos; no un motor nuevo.

## Uso rápido: arrastrar la solicitud

```bash
npm install
npm run app        # abre http://localhost:5174
```

También se puede publicar como sitio estático (Netlify lee `netlify.toml`: ejecuta `npm run build` y publica `dist/`). Aun así, el PDF se lee en el navegador de quien lo usa y no se envía a ningún servidor.

La página se abre ahora en una **bandeja concursal** inspirada en el workspace judicial del proyecto `legal`. Cada PDF incorporado crea un procedimiento local persistente en el navegador (IndexedDB, con fallback a localStorage), que puede reabrirse desde **Procedimientos**. El PDF original no se replica: se conserva la lectura estructurada, el expediente revisado, la actividad y los borradores generados.

Cada expediente se abre como workspace completo con cinco áreas: **Resumen, Solicitud, Acreedores, Resolución y Actividad**. La home prioriza la situación procesal y la siguiente actuación; la cronología queda dentro del expediente.

Arrastre el PDF de la solicitud a la bandeja. El motor:

- **clasifica la petición**: concurso sin masa u ordinario, voluntario o necesario, persona física o jurídica, insolvencia actual o inminente, si pide EPI o plan de pagos, si acompaña el formulario del Anexo I de los Mercantiles de Barcelona;
- **extrae los datos** del deudor, de la representación, las fechas, el activo y el pasivo declarados y la **relación de acreedores**, indicando la **página y la línea** del PDF de la que sale cada dato;
- **comprueba** que la suma de los acreedores cuadra con el pasivo declarado y qué documentos del art. 7 TRLC se dicen acompañar, y avisa de todo lo que no encaja.

Usted revisa y corrige, completa los datos del juzgado, marca su decisión (competencia, insolvencia, supuesto del art. 37 bis) y genera el auto de declaración. Después, con el trámite del art. 37 ter hecho, genera el de conclusión. Todo se procesa en su navegador: **el PDF no sale del ordenador**.

Solo lee PDF **con texto** (generados por ordenador). Un escaneado se rechaza con un aviso: leerlo exigiría OCR y dejaría de ser determinista.

Sin la página, por línea de comandos:

```bash
npm run leer -- solicitud.pdf                               # → salida/solicitud.lectura.json y .expediente.json
node cli/generar.mjs expediente.json --declaracion --docx   # auto de declaración
node cli/generar.mjs expediente.json --docx                 # auto de conclusión
```

Detalle del lector y de sus reglas: `docs/lector.md`.

---

## El motor de autos

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
npm test                                   # integridad + 41 pruebas
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

Los textos jurídicos están en `packs/declaracion-sin-masa.v1.json` y `packs/concurso-sin-masa.v1.json`. Cada bloque con una nota `verificar` señala qué hay que revisar (citas de artículos, régimen de recursos, si se transcribe la lista del art. 489.1…). Cuando estén revisados:

```bash
npm run ratificar -- "Nombre del magistrado"                     # auto de conclusión
npm run ratificar -- --pack declaracion "Nombre del magistrado"  # auto de declaración
npm run golden && npm run integridad && npm test
```

Si después se cambia una coma de cualquier bloque, el hash deja de coincidir y los borradores vuelven a salir como no ratificados.

## Integridad

`integridad/manifiesto.json` guarda el SHA-256 de cada fichero del motor, del paquete y de los textos de referencia. `npm test` falla si algo cambia sin actualizar el manifiesto (`npm run integridad`).

## Privacidad

No subas solicitudes ni expedientes reales a este repositorio. `.gitignore` excluye `solicitudes/`, `expedientes/`, `*.real.json` y cualquier PDF fuera de `test/fixtures/`. Las solicitudes de prueba son **ficticias** y se generan con `npm run fixtures`.

## Hoja de ruta

Ver `docs/hoja-de-ruta.md`.


## Knowledge de persona física

La fuente `knowledge/source/concursal/kb-concurso-persona-fisica-1.0.0.json` se conserva íntegra y versionada como corpus de entrada. Un adaptador de dominio la proyecta al contrato común del Legal Core sin trasladar semántica concursal a `src/core/`.

El pack importado aporta normas, reglas JSON Logic, fases, cálculos, plazos, checklists, fundamentos tipo, resoluciones, jurisprudencia y una lista explícita de extremos pendientes de verificar. Se carga junto al pack de paridad de concurso sin masa, pero no desplaza automáticamente el comportamiento ya certificado: amplía el registro de Knowledge y puede activarse por módulos a medida que se validen.

### Extracción de solicitudes

La lectura del PDF sigue teniendo un extractor local determinista como fallback. Opcionalmente puede activarse una **extracción IA asistida**:

1. PDF.js obtiene el texto y conserva marcadores de página/línea.
2. El navegador envía únicamente ese texto a una Netlify Function same-origin.
3. La función llama al proveedor configurado y exige una salida JSON estructurada.
4. La propuesta de IA se fusiona con la lectura local, conserva evidencia y confianza y queda siempre marcada como `review_required`.
5. Ninguna salida de extracción puede escribir `decision_judicial`.

La clave del proveedor vive exclusivamente en variables de entorno de Netlify. Si no existe `OPENAI_API_KEY` o el servicio falla, la aplicación continúa con el lector determinista sin bloquear el expediente.

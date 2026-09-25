# Lector de solicitudes

## Cómo lee

1. **Texto del PDF** (`src/lector/texto-pdf.mjs`): pdf.js 4.10.38, el mismo que usa justicia_aeroport. Reconstruye las líneas por su posición vertical y separa las columnas de las tablas con ` | ` cuando hay un hueco horizontal grande. Es el mismo código en el navegador y en Node.
2. **Reglas** (`src/lector/reglas.mjs`): expresiones versionadas (`lector-solicitud/1.0.0`) para clasificar la petición, detectar documentos, delimitar la relación de acreedores y asignar la clase de cada crédito. Cada regla tiene un id que aparece en la lectura.
3. **Lectura** (`src/lector/lector.mjs`): clasificación, campos, acreedores, documentos y alertas. Cada campo lleva `{ valor, regla, fuente: { pagina, linea, texto } }`. La lectura es inmutable y lleva `hash_lectura`: el mismo PDF produce siempre la misma lectura.
4. **Expediente** (`src/lector/a-expediente.mjs`): convierte la lectura en una propuesta de expediente con `decision_judicial` vacía. La lectura propone y el juez confirma.

## Qué reconoce

| Aspecto | Cómo |
|---|---|
| Tipo | «concurso sin masa», «art. 37 bis» → sin masa; «microempresa», «art. 691» → microempresas; si no, concurso ordinario |
| Solicitante | «concurso voluntario» / «concurso necesario» |
| Persona | «persona física/natural», DNI/NIE → física; forma societaria con CIF → jurídica |
| Insolvencia | «insolvencia actual/inminente» o la casilla marcada del formulario |
| EPI / plan de pagos | «exoneración del pasivo insatisfecho», «plan de pagos» |
| Formulario Anexo I | Encabezado del formulario de los Mercantiles de Barcelona (Acuerdos de diciembre de 2023) |
| Deudor | «Nombre y apellidos:» (formulario), «en nombre y representación de DON/DOÑA …» o compareciente «D./DON/DOÑA …, mayor de edad…»; DNI/NIE/NIF con o sin guion; domicilio, incluido «domicilio a efectos de … en …» |
| Partes | «…, Procurador/a de los Tribunales», «dirección letrada de …» |
| Importes | «importe global de las deudas», total de la relación de acreedores; «valor … de los bienes y derechos» y, cuando el propio escrito afirma que no hay otro activo relevante, saldo bancario único |
| Acreedores | Desde «Relación de acreedores», «Relación simplificada de acreedores» o «IV. Acreedores…» hasta el siguiente apartado, también si éste empieza por «Cuarto.», «Quinto.», etc. En cada fila: último importe, NIF, garantía, acreedor y concepto; admite «1.750,21 €» y «18.000 EUR» |
| Clase de crédito | AEAT, TGSS, ayuntamientos y otros públicos, hipoteca o garantía real, alimentos, multas; el resto, ordinario |

## Alertas

- **Bloqueo**: PDF sin texto; no es concurso sin masa; microempresas; concurso necesario.
- **Aviso**: persona jurídica, indicios de masa (vivienda), plan de pagos, deudor empresario, datos no encontrados, documentos del art. 7 no mencionados, la suma de acreedores no cuadra con el pasivo declarado, el número de acreedores no coincide, crédito con garantía real sin valor de la garantía.

## Límites conocidos

- Las tablas mal maquetadas pueden juntar columnas. El lector separa el nombre del concepto por el NIF o por la forma jurídica (S.A., S.L.…), pero conviene revisar cada fila en la página.
- Si la relación de acreedores va en un documento aparte (otro PDF), hay que arrastrar ese PDF o completar la tabla a mano.
- Las reglas se han probado con solicitudes **ficticias**. El siguiente paso es contrastarlas con 10–20 solicitudes reales **sin subirlas al repositorio** y ajustar las reglas que fallen, añadiendo cada caso como prueba anonimizada.

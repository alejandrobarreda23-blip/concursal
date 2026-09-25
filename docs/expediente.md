# Formato del expediente

```jsonc
{
  "organo": {
    "tribunal": "Tribunal de Instancia de Girona",
    "seccion": "Sección de lo Mercantil",
    "plaza": 2,
    "denominacion_historica": "Juzgado de lo Mercantil n.º 2 de Girona", // opcional
    "localidad": "Girona"
  },
  "procedimiento": { "numero": "999/2026", "nig": "…" },
  "juez": { "nombre": "…", "cargo": "Magistrado | Magistrada | Juez | Jueza" },
  "fecha_resolucion": "AAAA-MM-DD",
  "numero_resolucion": "100/2026",             // opcional
  "deudor": { "nombre": "…", "tipo": "persona_natural | persona_juridica" },
  "representacion": { "procurador": "…", "abogado": "…" }, // opcional
  "tramite": {
    "auto_declaracion_sin_masa": { "fecha": "AAAA-MM-DD" },
    "solicitud_nombramiento_ac": false,         // obligatorio: no se presume
    "auto_complementario_37_quinquies": false,  // obligatorio: no se presume
    "solicitud_epi": { "fecha": "AAAA-MM-DD" }, // null si no se ha pedido
    "traslado_acreedores": true,                // obligatorio si hay solicitud de EPI
    "oposiciones": []                           // lista (vacía si no hubo)
  },
  "exoneracion_previa": { "existe": false },
  "creditos": [
    {
      "id": "C1",
      "acreedor": "…",
      "concepto": "…",
      "importe": 12000.00,
      "clase": "ordinario",
      "valor_garantia": 60000,   // solo en garantia_real
      "vencimiento": "vencido | no_vencido"      // opcional
    }
  ],
  "decision_judicial": {
    "sentido": "conceder_epi | concluir_sin_epi",
    "buena_fe_verificada": true,     // obligatorio para conceder la EPI
    "excepciones_art_487": []        // si el juez aprecia alguna, no hay plantilla
  }
}
```

## Criterios de clasificación de créditos

| Clase | Tratamiento |
|---|---|
| `ordinario` | Se exonera íntegramente. |
| `publico_aeat`, `publico_tgss` | Se suman todos los del mismo organismo: 5.000 € íntegros + 50 % del exceso, con tope de 10.000 € exonerados. El reparto entre créditos del mismo organismo sigue el orden de `id`. |
| `garantia_real` | Se exonera solo lo que exceda de `valor_garantia`. |
| `publico_otro`, `alimentos`, `rc_extracontractual`, `rc_delito`, `salarios`, `multa_sancion`, `costas_epi` | No se exoneran. |

La clasificación la hace quien prepara el expediente; el motor aplica las reglas de forma mecánica y muestra el motivo de cada exclusión en el auto.

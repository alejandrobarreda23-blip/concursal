#!/usr/bin/env node
// Uso: node cli/leer.mjs <solicitud.pdf> [--salida carpeta]
// Lee una solicitud de concurso (PDF con texto) y escribe:
//   <nombre>.lectura.json      lo que ha leído el motor, con la línea de origen de cada dato
//   <nombre>.expediente.json   propuesta de expediente para el auto de declaración (a revisar)
import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { textoDePdf } from '../src/lector/pdf-node.mjs';
import { leerSolicitud } from '../src/lector/lector.mjs';
import { lecturaAExpedienteDeclaracion } from '../src/lector/a-expediente.mjs';

const args = process.argv.slice(2);
const ruta = args.find((a) => !a.startsWith('--'));
if (!ruta) { console.error('Uso: node cli/leer.mjs <solicitud.pdf> [--salida carpeta]'); process.exit(2); }
const iSal = args.indexOf('--salida');
const salida = iSal >= 0 ? args[iSal + 1] : 'salida';
mkdirSync(salida, { recursive: true });

const texto = await textoDePdf(ruta);
const lectura = leerSolicitud(texto, { nombre_fichero: basename(ruta) });
const base = basename(ruta).replace(/\.pdf$/i, '');
writeFileSync(join(salida, `${base}.lectura.json`), JSON.stringify(lectura, null, 2));
writeFileSync(join(salida, `${base}.expediente.json`), JSON.stringify(lecturaAExpedienteDeclaracion(lectura), null, 2));

const c = lectura.clasificacion;
console.log(`Tipo: ${c.tipo} · solicitante: ${c.solicitante ?? '—'} · persona: ${c.persona ?? '—'} · insolvencia: ${c.insolvencia ?? '—'} · pide EPI: ${c.pide_epi ? 'sí' : 'no'}`);
const mostrar = (k, v) => (Array.isArray(v) ? v.join(', ') : /declarado/.test(k) ? `${(v / 100).toFixed(2)} €` : v);
for (const [k, v] of Object.entries(lectura.campos)) console.log(`  ${k}: ${mostrar(k, v.valor)}   [p. ${v.fuente?.pagina ?? '?'}, l. ${v.fuente?.linea ?? '?'}]`);
console.log(`  Acreedores leídos: ${lectura.acreedores.length} · suma: ${(lectura.suma_acreedores / 100).toFixed(2)} €`);
for (const a of lectura.alertas) console.log(`  ${a.nivel === 'bloqueo' ? '✗' : a.nivel === 'aviso' ? '!' : 'i'} ${a.texto}`);
console.log(`Escrito: ${join(salida, base)}.lectura.json y .expediente.json`);

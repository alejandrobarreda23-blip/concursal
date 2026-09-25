// Exportación opcional a .docx con maquetación judicial sobria.
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, VerticalAlign
} from 'docx';

const FUENTE = 'Arial';
const AZUL = '294A72';
const GRIS = 'E9EDF2';
const BORDE = 'B7BDC5';
const run = (t, extra = {}) => new TextRun({ text: String(t ?? ''), font: FUENTE, size: 21, ...extra });

function runsEncabezado(texto) {
  const m = /^([^:]{1,45}:)(.*)$/.exec(String(texto));
  return m ? [run(m[1], { bold: true, size: 19 }), run(m[2], { size: 19 })] : [run(texto, { size: 19 })];
}

function celda(t, { bold = false, sombreado = null } = {}) {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    shading: sombreado ? { type: ShadingType.CLEAR, fill: sombreado } : undefined,
    margins: { top: 70, bottom: 70, left: 90, right: 90 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDE },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDE },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDE }
    },
    children: [new Paragraph({
      children: [run(t, { bold, size: 19 })],
      alignment: typeof t === 'string' && /€$/.test(t) ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { after: 0 }
    })]
  });
}

function runsDispositivo(texto) {
  const m = /^([A-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ]+)?)(\s+.*)$/.exec(String(texto));
  return m ? [run(m[1], { bold: true }), run(m[2])] : [run(texto)];
}

export function documentoWord(doc) {
  const children = [];
  for (const el of doc) {
    if (el.tipo === 'aviso') {
      // Las advertencias se muestran en la aplicación, pero no forman parte del auto descargable.
      continue;
    }
    if (el.tipo === 'encabezado') {
      children.push(new Paragraph({ children: runsEncabezado(el.texto), spacing: { after: 40 }, keepNext: true }));
    } else if (el.tipo === 'titulo') {
      const esAuto = /^AUTO\b/.test(el.texto);
      children.push(new Paragraph({
        children: [run(el.texto, { bold: true, size: esAuto ? 22 : 21, color: esAuto ? undefined : AZUL })],
        alignment: AlignmentType.LEFT,
        spacing: { before: esAuto ? 220 : 300, after: esAuto ? 100 : 140 },
        keepNext: true
      }));
    } else if (el.tipo === 'apartado') {
      const prefijo = `${el.numero}.${el.titulo ? ` ${el.titulo}.` : ''} `;
      children.push(new Paragraph({
        children: [run(prefijo, { bold: true }), run(el.texto)],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 105, line: 250 }
      }));
    } else if (el.tipo === 'dispositivo') {
      children.push(new Paragraph({
        children: [run(`${el.numero}.º `, { bold: true }), ...runsDispositivo(el.texto)],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 110, line: 250 }
      }));
    } else if (el.tipo === 'firma') {
      children.push(new Paragraph({ children: [run(el.texto)], spacing: { before: 360 } }));
    } else if (el.tipo === 'tabla') {
      const conNotas = el.lineas.some((l) => l.nota);
      const headers = conNotas ? ['N.º', 'Acreedor', 'Concepto', 'Importe', 'Observaciones'] : ['N.º', 'Acreedor', 'Concepto', 'Importe'];
      const filas = [new TableRow({ tableHeader: true, children: headers.map((h) => celda(h, { bold: true, sombreado: GRIS })) })];
      for (const l of el.lineas) {
        const datos = [String(l.n), l.acreedor, l.concepto, l.importe];
        if (conNotas) datos.push(l.nota || '');
        filas.push(new TableRow({ children: datos.map((t) => celda(t)) }));
      }
      const total = conNotas ? ['', 'TOTAL', '', el.total, ''] : ['', 'TOTAL', '', el.total];
      filas.push(new TableRow({ children: total.map((t, i) => celda(t, { bold: i === 1 || i === 3, sombreado: i === 1 || i === 3 ? 'F5F6F8' : null })) }));
      children.push(new Table({ rows: filas, width: { size: 100, type: WidthType.PERCENTAGE } }));
      children.push(new Paragraph({ children: [], spacing: { after: 80 } }));
    } else {
      children.push(new Paragraph({
        children: [run(el.texto)],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 105, line: 250 }
      }));
    }
  }
  return new Document({
    styles: { default: { document: { run: { font: FUENTE, size: 21 } } } },
    sections: [{
      properties: { page: { margin: { top: 900, right: 1050, bottom: 900, left: 1050 } } },
      children
    }]
  });
}

export const aDocx = (doc) => Packer.toBuffer(documentoWord(doc));
export const aDocxBlob = (doc) => Packer.toBlob(documentoWord(doc));

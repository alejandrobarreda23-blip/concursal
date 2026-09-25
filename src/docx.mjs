// Exportación opcional a .docx (única dependencia externa: `docx`, la misma que usa justicia_aeroport).
import { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType } from 'docx';

const FUENTE = 'Arial';
const run = (t, extra = {}) => new TextRun({ text: t, font: FUENTE, size: 22, ...extra });

function celda(t, bold = false) {
  return new TableCell({ children: [new Paragraph({ children: [run(t, { bold })] })] });
}

export function documentoWord(doc) {
  const children = [];
  for (const el of doc) {
    if (el.tipo === 'aviso') children.push(new Paragraph({ children: [run(el.texto, { bold: true, color: 'C00000' })], spacing: { after: 200 } }));
    else if (el.tipo === 'encabezado') children.push(new Paragraph({ children: [run(el.texto, { size: 18 })] }));
    else if (el.tipo === 'titulo') children.push(new Paragraph({ children: [run(el.texto, { bold: true })], alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 } }));
    else if (el.tipo === 'firma') children.push(new Paragraph({ children: [run(el.texto)], spacing: { before: 480 } }));
    else if (el.tipo === 'tabla') {
      const filas = [new TableRow({ children: ['N.º', 'Acreedor', 'Concepto', 'Importe', 'Observaciones'].map((h) => celda(h, true)) })];
      for (const l of el.lineas) filas.push(new TableRow({ children: [String(l.n), l.acreedor, l.concepto, l.importe, l.nota || ''].map((t) => celda(t)) }));
      filas.push(new TableRow({ children: ['', 'Total', '', el.total, ''].map((t, i) => celda(t, i === 1 || i === 3)) }));
      children.push(new Table({ rows: filas, width: { size: 100, type: WidthType.PERCENTAGE } }));
      children.push(new Paragraph({ children: [] }));
    } else children.push(new Paragraph({ children: [run(el.texto)], alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 } }));
  }
  return new Document({ sections: [{ children }] });
}

// Node: Buffer · Navegador: Blob
export const aDocx = (doc) => Packer.toBuffer(documentoWord(doc));
export const aDocxBlob = (doc) => Packer.toBlob(documentoWord(doc));

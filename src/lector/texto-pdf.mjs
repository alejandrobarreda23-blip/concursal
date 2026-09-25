// Extracción determinista del texto de un PDF con capa de texto (pdf.js, el mismo que usa justicia_aeroport).
// Funciona igual en Node (CLI, pruebas) y en el navegador (página de arrastrar y soltar):
// quien llama pasa la función `getDocument` de su build de pdf.js.
//
// Reconstruye líneas agrupando los fragmentos por su coordenada vertical y separa
// en columnas (" | ") los fragmentos alejados horizontalmente, para poder leer tablas.

const TOLERANCIA_Y = 2.5;      // puntos: fragmentos a esta distancia vertical están en la misma línea
const HUECO_COLUMNA = 12;      // puntos: un hueco horizontal mayor se trata como cambio de columna

function lineasDePagina(items) {
  const frags = items
    .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
    .map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width || 0, s: it.str }));
  frags.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const filas = [];
  for (const f of frags) {
    const fila = filas.find((r) => Math.abs(r.y - f.y) <= TOLERANCIA_Y);
    if (fila) fila.frags.push(f); else filas.push({ y: f.y, frags: [f] });
  }
  filas.sort((a, b) => b.y - a.y);

  return filas.map((fila) => {
    fila.frags.sort((a, b) => a.x - b.x);
    const celdas = [];
    let actual = '';
    let finAnterior = null;
    for (const f of fila.frags) {
      if (finAnterior !== null && f.x - finAnterior > HUECO_COLUMNA) { celdas.push(actual.trim()); actual = ''; }
      else if (finAnterior !== null && f.x - finAnterior > 0.5 && !actual.endsWith(' ') && !f.s.startsWith(' ')) actual += ' ';
      actual += f.s;
      finAnterior = f.x + f.w;
    }
    celdas.push(actual.trim());
    return { texto: celdas.join(' | '), celdas: celdas.filter(Boolean) };
  });
}

export async function extraerTextoPdf(bytes, getDocument) {
  const tarea = getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
  const pdf = await tarea.promise;
  const paginas = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pagina = await pdf.getPage(n);
    const contenido = await pagina.getTextContent();
    paginas.push({ pagina: n, lineas: lineasDePagina(contenido.items) });
  }
  await pdf.destroy?.();
  const caracteres = paginas.reduce((s, p) => s + p.lineas.reduce((t, l) => t + l.texto.length, 0), 0);
  return { paginas, caracteres, sin_texto: caracteres < 200 };
}

// Para textos que ya vienen en claro (pruebas, .txt): mismo formato de salida.
export function textoPlanoAPaginas(texto) {
  const paginas = String(texto).split('\f').map((p, i) => ({
    pagina: i + 1,
    lineas: p.split(/\r?\n/).filter((l) => l.trim()).map((l) => ({ texto: l.trim(), celdas: l.split(' | ').map((c) => c.trim()).filter(Boolean) }))
  }));
  const caracteres = paginas.reduce((s, p) => s + p.lineas.reduce((t, l) => t + l.texto.length, 0), 0);
  return { paginas, caracteres, sin_texto: caracteres < 200 };
}

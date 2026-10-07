// Códigos QR con una librería de JavaScript puro (qrcode-generator).
import qrcode from "qrcode-generator";

function crear(texto: string) {
  const qr = qrcode(0, "M");
  qr.addData(texto);
  qr.make();
  return qr;
}

/**
 * QR para la consola, con bloques Unicode (2 filas por línea).
 * Se dibujan los módulos CLAROS y los oscuros quedan con el fondo de la consola:
 * así se ve con la polaridad correcta en consolas oscuras (lo normal en Windows).
 */
export function qrAscii(texto: string): string {
  const qr = crear(texto);
  const n = qr.getModuleCount();
  const margen = 2;
  const claro = (r: number, c: number) => r < 0 || c < 0 || r >= n || c >= n || !qr.isDark(r, c);
  const lineas: string[] = [];
  for (let r = -margen; r < n + margen; r += 2) {
    let linea = "";
    for (let c = -margen; c < n + margen; c++) {
      const arriba = claro(r, c), abajo = claro(r + 1, c);
      linea += arriba && abajo ? "█" : arriba ? "▀" : abajo ? "▄" : " ";
    }
    lineas.push(linea);
  }
  return lineas.join("\n");
}

/** QR como imagen SVG (para la página /conectar). */
export function qrSvg(texto: string): string {
  return crear(texto).createSvgTag({ cellSize: 8, margin: 4, scalable: true });
}

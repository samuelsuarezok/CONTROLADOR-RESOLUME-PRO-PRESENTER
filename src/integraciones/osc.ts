// ============================================================
//  Codificador OSC 1.0 mínimo (JavaScript puro, sin dependencias).
//  Soporta los tipos que Resolume usa: entero (i), decimal (f) y texto (s).
// ============================================================
export type ArgOSC = { t: "i" | "f" | "s"; v: number | string };

const enc = new TextEncoder();

/** OSC pide que todo vaya alineado a múltiplos de 4 bytes. */
const alinear = (n: number) => (n + 3) & ~3;

function cadenaOSC(s: string): Uint8Array {
  const bytes = enc.encode(s);
  const salida = new Uint8Array(alinear(bytes.length + 1)); // +1 = terminador nulo
  salida.set(bytes);
  return salida;
}

export function codificarOSC(direccion: string, args: ArgOSC[] = []): Uint8Array {
  const partes: Uint8Array[] = [cadenaOSC(direccion), cadenaOSC("," + args.map((a) => a.t).join(""))];
  for (const a of args) {
    if (a.t === "s") {
      partes.push(cadenaOSC(String(a.v)));
    } else {
      const b = new Uint8Array(4);
      const dv = new DataView(b.buffer);
      if (a.t === "i") dv.setInt32(0, Math.trunc(Number(a.v)), false);
      else dv.setFloat32(0, Number(a.v), false);
      partes.push(b);
    }
  }
  const total = partes.reduce((s, p) => s + p.length, 0);
  const salida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { salida.set(p, pos); pos += p.length; }
  return salida;
}

/** Lee solo la dirección de un paquete OSC entrante (para el registro). */
export function direccionDe(paquete: Uint8Array): string {
  const fin = paquete.indexOf(0);
  return new TextDecoder().decode(paquete.subarray(0, fin < 0 ? paquete.length : fin));
}

export function describirArgs(args: ArgOSC[]): string {
  return args.map((a) => (a.t === "f" ? Number(a.v).toFixed(3) : String(a.v))).join(" ");
}

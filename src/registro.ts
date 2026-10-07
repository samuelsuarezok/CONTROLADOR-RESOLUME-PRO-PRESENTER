// Registro de actividad en memoria (últimas entradas), visible desde la interfaz.
export interface Entrada { hora: string; nivel: "info" | "ok" | "error" | "osc" | "pp"; texto: string }

const MAX = 120;
const entradas: Entrada[] = [];
let oyente: ((e: Entrada) => void) | null = null;

export function alRegistrar(fn: (e: Entrada) => void) { oyente = fn; }
export function ultimas(): Entrada[] { return entradas.slice(); }

export function registrar(nivel: Entrada["nivel"], texto: string) {
  const e: Entrada = { hora: new Date().toLocaleTimeString("es-AR", { hour12: false }), nivel, texto };
  entradas.push(e);
  if (entradas.length > MAX) entradas.shift();
  if (nivel === "error") console.log(`  [${e.hora}] ✖ ${texto}`);
  oyente?.(e);
}

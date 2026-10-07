// ============================================================
//  Genera src/embebidos.ts: lista de todos los archivos de /public.
//  Al compilar, Bun mete cada archivo DENTRO del ejecutable.
// ============================================================
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const raiz = join(import.meta.dir, "..");
const publico = join(raiz, "public");

function listar(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? listar(ruta) : [ruta];
  });
}

const archivos = listar(publico).sort();
let codigo = "// GENERADO AUTOMÁTICAMENTE por scripts/embeber.ts — no editar a mano.\n";
// TypeScript no entiende los imports `with { type: "file" }` (Bun los convierte en rutas): se omite el chequeo de tipos.
codigo += "// @ts-nocheck\n";
archivos.forEach((a, i) => {
  codigo += `import f${i} from "../public/${relative(publico, a).split(sep).join("/")}" with { type: "file" };\n`;
});
codigo += "\n/** Ruta web -> archivo embebido en el ejecutable. */\nexport const ARCHIVOS: Record<string, string> = {\n";
archivos.forEach((a, i) => {
  codigo += `  "/${relative(publico, a).split(sep).join("/")}": f${i},\n`;
});
codigo += "};\n";

writeFileSync(join(raiz, "src", "embebidos.ts"), codigo);
console.log(`Embebidos: ${archivos.length} archivos de /public`);

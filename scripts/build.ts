// ============================================================
//  Genera los ejecutables de un solo archivo en /dist.
//  Uso:  bun scripts/build.ts [win|mac|todo]     (por defecto: todo)
//  Nota: la primera vez, Bun descarga el "runtime" de cada plataforma
//  (hace falta internet SOLO para compilar, nunca para usar el panel).
// ============================================================
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const raiz = join(import.meta.dir, "..");
const destinos = [
  { grupo: "win", target: "bun-windows-x64", salida: "Panel-Cabina-win-x64.exe" },
  { grupo: "mac", target: "bun-darwin-arm64", salida: "Panel-Cabina-mac-arm64" },
  { grupo: "mac", target: "bun-darwin-x64", salida: "Panel-Cabina-mac-x64" },
];
const pedido = process.argv[2] ?? "todo";
const elegidos = destinos.filter((d) => pedido === "todo" || d.grupo === pedido);
if (!elegidos.length) { console.error("Uso: bun scripts/build.ts [win|mac|todo]"); process.exit(1); }

mkdirSync(join(raiz, "dist"), { recursive: true });

// 1) Lista de archivos del frontend para embeber
let r = Bun.spawnSync(["bun", join(raiz, "scripts", "embeber.ts")], { cwd: raiz, stdout: "inherit", stderr: "inherit" });
if (r.exitCode !== 0) process.exit(1);

// 2) Un ejecutable por plataforma
let fallo = false;
for (const d of elegidos) {
  console.log(`\n▶ Compilando ${d.salida} (${d.target})…`);
  const args = ["build", "--compile", "--minify", `--target=${d.target}`, "src/main.ts", "--outfile", join("dist", d.salida)];
  r = Bun.spawnSync(["bun", ...args], { cwd: raiz, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode === 0) console.log(`  ✔ dist/${d.salida}  (${(statSync(join(raiz, "dist", d.salida)).size / 1048576).toFixed(0)} MB)`);
  else { console.error(`  ✖ Falló ${d.salida}`); fallo = true; }
}
console.log(fallo ? "\nTerminó con errores." : "\nListo. Los ejecutables están en la carpeta dist/");
process.exit(fallo ? 1 : 0);

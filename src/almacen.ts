// ============================================================
//  Almacén de datos: archivos JSON en la carpeta /data que está
//  AL LADO del ejecutable (así todo viaja en un pendrive).
//  Escritura a prueba de cortes: archivo temporal + renombrar,
//  y se conserva una copia de respaldo (.bak) del archivo anterior.
// ============================================================
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// ¿Estamos corriendo el ejecutable compilado o con "bun src/main.ts"?
const nombreExe = basename(process.execPath).toLowerCase();
export const ES_COMPILADO = !/^(bun|node)(\.exe)?$/.test(nombreExe);

/** Carpeta base: junto al .exe (compilado) o la carpeta del proyecto (desarrollo). */
export const CARPETA_BASE = ES_COMPILADO ? dirname(process.execPath) : process.cwd();
export const CARPETA_DATOS = join(CARPETA_BASE, "data");

try {
  mkdirSync(CARPETA_DATOS, { recursive: true });
} catch (e) {
  console.error("No se pudo crear la carpeta de datos:", CARPETA_DATOS, e);
}

function leerArchivo(ruta: string): any | undefined {
  try {
    if (!existsSync(ruta)) return undefined;
    return JSON.parse(readFileSync(ruta, "utf8"));
  } catch {
    return undefined; // archivo dañado: se intentará con el respaldo
  }
}

/** Lee data/<nombre>.json; si está dañado usa el .bak; si no existe, usa el valor por defecto. */
export function leerJSON<T>(nombre: string, porDefecto: T): T {
  const ruta = join(CARPETA_DATOS, nombre + ".json");
  const datos = leerArchivo(ruta) ?? leerArchivo(ruta + ".bak");
  return (datos ?? porDefecto) as T;
}

/** Escritura inmediata y atómica. */
export function guardarJSONYa(nombre: string, datos: unknown): void {
  const ruta = join(CARPETA_DATOS, nombre + ".json");
  const tmp = ruta + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(datos, null, 2), "utf8");
    if (existsSync(ruta)) copyFileSync(ruta, ruta + ".bak");
    renameSync(tmp, ruta); // el renombrado es atómico: nunca queda un archivo a medias
  } catch (e) {
    console.error(`[almacén] Error guardando ${nombre}.json:`, e);
  }
}

// Guardado diferido (agrupa muchos cambios seguidos, p. ej. mover un fader).
const pendientes = new Map<string, { datos: unknown; timer: ReturnType<typeof setTimeout> }>();

export function guardarJSON(nombre: string, datos: unknown, esperaMs = 300): void {
  const previo = pendientes.get(nombre);
  if (previo) clearTimeout(previo.timer);
  const timer = setTimeout(() => {
    pendientes.delete(nombre);
    guardarJSONYa(nombre, datos);
  }, esperaMs);
  pendientes.set(nombre, { datos, timer });
}

/** Fuerza el guardado de todo lo pendiente (al cerrar el programa). */
export function vaciarPendientes(): void {
  for (const [nombre, p] of pendientes) {
    clearTimeout(p.timer);
    guardarJSONYa(nombre, p.datos);
  }
  pendientes.clear();
}

// ============================================================
//  Configuración (botonera + ajustes) y operaciones de edición.
//  El servidor es la única fuente de verdad: los clientes piden
//  cambios con "operaciones" y el servidor las valida y aplica.
// ============================================================
import { guardarJSON, leerJSON } from "./almacen";

export const PUERTO_POR_DEFECTO = 3002;

// ---------- Tipos de acción permitidos ----------
export const TIPOS_ACCION = [
  "pp_siguiente", "pp_anterior", "pp_slide", "pp_limpiar_todo", "pp_limpiar_texto",
  "pp_limpiar_fondo", "pp_msg_stage", "pp_ocultar_msg",
  "rs_columna", "rs_clip", "rs_limpiar_capa", "rs_desconectar_todo", "rs_opacidad_capa", "rs_opacidad_master", "rs_osc",
  "espera",
] as const;

export interface Accion { tipo: string; [campo: string]: any }
export interface Boton {
  id: string; texto: string; icono: string; color: string;
  confirmar: boolean; acciones: Accion[];
}
export interface Pagina { id: string; nombre: string; botones: Boton[] }

export interface Ajustes {
  simulacion: boolean;
  resolume: { ip: string; puerto: number; puertoEntrada: number };
  propresenter: {
    ip: string; puerto: number; passRemoto: string;
    usarStage: boolean; puertoStage: number; passStage: string;
  };
  /** Direcciones OSC. {n} = número, {capa} y {clip} = números de capa y clip. */
  osc: {
    columna: string; clip: string; limpiarCapa: string;
    opacidadCapa: string; opacidadMaster: string; desconectarTodo: string;
  };
  manual: { columnas: number; capas: number };
}

export interface Config { version: 1; pin: string; ajustes: Ajustes; paginas: Pagina[] }

export const PIN_POR_DEFECTO = "1234";

export const ajustesPorDefecto = (): Ajustes => ({
  simulacion: false,
  resolume: { ip: "127.0.0.1", puerto: 7000, puertoEntrada: 0 },
  propresenter: {
    ip: "127.0.0.1", puerto: 50001, passRemoto: "",
    usarStage: true, puertoStage: 0, passStage: "",
  },
  osc: {
    columna: "/composition/columns/{n}/connect",
    clip: "/composition/layers/{capa}/clips/{clip}/connect",
    limpiarCapa: "/composition/layers/{n}/clear",
    opacidadCapa: "/composition/layers/{n}/video/opacity",
    opacidadMaster: "/composition/master",
    desconectarTodo: "/composition/disconnectall",
  },
  manual: { columnas: 8, capas: 4 },
});

export const nuevoId = () => crypto.randomUUID().slice(0, 8);

// ---------- Botonera de ejemplo (primera vez) ----------
function configInicial(): Config {
  const b = (texto: string, icono: string, color: string, acciones: Accion[], confirmar = false): Boton =>
    ({ id: nuevoId(), texto, icono, color, confirmar, acciones });
  return {
    version: 1,
    pin: PIN_POR_DEFECTO,
    ajustes: ajustesPorDefecto(),
    paginas: [
      { id: nuevoId(), nombre: "Alabanza", botones: [
        b("Letras siguiente", "⏭️", "#2563eb", [{ tipo: "pp_siguiente" }]),
        b("Letras anterior", "⏮️", "#475569", [{ tipo: "pp_anterior" }]),
        b("Fondo 1", "🌅", "#7c3aed", [{ tipo: "rs_columna", n: 1 }]),
        b("Fondo 2", "🌌", "#7c3aed", [{ tipo: "rs_columna", n: 2 }]),
        b("Limpiar letras", "🧹", "#b45309", [{ tipo: "pp_limpiar_texto" }]),
      ] },
      { id: nuevoId(), nombre: "Prédica", botones: [
        b("Inicio de prédica", "📖", "#0f766e", [
          { tipo: "pp_limpiar_texto" },
          { tipo: "rs_columna", n: 3 },
          { tipo: "espera", ms: 500 },
          { tipo: "rs_opacidad_master", valor: 40 },
        ]),
        b("Fin de prédica", "🙏", "#0369a1", [
          { tipo: "rs_opacidad_master", valor: 100 },
          { tipo: "rs_columna", n: 1 },
        ]),
      ] },
      { id: nuevoId(), nombre: "Anuncios", botones: [
        b("Mostrar aviso", "📢", "#be185d", [{ tipo: "pp_msg_stage", texto: "Anuncios en unos minutos" }]),
        b("Ocultar aviso", "🚫", "#475569", [{ tipo: "pp_ocultar_msg" }]),
      ] },
      { id: nuevoId(), nombre: "Emergencia", botones: [
        b("Limpiar TODO", "🛑", "#b91c1c", [
          { tipo: "pp_limpiar_todo" },
          { tipo: "rs_desconectar_todo" },
        ], true),
        b("Pantalla negra", "⬛", "#111827", [
          { tipo: "pp_limpiar_todo" },
          { tipo: "rs_opacidad_master", valor: 0 },
        ], true),
        b("Restaurar brillo", "🔆", "#15803d", [{ tipo: "rs_opacidad_master", valor: 100 }]),
      ] },
    ],
  };
}

// ---------- Estado del servidor ----------
let config: Config = normalizar(leerJSON<any>("config", null) ?? configInicial());
let rev = 1;
guardarJSON("config", config);

export const obtenerConfig = () => config;
export const obtenerRev = () => rev;

/** Parte de la configuración que pueden ver TODOS los clientes (sin PIN ni contraseñas). */
export const vistaPublica = () => ({ rev, paginas: config.paginas, manual: config.ajustes.manual });

function guardar() { rev++; guardarJSON("config", config); }

// ---------- Validación / normalización ----------
function txt(v: any, max: number, def = ""): string { return (typeof v === "string" ? v : def).slice(0, max); }
function num(v: any, def: number, min = -1e9, max = 1e9): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
function color(v: any): string { return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : "#334155"; }
/** IP o nombre de la compu. Acepta errores comunes como "http://192.168.1.20:50001/" y deja solo "192.168.1.20". */
function host(v: any, def: string): string {
  let s = txt(v, 100, def).trim().replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
  if (/^[^:]+:\d*$/.test(s)) s = s.slice(0, s.indexOf(":"));
  return s.replace(/\s+/g, "") || def;
}

export function limpiarAccion(a: any): Accion | null {
  if (!a || typeof a !== "object") return null;
  const tipo = a.tipo;
  if (!(TIPOS_ACCION as readonly string[]).includes(tipo)) return null;
  const r: Accion = { tipo };
  switch (tipo) {
    case "pp_slide": r.ruta = txt(a.ruta, 500); r.diapositiva = num(a.diapositiva, 1, 1, 9999); break;
    case "pp_msg_stage": r.texto = txt(a.texto, 300); break;
    case "rs_columna": r.n = num(a.n, 1, 1, 999); break;
    case "rs_clip": r.capa = num(a.capa, 1, 1, 999); r.clip = num(a.clip, 1, 1, 999); break;
    case "rs_limpiar_capa": r.n = num(a.n, 1, 1, 999); break;
    case "rs_opacidad_capa": r.n = num(a.n, 1, 1, 999); r.valor = num(a.valor, 100, 0, 100); break;
    case "rs_opacidad_master": r.valor = num(a.valor, 100, 0, 100); break;
    case "rs_osc":
      r.direccion = txt(a.direccion, 300); r.tipoValor = ["f", "i", "s", "ninguno"].includes(a.tipoValor) ? a.tipoValor : "f";
      r.valor = txt(String(a.valor ?? ""), 200); break;
    case "espera": r.ms = num(a.ms, 500, 0, 60000); break;
  }
  return r;
}

function limpiarBoton(b: any, idPrevio?: string): Boton {
  return {
    id: idPrevio ?? (typeof b?.id === "string" && b.id ? b.id.slice(0, 16) : nuevoId()),
    texto: txt(b?.texto, 60, "Botón"),
    icono: txt(b?.icono, 12),
    color: color(b?.color),
    confirmar: !!b?.confirmar,
    acciones: (Array.isArray(b?.acciones) ? b.acciones : []).slice(0, 60).map(limpiarAccion).filter(Boolean) as Accion[],
  };
}

function limpiarAjustes(a: any, base: Ajustes): Ajustes {
  const d = ajustesPorDefecto();
  const o = { ...d.osc, ...(base.osc ?? {}) };
  for (const k of Object.keys(d.osc) as (keyof Ajustes["osc"])[]) {
    if (typeof a?.osc?.[k] === "string") o[k] = txt(a.osc[k], 300, d.osc[k]) || d.osc[k];
  }
  const pp = a?.propresenter ?? {}, rs = a?.resolume ?? {}, man = a?.manual ?? {};
  const bpp = base.propresenter, brs = base.resolume;
  return {
    simulacion: a?.simulacion === undefined ? base.simulacion : !!a.simulacion,
    resolume: {
      ip: host(rs.ip, brs.ip),
      puerto: num(rs.puerto, brs.puerto, 1, 65535),
      puertoEntrada: num(rs.puertoEntrada, brs.puertoEntrada, 0, 65535),
    },
    propresenter: {
      ip: host(pp.ip, bpp.ip),
      puerto: num(pp.puerto, bpp.puerto, 1, 65535),
      passRemoto: txt(pp.passRemoto, 100, bpp.passRemoto),
      usarStage: pp.usarStage === undefined ? bpp.usarStage : !!pp.usarStage,
      puertoStage: num(pp.puertoStage, bpp.puertoStage, 0, 65535),
      passStage: txt(pp.passStage, 100, bpp.passStage),
    },
    osc: o,
    manual: {
      columnas: num(man.columnas, base.manual.columnas, 1, 32),
      capas: num(man.capas, base.manual.capas, 1, 12),
    },
  };
}

function normalizar(c: any): Config {
  const d = ajustesPorDefecto();
  const ajustes = limpiarAjustes(c?.ajustes ?? {}, d);
  let paginas: Pagina[] = (Array.isArray(c?.paginas) ? c.paginas : []).slice(0, 40).map((p: any) => ({
    id: typeof p?.id === "string" && p.id ? p.id.slice(0, 16) : nuevoId(),
    nombre: txt(p?.nombre, 40, "Página"),
    botones: (Array.isArray(p?.botones) ? p.botones : []).slice(0, 200).map((b: any) => limpiarBoton(b)),
  }));
  if (!paginas.length) paginas = [{ id: nuevoId(), nombre: "Principal", botones: [] }];
  return { version: 1, pin: txt(c?.pin, 20, PIN_POR_DEFECTO) || PIN_POR_DEFECTO, ajustes, paginas };
}

// ---------- Búsqueda ----------
export function buscarBoton(id: string): Boton | undefined {
  for (const p of config.paginas) { const b = p.botones.find((x) => x.id === id); if (b) return b; }
}

// ---------- Operaciones de edición (solo modo editor) ----------
const mover = <T,>(arr: T[], i: number, dir: number) => {
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j]!, arr[i]!];
};

/** Aplica una operación de edición. Lanza Error con un mensaje claro si no es válida. */
export function aplicarOperacion(op: any): { cambioAjustes?: boolean } {
  const pag = (id: string) => {
    const p = config.paginas.find((x) => x.id === id);
    if (!p) throw new Error("La página ya no existe");
    return p;
  };
  let cambioAjustes = false;

  switch (op?.op) {
    case "pagina.nueva":
      config.paginas.push({ id: nuevoId(), nombre: txt(op.nombre, 40, "Nueva página"), botones: [] });
      break;
    case "pagina.guardar": pag(op.id).nombre = txt(op.nombre, 40, "Página"); break;
    case "pagina.duplicar": {
      const p = pag(op.id);
      const copia: Pagina = {
        id: nuevoId(), nombre: txt(p.nombre + " (copia)", 40),
        botones: p.botones.map((b) => ({ ...structuredClone(b), id: nuevoId() })),
      };
      config.paginas.splice(config.paginas.indexOf(p) + 1, 0, copia);
      break;
    }
    case "pagina.borrar":
      if (config.paginas.length <= 1) throw new Error("Tiene que quedar al menos una página");
      config.paginas = config.paginas.filter((p) => p.id !== op.id);
      break;
    case "pagina.mover": mover(config.paginas, config.paginas.findIndex((p) => p.id === op.id), op.dir); break;

    case "boton.guardar": {
      const p = pag(op.pagina);
      const i = p.botones.findIndex((b) => b.id === op.boton?.id);
      if (i >= 0) p.botones[i] = limpiarBoton(op.boton, p.botones[i]!.id);
      else p.botones.push(limpiarBoton({ ...op.boton, id: undefined }));
      break;
    }
    case "boton.borrar": { const p = pag(op.pagina); p.botones = p.botones.filter((b) => b.id !== op.id); break; }
    case "boton.duplicar": {
      const p = pag(op.pagina);
      const i = p.botones.findIndex((b) => b.id === op.id);
      if (i < 0) throw new Error("El botón ya no existe");
      p.botones.splice(i + 1, 0, { ...structuredClone(p.botones[i]!), id: nuevoId(), texto: txt(p.botones[i]!.texto + " (copia)", 60) });
      break;
    }
    case "boton.mover": { const p = pag(op.pagina); mover(p.botones, p.botones.findIndex((b) => b.id === op.id), op.dir); break; }

    case "ajustes.guardar": config.ajustes = limpiarAjustes(op.ajustes, config.ajustes); cambioAjustes = true; break;
    case "pin.cambiar": {
      const nuevo = String(op.nuevo ?? "");
      // Solo números: el teclado del PIN en el celular es numérico.
      if (!/^[0-9]{4,12}$/.test(nuevo)) throw new Error("El PIN debe tener entre 4 y 12 números");
      config.pin = nuevo;
      break;
    }
    case "importar": {
      if (!Array.isArray(op.datos?.paginas)) throw new Error("El archivo no es una configuración válida");
      const nueva = normalizar({ ...op.datos, pin: config.pin }); // el PIN actual se conserva
      config = nueva;
      cambioAjustes = true;
      break;
    }
    default: throw new Error("Operación desconocida");
  }
  guardar();
  return { cambioAjustes };
}

/** Exportación completa (sin el PIN, para poder compartir el archivo sin riesgo). */
export function exportarConfig() {
  const { pin, ...resto } = config;
  return resto;
}

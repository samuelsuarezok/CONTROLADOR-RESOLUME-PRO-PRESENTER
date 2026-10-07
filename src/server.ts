// ============================================================
//  Servidor HTTP + WebSocket. Es la ÚNICA fuente de verdad:
//  los clientes envían órdenes y el servidor difunde el resultado.
// ============================================================
import type { Server, ServerWebSocket } from "bun";
import { ejecutarAccion, ejecutarBoton, type Contexto } from "./acciones";
import { guardarJSON, leerJSON } from "./almacen";
import {
  aplicarOperacion, buscarBoton, exportarConfig, limpiarAccion, obtenerConfig, PIN_POR_DEFECTO, vistaPublica,
  type Accion,
} from "./config";
import { ARCHIVOS } from "./embebidos";
import { ProPresenter } from "./integraciones/propresenter";
import { Resolume } from "./integraciones/resolume";
import { ipsLocales } from "./red";
import { qrSvg } from "./qr";
import { alRegistrar, registrar, ultimas } from "./registro";

export const APP_NOMBRE = "Panel Cabina";
export const APP_VERSION = "1.1.0";

interface DatosWS { id: number; ip: string; editor: boolean }
type WS = ServerWebSocket<DatosWS>;

// ---------- Estado de los controles manuales (se recupera al reiniciar) ----------
interface EstadoManual { master: number; capas: Record<string, number> }
const estado: EstadoManual = leerJSON<EstadoManual>("estado", { master: 100, capas: {} });
estado.capas ??= {};

// ---------- Integraciones ----------
let difusionPendiente: ReturnType<typeof setTimeout> | null = null;
const estadoConexiones = () => ({ pp: pp.info(), rs: { estado: rs.estado, detalle: rs.detalle } });
/** Agrupa cambios de estado muy seguidos (p. ej. el reloj) en un solo envío. */
function difundirConexiones() {
  if (difusionPendiente) return;
  difusionPendiente = setTimeout(() => { difusionPendiente = null; publicar({ t: "con", ...estadoConexiones() }); }, 120);
}
const pp = new ProPresenter(difundirConexiones);
const rs = new Resolume(difundirConexiones);
const ctx: Contexto = { pp, rs, ajustes: () => obtenerConfig().ajustes };

function aplicarAjustes() {
  const a = obtenerConfig().ajustes;
  rs.configurar(a);
  pp.configurar(a);
}

// ---------- Difusión ----------
const sockets = new Set<WS>();
let servidor: Server<DatosWS>;
const publicar = (msg: unknown) => servidor?.publish("todos", JSON.stringify(msg));
const aEditores = (msg: unknown) => { const s = JSON.stringify(msg); for (const w of sockets) if (w.data.editor) w.send(s); };
const responder = (ws: WS, msg: unknown) => ws.send(JSON.stringify(msg));

alRegistrar((e) => publicar({ t: "log", e }));

const msgAjustesEditor = () => {
  const c = obtenerConfig();
  return { t: "ajustes", ajustes: c.ajustes, pinPorDefecto: c.pin === PIN_POR_DEFECTO };
};

// ---------- Protección del PIN (contra tanteos) ----------
const intentos = new Map<string, { fallos: number; hasta: number }>();

// ---------- Ejecución de botones ----------
const enCurso = new Set<string>();

async function ejecutarPorId(id: string) {
  const boton = buscarBoton(id);
  if (!boton) { publicar({ t: "ejec", id, fase: "fin", ok: false, pasos: [{ paso: 0, descripcion: "", ok: false, error: "El botón ya no existe" }] }); return; }
  if (enCurso.has(id)) return; // evita doble toque accidental mientras corre
  enCurso.add(id);
  registrar("info", `▶ Botón "${boton.texto}"`);
  publicar({ t: "ejec", id, fase: "inicio", total: boton.acciones.length });
  try {
    const res = await ejecutarBoton(boton, ctx, (r, total) => {
      const a = boton.acciones[r.paso - 1];
      if (r.ok && a) registrarOpacidad(a);
      if (!r.ok) registrar("error", `"${boton.texto}" paso ${r.paso}: ${r.error}`);
      publicar({ t: "ejec", id, fase: "paso", paso: r.paso, total, ok: r.ok });
    });
    registrar(res.ok ? "ok" : "error", `${res.ok ? "✔" : "✖"} "${boton.texto}" ${res.ok ? "completo" : "terminó con errores"}`);
    publicar({ t: "ejec", id, fase: "fin", ok: res.ok, pasos: res.pasos });
  } finally {
    enCurso.delete(id);
  }
}

/** Si una acción cambia una opacidad, se refleja en los faders del Control manual. */
function registrarOpacidad(a: { tipo: string; [k: string]: any }) {
  if (a.tipo === "rs_opacidad_master") estado.master = Number(a.valor);
  else if (a.tipo === "rs_opacidad_capa") estado.capas[String(a.n)] = Number(a.valor);
  else return;
  guardarJSON("estado", estado);
  publicar({ t: "estado", estado });
}

// ---------- Mensajes de los clientes ----------
async function alMensaje(ws: WS, crudo: string) {
  let m: any;
  try { m = JSON.parse(crudo); } catch { return; }
  const necesitaEditor = () => { if (!ws.data.editor) { responder(ws, { t: "error", msg: "Hace falta el modo edición (PIN)" }); return false; } return true; };

  switch (m.t) {
    case "ping": responder(ws, { t: "pong" }); break;

    case "pin": {
      const ip = ws.data.ip, reg = intentos.get(ip) ?? { fallos: 0, hasta: 0 };
      if (Date.now() < reg.hasta) { responder(ws, { t: "editor", ok: false, msg: "Demasiados intentos. Esperá unos segundos." }); break; }
      if (String(m.pin) === obtenerConfig().pin) {
        intentos.delete(ip);
        ws.data.editor = true;
        responder(ws, { t: "editor", ok: true });
        responder(ws, msgAjustesEditor());
      } else {
        reg.fallos++;
        if (reg.fallos >= 5) { reg.hasta = Date.now() + 30000; reg.fallos = 0; }
        intentos.set(ip, reg);
        registrar("error", `PIN incorrecto desde ${ip}`);
        responder(ws, { t: "editor", ok: false, msg: "PIN incorrecto" });
      }
      break;
    }
    case "salirEditor": ws.data.editor = false; responder(ws, { t: "editor", ok: false, salio: true }); break;

    case "ejecutar": void ejecutarPorId(String(m.id)); break;

    case "probar": { // prueba de un botón sin guardar (editor)
      if (!necesitaEditor()) break;
      // Se valida igual que al guardar: nunca se ejecuta lo que manda el cliente tal cual.
      const acciones = (Array.isArray(m.acciones) ? m.acciones : []).slice(0, 60).map(limpiarAccion).filter(Boolean) as Accion[];
      const res = await ejecutarBoton({ acciones }, ctx, (r) => { const a = acciones[r.paso - 1]; if (r.ok && a) registrarOpacidad(a); });
      responder(ws, { t: "prueba", ok: res.ok, pasos: res.pasos });
      break;
    }
    case "accion": { // acción suelta del Control manual
      const accion = limpiarAccion(m.accion);
      if (!accion) { responder(ws, { t: "accionError", ref: m.ref, msg: "Acción desconocida" }); break; }
      try {
        const desc = await ejecutarAccion(accion, ctx);
        registrarOpacidad(accion);
        responder(ws, { t: "accionOk", ref: m.ref, desc });
      } catch (e: any) {
        registrar("error", e.message);
        responder(ws, { t: "accionError", ref: m.ref, msg: e.message });
      }
      break;
    }
    case "fader": { // control continuo (no se anota en el registro para no llenarlo)
      const accion = limpiarAccion(m.tipo === "master" ? { tipo: "rs_opacidad_master", valor: m.valor } : { tipo: "rs_opacidad_capa", n: m.n, valor: m.valor })!;
      try {
        await ejecutarAccion(accion, ctx, true);
        registrarOpacidad(accion);
      } catch (e: any) { responder(ws, { t: "accionError", msg: e.message }); }
      break;
    }
    case "biblioteca":
      try { responder(ws, { t: "biblioteca", lista: await pp.pedirBiblioteca() }); }
      catch (e: any) { responder(ws, { t: "biblioteca", error: e.message }); }
      break;

    case "editar": {
      if (!necesitaEditor()) break;
      try {
        const r = aplicarOperacion(m.operacion);
        publicar({ t: "vista", ...vistaPublica() });
        aEditores(msgAjustesEditor());
        if (r.cambioAjustes) aplicarAjustes();
        responder(ws, { t: "editado", ref: m.ref });
      } catch (e: any) { responder(ws, { t: "error", msg: e.message }); }
      break;
    }
    case "exportar":
      if (!necesitaEditor()) break;
      responder(ws, { t: "exportar", datos: exportarConfig() });
      break;
  }
}

// ---------- HTTP ----------
function tipoMime(ruta: string) {
  return ruta.endsWith(".html") ? "text/html; charset=utf-8"
    : ruta.endsWith(".css") ? "text/css; charset=utf-8"
    : ruta.endsWith(".js") ? "text/javascript; charset=utf-8"
    : ruta.endsWith(".svg") ? "image/svg+xml" : undefined;
}

function infoConexion(puerto: number) {
  const urls = ipsLocales().map((d) => ({ nombre: d.nombre, url: `http://${d.ip}:${puerto}` }));
  return { app: APP_NOMBRE, version: APP_VERSION, puerto, urls };
}

export function iniciarServidor(puertoInicial: number): { puerto: number; servidor: Server<DatosWS> } {
  let idSocket = 0;
  for (let puerto = puertoInicial; puerto < puertoInicial + 25; puerto++) {
    try {
      servidor = Bun.serve<DatosWS>({
        port: puerto,
        hostname: "0.0.0.0",
        fetch(req, srv) {
          const url = new URL(req.url);
          if (url.pathname === "/ws") {
            const ok = srv.upgrade(req, { data: { id: ++idSocket, ip: srv.requestIP(req)?.address ?? "?", editor: false } });
            return ok ? undefined : new Response("Se esperaba WebSocket", { status: 400 });
          }
          if (url.pathname === "/api/info") return Response.json(infoConexion(servidor.port!));
          if (url.pathname === "/api/qr.svg") {
            const u = url.searchParams.get("u") ?? "";
            return new Response(qrSvg(u.slice(0, 300)), { headers: { "content-type": "image/svg+xml" } });
          }
          let ruta = url.pathname;
          if (ruta === "/") ruta = "/index.html";
          else if (ruta === "/conectar") ruta = "/conectar.html";
          const archivo = ARCHIVOS[ruta];
          if (!archivo) return new Response("No encontrado", { status: 404 });
          return new Response(Bun.file(archivo), {
            headers: { "content-type": tipoMime(ruta) ?? "application/octet-stream", "cache-control": "no-cache" },
          });
        },
        websocket: {
          maxPayloadLength: 8 * 1024 * 1024, // permite importar configuraciones grandes
          idleTimeout: 60,
          open(ws) {
            sockets.add(ws);
            ws.subscribe("todos");
            responder(ws, {
              t: "hola", app: APP_NOMBRE, version: APP_VERSION, vista: { t: "vista", ...vistaPublica() },
              estado, ...estadoConexiones(), registro: ultimas(),
            });
          },
          message(ws, msg) { void alMensaje(ws, typeof msg === "string" ? msg : new TextDecoder().decode(msg)); },
          close(ws) { sockets.delete(ws); },
        },
      });
      aplicarAjustes();
      return { puerto, servidor };
    } catch (e: any) {
      if (e?.code !== "EADDRINUSE") throw e; // otro error: no tiene sentido probar otro puerto
    }
  }
  throw new Error(`No hay puertos libres entre ${puertoInicial} y ${puertoInicial + 24}`);
}

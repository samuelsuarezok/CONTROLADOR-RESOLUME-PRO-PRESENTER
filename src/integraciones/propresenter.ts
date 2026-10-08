// ============================================================
//  ProPresenter 6 — protocolo WebSocket NO oficial (el mismo que usan
//  la app "Remote" y el "Stage Display"). Referencia comunitaria:
//  https://github.com/jeffmikels/ProPresenter-API
//
//   • Remote:  ws://IP:PUERTO/remote        -> control (siguiente, limpiar...)
//   • Stage:   ws://IP:PUERTO/stagedisplay  -> diapositiva actual, reloj, mensajes
//
//  Las dos conexiones son independientes: si el Stage falla, el Remote
//  sigue funcionando igual (y viceversa). Todas las ÓRDENES (incluidos
//  los mensajes al Stage Display) van por Remote; el canal Stage solo
//  se usa para LEER la diapositiva actual y el reloj.
// ============================================================
import type { Ajustes } from "../config";
import { explicarFallo, type Linea } from "../red";
import { registrar } from "../registro";

export type EstadoWS = "desactivado" | "conectando" | "conectado" | "error" | "simulado";

/** Si la otra compu no contesta (IP equivocada, otra red), el sistema puede tardar más de un minuto en avisar. */
const APERTURA_MAX_MS = 8000;

/** Respuesta de ProPresenter a "authenticate": bien, solo lectura (Observer) o rechazada. */
function leerAutenticacion(m: any): "ok" | "observer" | "rechazada" {
  const ok = m.authenticated === 1 || m.authenticated === true || m.authenticated === "1";
  if (!ok) return "rechazada";
  // Con la contraseña de «Observer» se conecta, pero ProPresenter ignora todas las órdenes.
  return m.controller === 0 || m.controller === false || m.controller === "0" ? "observer" : "ok";
}
const MSG_OBSERVER = "Esa contraseña es de solo lectura (Observer). Usá la de «Controller» de ProPresenter → Preferencias → Red";

/** Cliente WebSocket con reconexión automática. */
class ClienteWS {
  estado: EstadoWS = "desactivado";
  detalle = "";
  /** Cuándo llegó el último mensaje (para detectar conexiones colgadas). */
  ultimoMensaje = 0;
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAuth: ReturnType<typeof setTimeout> | null = null;
  private intentos = 0;
  private activo = false;
  private ultimoError = "";
  /** Motivo probable del último fallo de conexión (rango de red, puerto cerrado…). */
  private pista = "";

  constructor(
    private nombre: string,
    private url: () => string,
    /** Se llama al abrir el socket: debe enviar la autenticación. */
    private alAbrir: (enviar: (o: unknown) => void) => void,
    /** Recibe cada mensaje JSON; debe llamar a autenticado() o rechazado(). */
    private alMensaje: (m: any) => void,
    private alCambiar: () => void,
    /** Averigua por qué no se pudo conectar (se muestra junto al error). */
    private explicar: () => Promise<string>,
  ) {}

  poner(estado: EstadoWS, detalle = "") {
    if (estado === this.estado && detalle === this.detalle) return;
    const antes = this.estado;
    this.estado = estado; this.detalle = detalle;
    if (estado === "conectado" && antes !== "conectado") { registrar("pp", `${this.nombre}: conectado`); this.ultimoError = ""; }
    // Se anota cada error distinto una sola vez (los reintentos no llenan el registro)
    if (estado === "error" && detalle !== this.ultimoError) { this.ultimoError = detalle; registrar("error", `${this.nombre}: ${detalle}`); }
    this.alCambiar();
  }

  /** Autenticación confirmada por el protocolo. */
  autenticado() {
    if (this.timerAuth) clearTimeout(this.timerAuth);
    this.intentos = 0;
    this.poner("conectado");
  }

  /** La contraseña fue rechazada. */
  rechazado(detalle = "Contraseña rechazada por ProPresenter") {
    if (this.timerAuth) clearTimeout(this.timerAuth);
    this.poner("error", detalle);
  }

  /** Corta la conexión actual (p. ej. porque quedó colgada) y vuelve a intentar. */
  reconectar(detalle: string) {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try { ws.close(); } catch {}
    if (this.timerAuth) clearTimeout(this.timerAuth);
    this.poner("error", detalle);
    this.reintentar();
  }

  iniciar() {
    this.detener();
    this.activo = true;
    this.pista = "";
    this.conectar();
  }

  detener(estado: EstadoWS = "desactivado", detalle = "") {
    this.activo = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.timerAuth) clearTimeout(this.timerAuth);
    this.timer = this.timerAuth = null;
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch {} }
    this.poner(estado, detalle);
  }

  private conectar() {
    if (!this.activo) return;
    const url = this.url();
    this.poner("conectando", `Conectando a ${url}`);
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch (e: any) { this.poner("error", `Dirección inválida: ${e.message}`); return this.reintentar(); }
    this.ws = ws;
    const timerApertura = setTimeout(() => {
      if (this.ws !== ws) return;
      this.ws = null;
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(); } catch {}
      this.falloConexion(url);
      this.reintentar();
    }, APERTURA_MAX_MS);
    ws.onopen = () => {
      clearTimeout(timerApertura);
      this.timerAuth = setTimeout(() => {
        this.poner("error", "ProPresenter no respondió a la autenticación");
        try { ws.close(); } catch {}
      }, 6000);
      this.alAbrir((o) => ws.send(JSON.stringify(o)));
    };
    ws.onmessage = (ev) => {
      this.ultimoMensaje = Date.now();
      try { this.alMensaje(JSON.parse(String(ev.data))); } catch { /* mensaje no JSON: se ignora */ }
    };
    ws.onerror = () => { clearTimeout(timerApertura); if (this.estado === "conectando") this.falloConexion(url); };
    ws.onclose = () => {
      clearTimeout(timerApertura);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.timerAuth) clearTimeout(this.timerAuth);
      if (this.estado === "conectado") this.poner("error", "Conexión perdida, reconectando…");
      this.reintentar();
    };
  }

  /** No se pudo abrir la conexión: se agrega el motivo probable para que se sepa qué revisar. */
  private falloConexion(url: string) {
    const base = `No se pudo conectar a ${url}`;
    this.poner("error", this.pista ? `${base}. ${this.pista}` : base);
    this.explicar().then((p) => {
      if (!this.activo || p === this.pista) return;
      this.pista = p;
      if (this.estado === "error" && this.detalle.startsWith(base)) this.poner("error", p ? `${base}. ${p}` : base);
    }).catch(() => {});
  }

  private reintentar() {
    if (!this.activo) return;
    if (this.timer) clearTimeout(this.timer);
    this.intentos++;
    this.timer = setTimeout(() => this.conectar(), Math.min(5000, 1000 * this.intentos));
  }

  enviar(o: unknown): boolean {
    if (this.estado !== "conectado" || !this.ws) return false;
    try { this.ws.send(JSON.stringify(o)); return true; } catch { return false; }
  }
}

// ---------- Datos de simulación ----------
const SIM_BIBLIOTECA = ["Default/Cuán grande es Él.pro6", "Default/Santo Santo Santo.pro6", "Default/Bienvenida.pro6", "Default/Anuncios.pro6"];
const SIM_LETRAS = ["Cuán grande es Él", "Santo, santo, santo", "Digno es el Cordero", "Aleluya, aleluya", "Gloria a Dios"];

/** Cada cuánto se le pregunta algo a ProPresenter para saber que sigue vivo. */
const LATIDO_MS = 5000;
/** Si ProPresenter ya respondía y se queda callado este tiempo, la conexión se da por colgada. */
const SILENCIO_MAX_MS = 15000;

export interface InfoPP {
  remote: { estado: EstadoWS; detalle: string };
  stage: { estado: EstadoWS; detalle: string };
  slide: string; sig: string; hora: string;
}

export class ProPresenter {
  private cfg!: Ajustes;
  private remote: ClienteWS;
  private stage: ClienteWS;
  private slide = ""; private sig = ""; private hora = "";
  private simIdx = 0;
  private simReloj: ReturnType<typeof setInterval> | null = null;
  private biblioteca: Promise<string[]> | null = null;
  private recibirBiblioteca: ((l: string[]) => void) | null = null;
  /** ProPresenter respondió al latido en esta conexión (solo entonces se vigila el silencio). */
  private latidoConfirmado = false;

  constructor(private alCambiar: () => void) {
    this.remote = new ClienteWS("ProPresenter Remote",
      () => `ws://${this.cfg.propresenter.ip}:${this.cfg.propresenter.puerto}/remote`,
      (env) => env({ action: "authenticate", protocol: "600", password: this.cfg.propresenter.passRemoto }),
      (m) => this.mensajeRemote(m), alCambiar,
      () => explicarFallo(this.cfg.propresenter.ip, this.cfg.propresenter.puerto));
    this.stage = new ClienteWS("ProPresenter Stage Display",
      () => `ws://${this.cfg.propresenter.ip}:${this.puertoStage()}/stagedisplay`,
      (env) => env({ pwd: this.cfg.propresenter.passStage, ptl: 610, acn: "ath" }),
      (m) => this.mensajeStage(m), alCambiar,
      () => explicarFallo(this.cfg.propresenter.ip, this.puertoStage()));
    setInterval(() => this.latido(), LATIDO_MS);
  }

  private puertoStage() { return this.cfg.propresenter.puertoStage || this.cfg.propresenter.puerto; }

  configurar(ajustes: Ajustes) {
    this.cfg = ajustes;
    if (this.simReloj) clearInterval(this.simReloj);
    this.simReloj = null;
    this.slide = this.sig = this.hora = "";

    if (ajustes.simulacion) {
      this.remote.detener("simulado", "Modo simulación");
      this.stage.detener("simulado", "Modo simulación");
      this.simIdx = 0; this.simActualizar();
      this.simReloj = setInterval(() => { this.hora = new Date().toLocaleTimeString("es-AR", { hour12: false }); this.alCambiar(); }, 1000);
      return;
    }
    this.remote.iniciar();
    if (ajustes.propresenter.usarStage) this.stage.iniciar();
    else this.stage.detener("desactivado", "Stage Display desactivado en ajustes");
  }

  info(): InfoPP {
    return {
      remote: { estado: this.remote.estado, detalle: this.remote.detalle },
      stage: { estado: this.stage.estado, detalle: this.stage.detalle },
      slide: this.slide, sig: this.sig, hora: this.hora,
    };
  }

  /**
   * Si la red se corta sin aviso (wifi, cable, la otra compu se colgó), el socket puede
   * seguir "abierto" varios minutos y los botones fallarían en silencio. Se pregunta la
   * lista de relojes (respuesta chica) y, si ProPresenter ya contestaba y deja de hacerlo,
   * se reconecta. Si nunca contesta a esa pregunta, no se vigila (no hay falsas alarmas).
   */
  private latido() {
    if (!this.cfg || this.cfg.simulacion || this.remote.estado !== "conectado") return;
    if (this.latidoConfirmado && Date.now() - this.remote.ultimoMensaje > SILENCIO_MAX_MS) {
      this.latidoConfirmado = false;
      this.remote.reconectar("ProPresenter dejó de responder, reconectando…");
      return;
    }
    this.remote.enviar({ action: "clockRequest" });
  }

  // ---------- Mensajes entrantes ----------
  private mensajeRemote(m: any) {
    switch (m.action) {
      case "authenticate": {
        const r = leerAutenticacion(m);
        if (r === "rechazada") { this.remote.rechazado(m.error ? `Contraseña rechazada por ProPresenter (${m.error})` : undefined); break; }
        if (r === "observer") { this.remote.rechazado(MSG_OBSERVER); break; }
        this.latidoConfirmado = false;
        this.remote.autenticado();
        break;
      }
      case "clockRequest": this.latidoConfirmado = true; break;
      case "libraryRequest":
        this.recibirBiblioteca?.(Array.isArray(m.library) ? m.library.map(String) : []);
        break;
    }
  }

  private mensajeStage(m: any) {
    switch (m.acn) {
      case "ath":
        if (m.ath === true || m.ath === 1 || m.ath === "1") {
          this.stage.autenticado();
          this.stage.enviar({ acn: "psl" }); // ¿qué diseño de Stage está activo? -> después se piden sus valores
        } else this.stage.rechazado(m.err ? `Contraseña rechazada por ProPresenter (${m.err})` : undefined);
        break;
      case "psl": if (m.uid) this.stage.enviar({ acn: "fv", uid: m.uid }); break;
      case "fv": // "frame values": ProPresenter 6 manda así cada diapositiva nueva (cs, ns, csn, nsn…)
        for (const f of Array.isArray(m.ary) ? m.ary : []) this.campoStage(f);
        this.alCambiar();
        break;
      default: if (this.campoStage(m)) this.alCambiar();
    }
  }

  /** Aplica un campo del Stage Display: cs = diapositiva actual, ns = siguiente, sys = reloj. */
  private campoStage(f: any): boolean {
    const t = String(f?.txt ?? "");
    switch (f?.acn) {
      case "cs": this.slide = t.slice(0, 400); return true;
      case "ns": this.sig = t.slice(0, 400); return true;
      case "sys": this.hora = t.trim().slice(0, 20); return true;
    }
    return false;
  }

  // ---------- Envío de órdenes ----------
  /** Orden por el canal Remote. Lanza error claro si no hay conexión. */
  remoto(orden: Record<string, unknown>, descripcion: string): void {
    if (this.cfg.simulacion) { this.simOrden(orden); registrar("pp", `[SIM] ProPresenter: ${descripcion}`); return; }
    if (!this.remote.enviar(orden)) throw new Error(`ProPresenter Remote no está conectado (${this.remote.detalle || this.remote.estado})`);
    registrar("pp", `ProPresenter: ${descripcion}`);
  }

  /** Pide la lista de presentaciones de la biblioteca (para elegir en el editor). */
  pedirBiblioteca(): Promise<string[]> {
    if (this.cfg.simulacion) return Promise.resolve(SIM_BIBLIOTECA);
    // Si ya hay un pedido en curso (otro dispositivo, doble toque) se comparte la misma respuesta.
    this.biblioteca ??= new Promise<string[]>((ok, fallo) => {
      if (!this.remote.enviar({ action: "libraryRequest" })) return fallo(new Error("ProPresenter Remote no está conectado"));
      const t = setTimeout(() => fallo(new Error("ProPresenter no respondió a tiempo")), 8000);
      this.recibirBiblioteca = (l) => { clearTimeout(t); ok(l); };
    }).finally(() => { this.biblioteca = null; this.recibirBiblioteca = null; });
    return this.biblioteca;
  }

  // ---------- Simulación ----------
  private simOrden(o: Record<string, unknown>) {
    const n = SIM_LETRAS.length;
    switch (o.action) {
      case "presentationTriggerNext": this.simIdx = (this.simIdx + 1) % n; break;
      case "presentationTriggerPrevious": this.simIdx = (this.simIdx + n - 1) % n; break;
      case "presentationTriggerIndex": this.simIdx = Number(o.slideIndex) % n; break;
      case "clearAll": case "clearText": this.slide = ""; this.alCambiar(); return;
      default: return; // el resto no cambia la diapositiva
    }
    this.simActualizar();
  }
  private simActualizar() {
    this.slide = SIM_LETRAS[this.simIdx]!;
    this.sig = SIM_LETRAS[(this.simIdx + 1) % SIM_LETRAS.length]!;
    this.hora = new Date().toLocaleTimeString("es-AR", { hour12: false });
    this.alCambiar();
  }
}

/**
 * Prueba el Remote con los datos escritos en Ajustes, sin guardarlos: abre una conexión
 * aparte, se autentica y la cierra. Dice si la contraseña sirve para controlar.
 */
export function probarRemote(ip: string, puerto: number, pass: string): Promise<Linea> {
  return new Promise((listo) => {
    let ws: WebSocket | null = null;
    const fin = (l: Linea) => {
      clearTimeout(t);
      if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch {} }
      listo(l);
    };
    const t = setTimeout(() => fin({ ok: false, texto: "ProPresenter no contestó la autenticación. ¿Es el puerto de red de ProPresenter 6 y está activado «ProPresenter Remote»?" }), 6000);
    try { ws = new WebSocket(`ws://${ip}:${puerto}/remote`); } catch (e: any) { return fin({ ok: false, texto: `Dirección inválida: ${e.message}` }); }
    ws.onopen = () => ws?.send(JSON.stringify({ action: "authenticate", protocol: "600", password: pass }));
    ws.onmessage = (ev) => {
      let m: any; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.action !== "authenticate") return;
      const r = leerAutenticacion(m);
      fin(r === "ok" ? { ok: true, texto: "ProPresenter aceptó la contraseña de «Controller»: se puede controlar" }
        : r === "observer" ? { ok: false, texto: MSG_OBSERVER }
        : { ok: false, texto: "ProPresenter rechazó la contraseña. Usá la de «Controller» (Preferencias → Red → ProPresenter Remote)" });
    };
    ws.onerror = () => fin({ ok: false, texto: "El puerto está abierto, pero no respondió como ProPresenter Remote. ¿Es el puerto correcto? ¿Está activado «ProPresenter Remote»?" });
  });
}

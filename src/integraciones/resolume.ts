// ============================================================
//  Resolume Arena 6 por OSC sobre UDP.
//  UDP no tiene "conexión": solo sabemos si el envío falló. Si el
//  usuario activa la salida OSC de Resolume hacia este programa
//  (puerto de entrada), podemos confirmar que está vivo.
// ============================================================
import dgram from "node:dgram";
import type { Ajustes } from "../config";
import { registrar } from "../registro";
import { codificarOSC, describirArgs, type ArgOSC } from "./osc";

export type EstadoRS = "desactivado" | "listo" | "conectado" | "error" | "simulado";

export class Resolume {
  estado: EstadoRS = "listo";
  detalle = "";
  private socket: dgram.Socket | null = null;
  private entrada: dgram.Socket | null = null;
  private ultimoRecibido = 0;
  private cfg!: Ajustes;
  private vigilante: ReturnType<typeof setInterval> | null = null;

  constructor(private alCambiar: () => void) {}

  private poner(estado: EstadoRS, detalle = "") {
    if (estado === this.estado && detalle === this.detalle) return;
    this.estado = estado; this.detalle = detalle;
    this.alCambiar();
  }

  /** (Re)configura según los ajustes. Se llama al arrancar y cada vez que cambian. */
  configurar(ajustes: Ajustes) {
    this.cfg = ajustes;
    this.cerrar();
    if (ajustes.simulacion) { this.poner("simulado", "Modo simulación: no se envía nada"); return; }

    this.socket = dgram.createSocket("udp4");
    // Sin este manejador, un error de red (p. ej. ICMP en Windows) podría cerrar el programa.
    this.socket.on("error", (e) => this.poner("error", e.message));
    this.poner("listo", `Enviando OSC a ${ajustes.resolume.ip}:${ajustes.resolume.puerto}`);

    const pe = ajustes.resolume.puertoEntrada;
    if (pe > 0) {
      this.entrada = dgram.createSocket({ type: "udp4", reuseAddr: true });
      this.entrada.on("error", (e) => registrar("error", `OSC entrada (puerto ${pe}): ${e.message}`));
      this.entrada.on("message", () => { this.ultimoRecibido = Date.now(); this.revisar(); });
      try { this.entrada.bind(pe); } catch (e: any) { registrar("error", `No se pudo abrir el puerto de entrada ${pe}: ${e.message}`); }
      this.vigilante = setInterval(() => this.revisar(), 3000);
    }
  }

  private revisar() {
    if (this.cfg.simulacion || this.estado === "error") return;
    const vivo = Date.now() - this.ultimoRecibido < 15000;
    if (this.cfg.resolume.puertoEntrada > 0 && vivo) this.poner("conectado", "Resolume está respondiendo");
    else if (this.estado === "conectado") this.poner("listo", "Sin mensajes recientes de Resolume");
  }

  private cerrar() {
    if (this.vigilante) clearInterval(this.vigilante);
    this.vigilante = null;
    for (const s of [this.socket, this.entrada]) { try { s?.close(); } catch {} }
    this.socket = this.entrada = null;
  }

  /**
   * Disparo tipo botón (columna, clip, limpiar…): 1 = apretar y, 50 ms después, 0 = soltar,
   * igual que un controlador. Sin el "soltar", Resolume puede ignorar el siguiente disparo
   * del mismo control porque lo sigue viendo apretado.
   */
  async disparar(direccion: string, silencioso = false): Promise<void> {
    await this.enviar(direccion, [{ t: "i", v: 1 }], silencioso);
    setTimeout(() => { this.enviar(direccion, [{ t: "i", v: 0 }], true).catch(() => {}); }, 50);
  }

  /** Envía un mensaje OSC. Rechaza la promesa si el envío falla. */
  enviar(direccion: string, args: ArgOSC[] = [], silencioso = false): Promise<void> {
    if (!direccion.startsWith("/")) return Promise.reject(new Error(`Dirección OSC inválida: "${direccion}" (debe empezar con /)`));
    const desc = `${direccion}${args.length ? " " + describirArgs(args) : ""}`;
    if (this.cfg.simulacion) {
      if (!silencioso) registrar("osc", `[SIM] OSC ${desc}`);
      return Promise.resolve();
    }
    const { ip, puerto } = this.cfg.resolume;
    return new Promise((ok, fallo) => {
      if (!this.socket) return fallo(new Error("OSC no está iniciado"));
      this.socket.send(codificarOSC(direccion, args), puerto, ip, (err) => {
        if (err) {
          this.poner("error", err.message);
          return fallo(new Error(`No se pudo enviar a Resolume (${ip}:${puerto}): ${err.message}`));
        }
        if (this.estado === "error") this.poner("listo", `Enviando OSC a ${ip}:${puerto}`);
        if (!silencioso) registrar("osc", `OSC → ${ip}:${puerto} ${desc}`);
        ok();
      });
    });
  }
}

// ============================================================
//  Red de esta computadora: direcciones IP, si ProPresenter y
//  Resolume están "en rango" (misma red) y diagnóstico de por qué
//  no conecta, explicado en castellano.
// ============================================================
import dgram from "node:dgram";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";

export interface DireccionLocal { nombre: string; ip: string; mascara: string }

/** Todas las IPv4 de esta compu (sin la interna 127.x). Incluye 169.254.x (cable sin DHCP). */
export function todasLasIps(): DireccionLocal[] {
  const salida: DireccionLocal[] = [];
  for (const [nombre, lista] of Object.entries(networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === "IPv4" && !i.internal) salida.push({ nombre, ip: i.address, mascara: i.netmask });
    }
  }
  return salida;
}

/** Direcciones para conectar celulares: sin las de enlace local (169.254.x, sin DHCP). */
export const ipsLocales = (): DireccionLocal[] => todasLasIps().filter((d) => !d.ip.startsWith("169.254."));

// ---------- Cuentas con IPv4 ----------
export function esIPv4(s: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}
const aNumero = (ip: string) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
const aTexto = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
const red = (ip: string, mascara: string) => {
  const a = aNumero(ip), m = aNumero(mascara);
  // AND bit a bit sin pasar por enteros con signo de 32 bits
  return [24, 16, 8, 0].map((s) => (Math.floor(a / 2 ** s) % 256) & (Math.floor(m / 2 ** s) % 256)).join(".");
};

/** Prefijo (24) de una máscara (255.255.255.0); null si no es una máscara válida. */
export function prefijoDeMascara(mascara: string): number | null {
  if (!esIPv4(mascara)) return null;
  const bits = aNumero(mascara).toString(2).padStart(32, "0");
  if (!/^1+0*$/.test(bits)) return null; // los unos tienen que ir todos juntos adelante
  const p = bits.indexOf("0");
  return p === -1 ? 32 : p;
}
export const mascaraDePrefijo = (p: number) => aTexto(p <= 0 ? 0 : (2 ** 32 - 2 ** (32 - Math.min(32, p))));

export const mismaRed = (a: string, b: string, mascara: string) => red(a, mascara) === red(b, mascara);

/** ¿La IP de un cliente es esta misma compu? */
export function esEstaCompu(ip: string): boolean {
  const limpia = ip.replace(/^::ffff:/i, "");
  if (limpia === "::1" || limpia.startsWith("127.") || limpia === "localhost") return true;
  return Object.values(networkInterfaces()).some((l) => (l ?? []).some((i) => i.address.replace(/^::ffff:/i, "") === limpia));
}

// ---------- ¿Está "en rango"? ----------
export type Rango =
  | { tipo: "local" }
  | { tipo: "misma"; via: DireccionLocal }
  | { tipo: "fuera"; propias: DireccionLocal[] }
  | { tipo: "nombre" };

export function rangoDe(host: string): Rango {
  if (!esIPv4(host)) return host === "localhost" ? { tipo: "local" } : { tipo: "nombre" };
  if (esEstaCompu(host)) return { tipo: "local" };
  const propias = todasLasIps();
  const via = propias.find((d) => mismaRed(d.ip, host, d.mascara));
  return via ? { tipo: "misma", via } : { tipo: "fuera", propias };
}

/** IP sugerida para poner esta compu en la red de `destino` (máscara 255.255.255.0). */
export function sugerirIP(destino: string): { ip: string; mascara: string } | null {
  if (!esIPv4(destino)) return null;
  const o = destino.split(".");
  if (o[0] === "169" && o[1] === "254") return { ip: `169.254.${o[2]}.${o[3] === "200" ? 201 : 200}`, mascara: "255.255.0.0" };
  return { ip: `${o[0]}.${o[1]}.${o[2]}.${o[3] === "200" ? 201 : 200}`, mascara: "255.255.255.0" };
}

const listaPropias = (propias: DireccionLocal[]) =>
  propias.length ? propias.map((d) => `${d.nombre} ${d.ip}`).join(", ") : "ninguna: no está conectada a ninguna red";

/** Frase corta si la IP está fuera de la red de esta compu ("" si está bien o no se puede saber). */
export function avisoRango(host: string): string {
  const r = rangoDe(host);
  if (r.tipo !== "fuera") return "";
  const s = sugerirIP(host);
  return `${host} no está en la red de esta compu (esta compu: ${listaPropias(r.propias)}).`
    + (s ? ` Poné esta compu en ${s.ip} desde ⚙️ Ajustes → Red → «Cambiar IP de esta compu», o revisá la IP.` : "");
}

// ---------- Pruebas de conexión ----------
export type ResultadoTCP = "abierto" | "cerrado" | "sin respuesta";

/**
 * Intenta abrir una conexión TCP (sin enviar nada). Ojo: Bun informa casi cualquier falla
 * como "rechazada", incluso si la compu no existe; por eso se cruza con responde().
 */
export function probarTCP(host: string, puerto: number, ms = 4000): Promise<ResultadoTCP> {
  return new Promise((listo) => {
    let terminado = false;
    const fin = (r: ResultadoTCP) => { if (terminado) return; terminado = true; clearTimeout(t); try { s.destroy(); } catch {} listo(r); };
    const s = connect({ host, port: puerto });
    // Windows tarda ~2 s en informar "rechazado" (reintenta): por eso el margen es de 4 s.
    const t = setTimeout(() => fin("sin respuesta"), ms);
    s.once("connect", () => fin("abierto"));
    s.once("error", () => fin("cerrado"));
  });
}

async function correr(cmd: string[], ms: number): Promise<string> {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", windowsHide: true, timeout: ms });
    const [salida] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    return salida;
  } catch { return ""; }
}

/**
 * ¿La compu existe en la red? Ping y, si no contesta (Windows suele bloquear el ping),
 * la tabla ARP: si figura su dirección física, la compu está conectada aunque tenga firewall.
 */
export async function responde(ip: string): Promise<boolean> {
  if (!esIPv4(ip)) return false;
  const win = process.platform === "win32";
  const ping = await correr(win ? ["ping", "-n", "1", "-w", "1500", ip] : ["ping", "-c", "1", "-t", "2", ip], 5000);
  if (/ttl=/i.test(ping)) return true;
  const arp = await correr(win ? ["arp", "-a", ip] : ["arp", "-n", ip], 3000);
  const linea = arp.split(/\r?\n/).find((l) => new RegExp(`(^|[\\s(])${ip.replace(/\./g, "\\.")}([\\s)]|$)`).test(l)) ?? "";
  const mac = /\b(?:[0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2}\b/i.exec(linea)?.[0] ?? "";
  return !!mac && !/^(?:0{1,2}[:-]){5}0{1,2}$/i.test(mac) && !/^(?:ff[:-]){5}ff$/i.test(mac);
}

/** Solo para esta misma compu: ¿algún programa (Resolume) ocupa ese puerto UDP? */
function puertoUDPOcupado(puerto: number): Promise<boolean> {
  return new Promise((listo) => {
    const s = dgram.createSocket("udp4");
    s.once("error", (e: any) => { try { s.close(); } catch {} listo(e?.code === "EADDRINUSE"); });
    s.bind(puerto, () => { s.close(); listo(false); }); // se libera enseguida: no le roba el puerto a Resolume
  });
}

export interface Linea { ok: boolean | null; texto: string }

const noEncontrada = (host: string, r: Rango) => r.tipo === "misma"
  ? `No se encontró ninguna compu con la IP ${host} en esta red. Revisá que esté prendida, conectada (cable o wifi) y que su IP sea esa. Si están por wifi: algunas redes (de invitados) no dejan que los equipos se vean entre sí.`
  : `No se pudo llegar a ${host}. Revisá que esté prendida, que su IP sea esa y que esté en la misma red que esta compu.`;

/** Qué pasa con el puerto de ProPresenter: cruza la prueba del puerto con si la compu está en la red. */
async function revisarPuerto(host: string, puerto: number, r: Rango): Promise<Linea> {
  const t = await probarTCP(host, puerto);
  if (t === "abierto") return { ok: true, texto: `ProPresenter acepta conexiones en el puerto ${puerto}` };
  if (r.tipo === "local") return { ok: false, texto: `Nada escucha en el puerto ${puerto} de esta compu. Abrí ProPresenter → Preferencias → Red: activá «Habilitar red» y fijate el número de puerto.` };
  if (!(await responde(host))) return { ok: false, texto: noEncontrada(host, r) };
  return { ok: false, texto: t === "sin respuesta"
    ? `La compu ${host} está en la red, pero no contesta en el puerto ${puerto}: seguramente su firewall bloquea a ProPresenter (permitilo en el Firewall de Windows o de macOS), o ProPresenter no tiene la red habilitada.`
    : `La compu ${host} está en la red, pero nada escucha en el puerto ${puerto}. En ProPresenter → Preferencias → Red: activá «Habilitar red» y fijate el número de puerto (o el firewall de esa compu lo bloquea).` };
}

/** Explicación breve de por qué no se pudo abrir la conexión con ProPresenter (para el estado). */
export async function explicarFallo(host: string, puerto: number): Promise<string> {
  const r = rangoDe(host);
  if (r.tipo === "fuera") return avisoRango(host);
  const l = await revisarPuerto(host, puerto, r);
  return l.ok ? `El puerto ${puerto} está abierto pero no respondió como ProPresenter. ¿Es el puerto de red de ProPresenter 6 y está activado «ProPresenter Remote»?` : l.texto;
}

// ---------- Diagnóstico completo (botón «Probar conexión») ----------
function lineaRango(host: string, r: Rango, seLlega: boolean): Linea {
  switch (r.tipo) {
    case "local": return { ok: true, texto: "Es esta misma compu" };
    case "nombre": return { ok: null, texto: `«${host}» es un nombre, no una IP: no se puede revisar el rango. Mejor usá la IP (por ejemplo 192.168.1.20).` };
    case "misma": return { ok: true, texto: `Está en la misma red que esta compu (${r.via.nombre}: ${r.via.ip} / ${r.via.mascara})` };
    case "fuera": return seLlega ? { ok: null, texto: `${host} está en otra red, pero se llega igual (a través de un router)` } : { ok: false, texto: avisoRango(host) };
  }
}

/** Revisa la red hasta un equipo: rango, si la compu está y, con `tcp`, el puerto de ProPresenter. */
export async function diagnosticarRed(host: string, puerto: number, tcp: boolean): Promise<{ lineas: Linea[]; puertoAbierto: boolean }> {
  if (!host) return { lineas: [{ ok: false, texto: "Falta la IP" }], puertoAbierto: false };
  const r = rangoDe(host);
  if (tcp) {
    const l = await revisarPuerto(host, puerto, r);
    return { lineas: [lineaRango(host, r, l.ok === true), l], puertoAbierto: l.ok === true };
  }
  // Resolume (OSC por UDP): no hay forma de preguntarle nada, solo si la compu está.
  if (r.tipo === "local") {
    return { puertoAbierto: false, lineas: [lineaRango(host, r, true), await puertoUDPOcupado(puerto)
      ? { ok: true, texto: `Hay un programa escuchando OSC en el puerto ${puerto} (Resolume)` }
      : { ok: null, texto: `No se detectó ningún programa escuchando en el puerto UDP ${puerto}. ¿Resolume está abierto, con Preferencias → OSC → «OSC Input» activado en ese puerto?` }] };
  }
  const vivo = await responde(host);
  return { puertoAbierto: false, lineas: [lineaRango(host, r, vivo), vivo
    ? { ok: true, texto: `La compu ${host} está conectada a la red` }
    : { ok: r.tipo === "misma" ? false : null, texto: noEncontrada(host, r) }] };
}

// ============================================================
//  Cambiar la IP de ESTA computadora (para ponerla "en rango" con
//  la compu de ProPresenter / Resolume) o volver a automática (DHCP).
//
//   • Windows: netsh, con el permiso de administrador de Windows (UAC).
//   • Mac:     networksetup, con la ventana de contraseña de macOS.
//
//  El permiso SIEMPRE lo confirma una persona frente a esta compu.
// ============================================================
import { readFileSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { esIPv4, mascaraDePrefijo, mismaRed, prefijoDeMascara } from "./red";

export interface Adaptador {
  /** Nombre que usa el sistema: "Ethernet", "Wi-Fi"… (es el que se le pasa a netsh / networksetup). */
  nombre: string;
  ips: { ip: string; mascara: string }[];
  /** true = automática (DHCP), false = manual, null = no se sabe. */
  dhcp: boolean | null;
  conectado: boolean;
}

export interface PedidoIP { adaptador: string; modo: "dhcp" | "manual"; ip: string; mascara: string; puerta: string }

export const SISTEMA = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "otro";

async function correr(cmd: string[], ms: number): Promise<{ codigo: number; salida: string; error: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", windowsHide: true, timeout: ms });
  const [salida, error, codigo] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { codigo, salida, error };
}

const POWERSHELL = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
/** Texto literal para PowerShell ('…' con las comillas simples duplicadas). */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** -EncodedCommand evita cualquier problema de comillas o acentos en la línea de comandos. */
const codificado = (script: string) => Buffer.from(script, "utf16le").toString("base64");
const powershell = (script: string, ms: number) =>
  correr([POWERSHELL, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", codificado(script)], ms);

// ---------- Listar adaptadores ----------
/** Lo que se ve con os.networkInterfaces() (sirve en cualquier sistema, sin estado DHCP). */
function adaptadoresBasicos(): Adaptador[] {
  return Object.entries(networkInterfaces())
    .map(([nombre, l]) => ({
      nombre, dhcp: null, conectado: true,
      ips: (l ?? []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => ({ ip: i.address, mascara: i.netmask })),
    }))
    .filter((a) => a.ips.length);
}

async function adaptadoresWindows(): Promise<Adaptador[]> {
  const script = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue)
$lista = foreach ($i in @(Get-NetIPInterface -AddressFamily IPv4 -ErrorAction SilentlyContinue)) {
  if ($i.InterfaceAlias -like 'Loopback*' -or $i.InterfaceAlias -like '*[*]*') { continue }
  [pscustomobject]@{
    nombre = $i.InterfaceAlias
    dhcp = [string]$i.Dhcp
    estado = [string]$i.ConnectionState
    ips = @($ips | Where-Object { $_.InterfaceIndex -eq $i.InterfaceIndex } | ForEach-Object { [pscustomobject]@{ ip = $_.IPAddress; prefijo = [int]$_.PrefixLength } })
  }
}
ConvertTo-Json -InputObject @($lista) -Depth 4 -Compress`;
  const r = await powershell(script, 15000);
  const datos = JSON.parse(r.salida.trim().replace(/^\uFEFF/, ""));
  return (Array.isArray(datos) ? datos : []).map((a: any) => ({
    nombre: String(a.nombre),
    dhcp: a.dhcp === "Enabled" ? true : a.dhcp === "Disabled" ? false : null,
    conectado: a.estado === "Connected",
    ips: (Array.isArray(a.ips) ? a.ips : [a.ips]).filter((x: any) => x?.ip).map((x: any) => ({ ip: String(x.ip), mascara: mascaraDePrefijo(Number(x.prefijo)) })),
  }));
}

async function adaptadoresMac(): Promise<Adaptador[]> {
  const NS = "/usr/sbin/networksetup";
  const orden = await correr([NS, "-listnetworkserviceorder"], 8000);
  const interfaces = networkInterfaces();
  // "(1) Wi-Fi\n(Hardware Port: Wi-Fi, Device: en0)"  — "(*)" = servicio desactivado
  const servicios = [...orden.salida.matchAll(/^\((\d+|\*)\)\s*(.+)\r?\n\(Hardware Port: [^\n]*?, Device: ([^)\n]*)\)/gm)]
    .filter((m) => m[1] !== "*" && m[3]!.trim())
    .map((m) => ({ nombre: m[2]!.trim(), dispositivo: m[3]!.trim() }));
  return Promise.all(servicios.map(async (s) => {
    const info = (await correr([NS, "-getinfo", s.nombre], 8000)).salida;
    const ips = (interfaces[s.dispositivo] ?? []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => ({ ip: i.address, mascara: i.netmask }));
    return {
      nombre: s.nombre, ips, conectado: ips.length > 0,
      dhcp: /^DHCP Configuration/m.test(info) ? true : /^Manual/m.test(info) ? false : null,
    };
  }));
}

/** Adaptadores de red de esta compu, los conectados primero. */
export async function listarAdaptadores(): Promise<Adaptador[]> {
  let lista: Adaptador[] = [];
  try {
    if (SISTEMA === "windows") lista = await adaptadoresWindows();
    else if (SISTEMA === "mac") lista = await adaptadoresMac();
  } catch { /* si el sistema no responde, se usa la lista básica */ }
  if (!lista.length) lista = adaptadoresBasicos();
  return lista.sort((a, b) => Number(b.conectado) - Number(a.conectado));
}

// ---------- Validar el pedido ----------
/** Revisa lo que manda el panel. Lanza Error con un mensaje claro si algo está mal. */
export function validarPedido(p: any, adaptadores: Adaptador[]): PedidoIP {
  const adaptador = String(p?.adaptador ?? "");
  if (!adaptadores.some((a) => a.nombre === adaptador)) throw new Error("Ese adaptador de red no existe en esta compu");
  // Nombres raros no se pueden pasar con seguridad al sistema
  if (/["%|\r\n\0]/.test(adaptador) || adaptador.startsWith("-")) throw new Error(`El nombre del adaptador «${adaptador}» tiene caracteres no permitidos. Cambiale el nombre en la configuración de red.`);
  if (p?.modo === "dhcp") return { adaptador, modo: "dhcp", ip: "", mascara: "", puerta: "" };
  if (p?.modo !== "manual") throw new Error("Modo desconocido");

  const ip = String(p.ip ?? "").trim();
  let mascara = String(p.mascara ?? "").trim().replace(/^\//, "");
  const puerta = String(p.puerta ?? "").trim();
  if (/^\d{1,2}$/.test(mascara) && Number(mascara) >= 8 && Number(mascara) <= 30) mascara = mascaraDePrefijo(Number(mascara));
  const prefijo = prefijoDeMascara(mascara);

  if (!esIPv4(ip)) throw new Error(`«${ip}» no es una IP válida (ejemplo: 192.168.1.200)`);
  const o1 = Number(ip.split(".")[0]);
  if (o1 === 0 || o1 === 127 || o1 >= 224) throw new Error(`${ip} no se puede usar como IP de una compu`);
  if (prefijo === null || prefijo < 8 || prefijo > 30) throw new Error(`«${mascara}» no es una máscara válida (la común es 255.255.255.0)`);
  const tamano = 2 ** (32 - prefijo);
  const host = ip.split(".").map(Number).reduce((n, x) => n * 256 + x, 0) % tamano;
  if (host === 0 || host === tamano - 1) throw new Error(`${ip} es la dirección de la red o de difusión: elegí otro número (por ejemplo terminado en .200)`);
  if (puerta) {
    if (!esIPv4(puerta)) throw new Error(`«${puerta}» no es una puerta de enlace válida (dejala vacía si no sabés)`);
    if (puerta === ip) throw new Error("La puerta de enlace no puede ser la misma IP de esta compu");
    if (!mismaRed(ip, puerta, mascara)) throw new Error(`La puerta de enlace ${puerta} no está en la misma red que ${ip}`);
  }
  return { adaptador, modo: "manual", ip, mascara, puerta };
}

export const describirPedido = (p: PedidoIP) =>
  p.modo === "dhcp" ? `«${p.adaptador}» en automática (DHCP)`
    : `«${p.adaptador}» en ${p.ip} / ${p.mascara}${p.puerta ? `, puerta de enlace ${p.puerta}` : ""}`;

// ---------- Aplicar ----------
async function aplicarWindows(p: PedidoIP): Promise<void> {
  const archivo = join(tmpdir(), `panel-cabina-ip-${process.pid}-${Date.now()}.txt`);
  // Argumentos posicionales de netsh (la forma clásica):
  //   netsh interface ipv4 set address "Ethernet" static 192.168.1.200 255.255.255.0 none
  const n = lit(p.adaptador);
  const orden = p.modo === "dhcp"
    ? `$salida = & netsh.exe interface ipv4 set address ${n} dhcp | Out-String
$codigo = $LASTEXITCODE
if ($codigo -eq 0) { $salida += (& netsh.exe interface ipv4 set dnsservers ${n} dhcp | Out-String) }`
    : `$salida = & netsh.exe interface ipv4 set address ${n} static ${lit(p.ip)} ${lit(p.mascara)} ${lit(p.puerta || "none")} | Out-String
$codigo = $LASTEXITCODE`;
  // Se ejecuta con permiso de administrador; la salida de netsh se deja en un archivo para mostrar el error.
  const interno = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
${orden}
[IO.File]::WriteAllText(${lit(archivo)}, "$salida".Trim(), [Text.Encoding]::UTF8)
exit $codigo`;
  const externo = `try {
  $p = Start-Process -FilePath ${lit(POWERSHELL)} -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',${lit(codificado(interno))} -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop
  exit $p.ExitCode
} catch {
  $e = $_.Exception
  while ($e) { if ($e.NativeErrorCode -eq 1223) { exit 1223 }; $e = $e.InnerException }
  [Console]::Out.Write($_.Exception.Message)
  exit 1
}`;
  const r = await powershell(externo, 180000);
  let detalle = "";
  try { detalle = readFileSync(archivo, "utf8").replace(/^\uFEFF/, "").trim(); rmSync(archivo, { force: true }); } catch {}
  if (r.codigo === 0) return;
  if (r.codigo === 1223) throw new Error("Se canceló el permiso de administrador: no se cambió nada");
  throw new Error(`Windows no aceptó el cambio${detalle || r.salida.trim() ? `: ${(detalle || r.salida).trim()}` : ` (código ${r.codigo})`}`);
}

async function aplicarMac(p: PedidoIP): Promise<void> {
  // Los datos van como argumentos (no dentro del texto del script) y con "quoted form": sin riesgo de inyección.
  const script = `on run argv
  set cmd to "/usr/sbin/networksetup ${p.modo === "dhcp" ? "-setdhcp" : "-setmanual"}"
  repeat with a in argv
    set cmd to cmd & " " & quoted form of (a as text)
  end repeat
  do shell script cmd with administrator privileges
end run`;
  const args = p.modo === "dhcp" ? [p.adaptador] : [p.adaptador, p.ip, p.mascara, p.puerta];
  const r = await correr(["/usr/bin/osascript", "-e", script, ...args], 180000);
  if (/-128\b/.test(r.error)) throw new Error("Se canceló el pedido de contraseña: no se cambió nada");
  const sinPuerta = p.modo === "manual" && !p.puerta
    ? " Probá de nuevo escribiendo una puerta de enlace (la IP del router; si no hay router, la de la compu de ProPresenter)." : "";
  // networksetup a veces informa errores con código 0: se revisa el texto…
  const texto = (r.salida + "\n" + r.error).trim();
  if (r.codigo !== 0 || /error|not valid|isn't|is not/i.test(texto)) throw new Error(`macOS no aceptó el cambio: ${texto || `código ${r.codigo}`}.${sinPuerta}`);
  // …y se confirma leyendo cómo quedó (no necesita permisos).
  const info = (await correr(["/usr/sbin/networksetup", "-getinfo", p.adaptador], 8000)).salida;
  const quedo = p.modo === "dhcp" ? /^DHCP Configuration/m.test(info)
    : /^Manual Configuration/m.test(info) && new RegExp(`^IP address: ${p.ip.replace(/\./g, "\\.")}\\s*$`, "m").test(info);
  if (!quedo) throw new Error(`macOS no aplicó el cambio (quedó: ${info.split("\n").slice(0, 2).join(", ").trim() || "sin datos"}).${sinPuerta}`);
}

/** Cambia la IP. Lanza Error con un mensaje claro si no se pudo. */
export async function aplicarIP(p: PedidoIP): Promise<void> {
  if (SISTEMA === "windows") return aplicarWindows(p);
  if (SISTEMA === "mac") return aplicarMac(p);
  throw new Error("Cambiar la IP desde el panel solo funciona en Windows y Mac");
}

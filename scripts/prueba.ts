// ============================================================
//  Prueba de punta a punta (sin Resolume ni ProPresenter reales):
//  levanta un "ProPresenter falso" (WebSocket) y un "Resolume falso" (UDP),
//  arranca el panel contra ellos y verifica los mensajes.
//  El ProPresenter falso responde como ProPresenter 6 real según
//  github.com/jeffmikels/ProPresenter-API (Pro6.md).
//  Uso:  bun scripts/prueba.ts
// ============================================================
import { spawn } from "node:child_process";
import dgram from "node:dgram";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validarPedido } from "../src/ipcompu";
import { mascaraDePrefijo, mismaRed, prefijoDeMascara, sugerirIP } from "../src/red";

const PUERTO_PANEL = 3555, PUERTO_PP = 50555, PUERTO_OSC = 7555;
let fallos = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? "✔" : "✖"} ${msg}`); if (!c) fallos++; };
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function esperarQue(cond: () => unknown, ms: number) {
  for (const fin = Date.now() + ms; Date.now() < fin && !cond();) await espera(100);
}

// --- Cuentas de red (sin tocar la red real) ---
ok(prefijoDeMascara("255.255.255.0") === 24 && prefijoDeMascara("255.0.255.0") === null && mascaraDePrefijo(16) === "255.255.0.0",
  "Máscaras de red: 255.255.255.0 = /24, y una máscara inválida se detecta");
ok(mismaRed("192.168.0.10", "192.168.0.200", "255.255.255.0") && !mismaRed("192.168.0.10", "192.168.1.20", "255.255.255.0"),
  "Se detecta si dos IP están en la misma red");
ok(sugerirIP("192.168.0.10")?.ip === "192.168.0.200" && sugerirIP("10.0.5.200")?.ip === "10.0.5.201", "La IP sugerida queda en la red del destino");
const adaptadoresFalsos = [{ nombre: "Ethernet 2", ips: [], dhcp: true, conectado: true }, { nombre: 'Raro"x', ips: [], dhcp: true, conectado: true }];
const pedidoOk = validarPedido({ adaptador: "Ethernet 2", modo: "manual", ip: "192.168.0.200", mascara: "/24", puerta: "" }, adaptadoresFalsos);
ok(pedidoOk.mascara === "255.255.255.0", "Una máscara escrita como /24 se convierte en 255.255.255.0");
const rechaza = (p: any) => { try { validarPedido(p, adaptadoresFalsos); return ""; } catch (e: any) { return e.message; } };
ok(/no es una IP válida/.test(rechaza({ adaptador: "Ethernet 2", modo: "manual", ip: "192.168.0.300", mascara: "255.255.255.0" }))
  && /difusión/.test(rechaza({ adaptador: "Ethernet 2", modo: "manual", ip: "192.168.0.255", mascara: "255.255.255.0" }))
  && /misma red/.test(rechaza({ adaptador: "Ethernet 2", modo: "manual", ip: "192.168.0.200", mascara: "255.255.255.0", puerta: "10.0.0.1" }))
  && /caracteres no permitidos/.test(rechaza({ adaptador: 'Raro"x', modo: "dhcp" })),
  "Un cambio de IP mal escrito se rechaza antes de tocar la red");

// --- ProPresenter 6 falso ---
const recibidosPP: any[] = [];
Bun.serve<{ ruta: string }>({
  port: PUERTO_PP,
  fetch(req, srv) { return srv.upgrade(req, { data: { ruta: new URL(req.url).pathname } }) ? undefined : new Response("x", { status: 400 }); },
  websocket: {
    message(ws, raw) {
      const m = JSON.parse(String(raw)); recibidosPP.push({ ruta: ws.data.ruta, ...m });
      const enviar = (o: unknown) => ws.send(JSON.stringify(o));
      // Remote
      if (m.action === "authenticate") {
        const controller = m.password === "clave" ? 1 : 0, autenticado = m.password === "clave" || m.password === "observador" ? 1 : 0;
        enviar({ controller, authenticated: autenticado, error: autenticado ? "" : "Wrong password", action: "authenticate" });
      }
      if (m.action === "clockRequest") enviar({ clockInfo: [], action: "clockRequest" });
      if (m.action === "libraryRequest") setTimeout(() => enviar({ action: "libraryRequest", library: ["Default/A.pro6"] }), 50);
      // Stage Display: la diapositiva llega anidada en "fv", no como mensaje suelto
      if (m.acn === "ath") enviar({ acn: "ath", ath: m.pwd === "stage", err: "" });
      if (m.acn === "psl") enviar({ acn: "psl", uid: "DISENO-1" });
      if (m.acn === "fv" && m.uid === "DISENO-1") enviar({ acn: "fv", ary: [
        { acn: "cs", uid: "S1", txt: "Letra de prueba" }, { acn: "ns", uid: "S2", txt: "Siguiente letra" },
        { acn: "csn", txt: "" }, { acn: "sys", txt: " 11:17 AM" },
      ] });
    },
  },
});

// --- Resolume falso ---
const oscRecibidos: Buffer[] = [];
const udp = dgram.createSocket("udp4"); udp.on("message", (m) => oscRecibidos.push(m)); udp.bind(PUERTO_OSC, "127.0.0.1");
const textoOSC = (b: Buffer) => b.toString("latin1").split("\0")[0];
const enteroOSC = (b: Buffer) => b.readInt32BE(b.length - 4);

// --- Carpeta de datos temporal con ajustes apuntando a los falsos ---
const dir = mkdtempSync(join(tmpdir(), "panel-"));
mkdirSync(join(dir, "data"));
const boton = { id: "b1", texto: "T", icono: "", color: "#112233", confirmar: false, acciones: [
  { tipo: "pp_siguiente" }, { tipo: "rs_columna", n: 3 }, { tipo: "espera", ms: 100 }, { tipo: "rs_opacidad_master", valor: 40 },
  { tipo: "pp_msg_stage", texto: "Hola" }, { tipo: "pp_slide", ruta: "Default/A.pro6", diapositiva: 2 },
] };
const ajustes = {
  simulacion: false,
  resolume: { ip: "127.0.0.1", puerto: PUERTO_OSC, puertoEntrada: 0 },
  propresenter: { ip: "127.0.0.1", puerto: PUERTO_PP, passRemoto: "clave", usarStage: true, puertoStage: 0, passStage: "stage" },
};
writeFileSync(join(dir, "data", "config.json"), JSON.stringify({ version: 1, pin: "9999", ajustes, paginas: [{ id: "p1", nombre: "P", botones: [boton] }] }));

// El panel se ejecuta con cwd = carpeta temporal (así lee SU data/)
const panel = spawn("bun", [join(import.meta.dir, "..", "src", "main.ts"), `--puerto=${PUERTO_PANEL}`], { cwd: dir, stdio: "ignore" });

await espera(2500);
const mensajes: any[] = [];
const ws = new WebSocket(`ws://127.0.0.1:${PUERTO_PANEL}/ws`);
ws.onmessage = (e) => mensajes.push(JSON.parse(String(e.data)));
await new Promise((r) => (ws.onopen = r));
await espera(500);
const ultimo = (t: string) => [...mensajes].reverse().find((m) => m.t === t);

const hola = mensajes.find((m) => m.t === "hola");
ok(!!hola, "El cliente recibe el estado inicial («hola»)");
ok(hola?.pp?.remote?.estado === "conectado", "ProPresenter Remote conectado (autenticación con contraseña)");
ok(hola?.pp?.stage?.estado === "conectado", "Stage Display conectado");
ok(hola?.pp?.slide === "Letra de prueba" && hola?.pp?.sig === "Siguiente letra", "La diapositiva actual se lee del Stage Display (formato real «fv»)");
ok(hola?.pp?.hora === "11:17 AM", "El reloj del Stage Display se muestra");
ok(hola?.vista?.paginas?.[0]?.botones?.length === 1, "La botonera llega a los clientes");
ok(!JSON.stringify(hola).includes("9999") && !JSON.stringify(hola).includes("clave"), "El PIN y las contraseñas NO se envían a clientes sin PIN");

// Sin PIN no se puede editar
ws.send(JSON.stringify({ t: "editar", operacion: { op: "pagina.nueva", nombre: "X" } }));
await espera(200);
ok(mensajes.some((m) => m.t === "error"), "Editar sin PIN es rechazado");

// Ejecutar botón (secuencia de 6 acciones)
ws.send(JSON.stringify({ t: "ejecutar", id: "b1" }));
await espera(900);
const fin = mensajes.find((m) => m.t === "ejec" && m.fase === "fin");
ok(fin?.ok === true && fin.pasos.length === 6, "El botón ejecuta las 6 acciones en secuencia sin errores");
ok(recibidosPP.some((m) => m.action === "presentationTriggerNext"), "ProPresenter recibió «siguiente»");
ok(recibidosPP.some((m) => m.action === "stageDisplaySendMessage" && m.stageDisplayMessage === "Hola" && m.ruta === "/remote"),
  "El mensaje al Stage Display va por Remote (stageDisplaySendMessage)");
ok(recibidosPP.some((m) => m.action === "presentationTriggerIndex" && m.slideIndex === "1"), "Diapositiva 2 enviada como índice 1");
const col3 = oscRecibidos.filter((b) => textoOSC(b) === "/composition/columns/3/connect").map(enteroOSC);
ok(col3[0] === 1 && col3[1] === 0, "Resolume recibió la columna 3 como «apretar» (1) y «soltar» (0)");
const master = oscRecibidos.find((b) => textoOSC(b) === "/composition/master");
ok(!!master && Math.abs(master.readFloatBE(master.length - 4) - 0.4) < 1e-6, "Opacidad master 40% llegó como float 0.4");

// Control manual: lo que manda el cliente se valida igual que un botón guardado
mensajes.length = 0;
ws.send(JSON.stringify({ t: "accion", accion: null, ref: 1 }));
ws.send(JSON.stringify({ t: "accion", accion: { tipo: "rs_opacidad_master", valor: 25.5 }, ref: 2 }));
await espera(300);
ok(mensajes.some((m) => m.t === "accionError" && m.ref === 1), "Una acción manual inválida se rechaza con un mensaje claro");
ok(ultimo("estado")?.estado?.master === 25.5, "El fader master queda en el valor enviado");

// Dos pedidos de biblioteca a la vez: los dos reciben respuesta
mensajes.length = 0;
ws.send(JSON.stringify({ t: "biblioteca" })); ws.send(JSON.stringify({ t: "biblioteca" }));
await espera(400);
ok(mensajes.filter((m) => m.t === "biblioteca" && m.lista?.[0] === "Default/A.pro6").length === 2, "Dos pedidos simultáneos de la biblioteca reciben la lista");

// PIN incorrecto / correcto
ws.send(JSON.stringify({ t: "pin", pin: "0000" })); await espera(200);
ok(mensajes.some((m) => m.t === "editor" && m.ok === false), "PIN incorrecto rechazado");
ws.send(JSON.stringify({ t: "pin", pin: "9999" })); await espera(200);
ok(mensajes.some((m) => m.t === "editor" && m.ok === true), "PIN correcto abre el modo edición");
ok(mensajes.some((m) => m.t === "ajustes"), "Con PIN llegan los ajustes");

ws.send(JSON.stringify({ t: "editar", operacion: { op: "pagina.duplicar", id: "p1" } })); await espera(300);
const vista = ultimo("vista");
ok(vista?.paginas?.length === 2 && vista.paginas[1].botones[0].id !== "b1", "Duplicar página crea copia con botones nuevos");

mensajes.length = 0;
ws.send(JSON.stringify({ t: "editar", operacion: { op: "pin.cambiar", nuevo: "abcd" } })); await espera(200);
ok(mensajes.some((m) => m.t === "error" && /números/.test(m.msg)), "Un PIN con letras se rechaza (el teclado del celular es numérico)");

// IP mal escrita ("http://...:puerto/") se corrige sola
ws.send(JSON.stringify({ t: "editar", operacion: { op: "ajustes.guardar", ajustes: { propresenter: { ip: "http://127.0.0.1:50555/" } } } }));
await espera(1500);
ok(ultimo("ajustes")?.ajustes?.propresenter?.ip === "127.0.0.1", "La IP escrita como «http://127.0.0.1:50555/» se guarda como «127.0.0.1»");
ok(ultimo("con")?.pp?.remote?.estado === "conectado", "Con la IP corregida ProPresenter vuelve a conectar");

// Contraseña de «Observer»: conecta pero no puede controlar -> error claro
ws.send(JSON.stringify({ t: "editar", operacion: { op: "ajustes.guardar", ajustes: { propresenter: { passRemoto: "observador" } } } }));
await espera(1000);
const remoto = ultimo("con")?.pp?.remote;
ok(remoto?.estado === "error" && /Observer/.test(remoto.detalle), "Con la contraseña de «Observer» avisa que no puede controlar");

// Falla controlada: PP caído -> error claro, el resto de acciones sigue
ws.send(JSON.stringify({ t: "editar", operacion: { op: "ajustes.guardar", ajustes: { resolume: { puerto: PUERTO_OSC + 1 }, propresenter: { puerto: 50999, passRemoto: "clave" } } } }));
await espera(800);
mensajes.length = 0; oscRecibidos.length = 0;
ws.send(JSON.stringify({ t: "ejecutar", id: "b1" })); await espera(700);
const fin2 = mensajes.find((m) => m.t === "ejec" && m.fase === "fin");
ok(fin2?.ok === false && fin2.pasos.some((p: any) => !p.ok && /no está conectado/.test(p.error)), "Con ProPresenter caído el botón informa el error por paso");
ok(fin2?.pasos.filter((p: any) => p.ok).length >= 2, "Las acciones de Resolume se ejecutan igual aunque falle ProPresenter");

// El estado de ProPresenter explica el motivo (acá: nada escucha en ese puerto)
await esperarQue(() => /Nada escucha en el puerto 50999/.test(ultimo("con")?.pp?.remote?.detalle ?? ""), 8000);
ok(/Nada escucha en el puerto 50999/.test(ultimo("con")?.pp?.remote?.detalle ?? ""), "Si ProPresenter no conecta, el estado explica el motivo (puerto cerrado)");

// --- Ajustes → Red ---
ws.send(JSON.stringify({ t: "red" }));
await esperarQue(() => ultimo("red"), 15000);
const red = ultimo("red");
ok(Array.isArray(red?.adaptadores) && Array.isArray(red?.propias) && red?.local === true, "Ajustes → Red: llegan los adaptadores y se reconoce que el pedido viene de esta compu");

const lineas = (d: any) => (d?.lineas ?? []).map((l: any) => `${l.ok}: ${l.texto}`).join("\n");
async function diagnostico(pp: object, rs: object = { ip: "127.0.0.1", puerto: PUERTO_OSC }) {
  mensajes.length = 0;
  ws.send(JSON.stringify({ t: "diagnostico", pp, rs }));
  await esperarQue(() => ultimo("diagnostico"), 20000);
  return ultimo("diagnostico");
}
let d = await diagnostico({ ip: "127.0.0.1", puerto: PUERTO_PP, pass: "clave" });
ok(/true: .*acepta conexiones/.test(lineas(d?.pp)) && /true: .*aceptó la contraseña/.test(lineas(d?.pp)), "«Probar conexión» confirma el puerto y la contraseña de ProPresenter");
ok(/true: .*escuchando OSC/.test(lineas(d?.rs)), "«Probar conexión» detecta que Resolume escucha en su puerto (misma compu)");
d = await diagnostico({ ip: "127.0.0.1", puerto: PUERTO_PP, pass: "observador" });
ok(/false: .*Observer/.test(lineas(d?.pp)), "«Probar conexión» avisa si la contraseña es la de Observer");
d = await diagnostico({ ip: "127.0.0.1", puerto: 50999, pass: "clave" });
ok(/false: Nada escucha en el puerto 50999/.test(lineas(d?.pp)), "«Probar conexión» avisa si nada escucha en el puerto de ProPresenter");

// --- Cambiar la IP de esta compu (nunca se toca la red real: lo válido solo en simulación) ---
async function cambiarIP(pedido: object) {
  mensajes.length = 0;
  ws.send(JSON.stringify({ t: "cambiarIP", pedido }));
  await esperarQue(() => ultimo("ipCambiada"), 20000);
  return ultimo("ipCambiada");
}
let r = await cambiarIP({ adaptador: "NO-EXISTE", modo: "manual", ip: "192.168.77.200", mascara: "255.255.255.0" });
ok(r?.ok === false && /no existe/.test(r.msg), "Cambiar IP: un adaptador que no existe se rechaza");
const adaptador = red?.adaptadores?.find((a: any) => !/["%|]/.test(a.nombre))?.nombre;
if (adaptador) {
  r = await cambiarIP({ adaptador, modo: "manual", ip: "192.168.77.0", mascara: "255.255.255.0" });
  ok(r?.ok === false && /difusión/.test(r.msg), "Cambiar IP: la dirección de red (.0) se rechaza");
  ws.send(JSON.stringify({ t: "editar", operacion: { op: "ajustes.guardar", ajustes: { simulacion: true } } }));
  await esperarQue(() => ultimo("ajustes")?.ajustes?.simulacion === true, 3000);
  if (ultimo("ajustes")?.ajustes?.simulacion === true) {
    r = await cambiarIP({ adaptador, modo: "manual", ip: "192.168.77.200", mascara: "255.255.255.0", puerta: "" });
    ok(r?.ok === true && r.sim === true && /192\.168\.77\.200/.test(r.msg), "Cambiar IP en modo simulación: se valida y no se toca la red");
  } else ok(false, "No se pudo activar el modo simulación para probar el cambio de IP");
} else console.log("  (sin adaptadores de red: se saltea la prueba de cambio de IP)");

ws.close(); panel.kill(); udp.close();
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodo OK");
process.exit(fallos ? 1 : 0);

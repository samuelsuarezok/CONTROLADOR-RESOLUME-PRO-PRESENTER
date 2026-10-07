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

const PUERTO_PANEL = 3555, PUERTO_PP = 50555, PUERTO_OSC = 7555;
let fallos = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? "✔" : "✖"} ${msg}`); if (!c) fallos++; };
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

ws.close(); panel.kill(); udp.close();
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : "\nTodo OK");
process.exit(fallos ? 1 : 0);

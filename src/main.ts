// ============================================================
//  Panel Cabina — punto de entrada.
//  Levanta el servidor y muestra cómo conectarse desde el celular.
// ============================================================
import { CARPETA_DATOS, vaciarPendientes } from "./almacen";
import { obtenerConfig, PUERTO_POR_DEFECTO } from "./config";
import { avisoRango, ipsLocales } from "./red";
import { qrAscii } from "./qr";

/** Puerto: --puerto=NNNN, o variable PORT, o 3002. */
function puertoPedido(): number {
  const arg = process.argv.find((a) => a.startsWith("--puerto="))?.split("=")[1];
  const n = Number(arg ?? process.env.PORT);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : PUERTO_POR_DEFECTO;
}

async function esperarEnter() {
  // En Windows, al hacer doble clic la ventana se cierra sola si hay un error: así se alcanza a leer.
  console.log("\nPresioná Enter para cerrar esta ventana…");
  for await (const _ of console) break;
}

async function principal() {
  const { iniciarServidor, APP_NOMBRE, APP_VERSION } = await import("./server");
  const pedido = puertoPedido();
  const { puerto } = iniciarServidor(pedido);

  const ips = ipsLocales();
  const raya = "═".repeat(60);
  console.log(`\n${raya}\n  ${APP_NOMBRE}  v${APP_VERSION}\n${raya}`);
  if (puerto !== pedido) console.log(`  (El puerto ${pedido} estaba ocupado, se usó el ${puerto})`);

  if (ips.length === 0) {
    console.log("\n  ⚠ No se detectó ninguna red. Conectá esta compu al wifi o al cable de red.");
    console.log(`  Desde esta misma compu: http://localhost:${puerto}`);
  } else {
    console.log("\n  Abrí esta dirección en el celular, la tablet o la compu (misma red wifi):\n");
    for (const d of ips) console.log(`    http://${d.ip}:${puerto}     (${d.nombre})`);
    console.log(`\n  En esta misma compu también sirve: http://localhost:${puerto}`);
    console.log("\n  O escaneá este código QR con la cámara del celular:\n");
    console.log(qrAscii(`http://${ips[0]!.ip}:${puerto}`).split("\n").map((l) => "    " + l).join("\n"));
    if (ips.length > 1) console.log("\n  (El QR usa la primera dirección. Si no abre, probá con otra de la lista.)");
  }
  // ¿ProPresenter y Resolume están en la misma red que esta compu?
  const { propresenter, resolume } = obtenerConfig().ajustes;
  for (const [nombre, ip] of [["ProPresenter", propresenter.ip], ["Resolume", resolume.ip]] as const) {
    const aviso = avisoRango(ip);
    if (aviso) console.log(`\n  ⚠ ${nombre}: ${aviso}`);
  }
  console.log(`\n  Página con la dirección y el QR: http://localhost:${puerto}/conectar`);
  console.log(`  Datos guardados en: ${CARPETA_DATOS}`);
  console.log("\n  ➜ Si Windows muestra un aviso del Firewall, tocá «Permitir acceso».");
  console.log("    Sin eso, los celulares no van a poder conectarse.");
  console.log("\n  Para cerrar el programa: Ctrl+C o cerrá esta ventana.");
  console.log(raya + "\n");
}

// Guardar todo lo pendiente al cerrar
for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => { vaciarPendientes(); process.exit(0); });
process.on("exit", vaciarPendientes);
process.on("uncaughtException", (e) => console.error("Error inesperado:", e));
process.on("unhandledRejection", (e) => console.error("Error inesperado:", e));

principal().catch(async (e) => {
  console.error("\n✖ No se pudo iniciar:", e?.message ?? e);
  await esperarEnter();
  process.exit(1);
});

// ============================================================
//  Ejecutor de acciones. Un botón es una lista de acciones que se
//  ejecutan en orden. Si una falla, se anota y se sigue con las
//  demás (en vivo es mejor que se haga todo lo posible).
// ============================================================
import type { Accion, Ajustes, Boton } from "./config";
import type { ProPresenter } from "./integraciones/propresenter";
import type { Resolume } from "./integraciones/resolume";
import type { ArgOSC } from "./integraciones/osc";

export interface Contexto { pp: ProPresenter; rs: Resolume; ajustes: () => Ajustes }

export interface ResultadoPaso { paso: number; descripcion: string; ok: boolean; error?: string }
export interface ResultadoBoton { ok: boolean; pasos: ResultadoPaso[] }

/** Reemplaza {n}, {capa} y {clip} en una plantilla de dirección OSC. */
const plantilla = (t: string, v: Record<string, number>) =>
  t.replace(/\{(n|capa|clip)\}/g, (_, k) => String(v[k] ?? 1));

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const normalizado = (pct: unknown) => Math.round(Math.min(100, Math.max(0, Number(pct) || 0)) * 10) / 1000; // 0-100 -> 0.000-1.000

/** Ejecuta UNA acción. Devuelve su descripción; lanza Error si falla. */
export async function ejecutarAccion(a: Accion, ctx: Contexto, silencioso = false): Promise<string> {
  const osc = ctx.ajustes().osc;
  const rs = ctx.rs;
  switch (a.tipo) {
    // ----- ProPresenter -----
    case "pp_siguiente": ctx.pp.remoto({ action: "presentationTriggerNext" }, "siguiente diapositiva"); return "ProPresenter: siguiente";
    case "pp_anterior": ctx.pp.remoto({ action: "presentationTriggerPrevious" }, "diapositiva anterior"); return "ProPresenter: anterior";
    case "pp_slide": {
      if (!a.ruta) throw new Error("Falta elegir la presentación");
      const idx = Math.max(1, Number(a.diapositiva) || 1) - 1; // en pantalla se cuenta desde 1
      ctx.pp.remoto({ action: "presentationTriggerIndex", slideIndex: String(idx), presentationPath: a.ruta }, `diapositiva ${idx + 1} de ${a.ruta}`);
      return `ProPresenter: diapositiva ${idx + 1}`;
    }
    case "pp_limpiar_todo": ctx.pp.remoto({ action: "clearAll" }, "limpiar todo"); return "ProPresenter: limpiar todo";
    case "pp_limpiar_texto": ctx.pp.remoto({ action: "clearText" }, "limpiar texto"); return "ProPresenter: limpiar texto";
    case "pp_limpiar_fondo": ctx.pp.remoto({ action: "clearVideo" }, "limpiar fondo"); return "ProPresenter: limpiar fondo";
    // Los mensajes al Stage Display se mandan por el canal Remote (el canal Stage es solo de lectura).
    case "pp_msg_stage":
      if (!a.texto) throw new Error("El mensaje está vacío");
      ctx.pp.remoto({ action: "stageDisplaySendMessage", stageDisplayMessage: String(a.texto) }, `mensaje al Stage "${a.texto}"`);
      return "Stage Display: mensaje";
    case "pp_ocultar_msg": ctx.pp.remoto({ action: "stageDisplayHideMessage" }, "ocultar mensaje del Stage"); return "Stage Display: ocultar mensaje";

    // ----- Resolume -----
    case "rs_columna":
      await rs.disparar(plantilla(osc.columna, { n: a.n }), silencioso);
      return `Resolume: columna ${a.n}`;
    case "rs_clip":
      await rs.disparar(plantilla(osc.clip, { n: a.capa, capa: a.capa, clip: a.clip }), silencioso);
      return `Resolume: capa ${a.capa}, clip ${a.clip}`;
    case "rs_limpiar_capa":
      await rs.disparar(plantilla(osc.limpiarCapa, { n: a.n, capa: a.n }), silencioso);
      return `Resolume: limpiar capa ${a.n}`;
    case "rs_desconectar_todo":
      await rs.disparar(osc.desconectarTodo, silencioso);
      return "Resolume: desconectar todo";
    case "rs_opacidad_capa":
      await rs.enviar(plantilla(osc.opacidadCapa, { n: a.n, capa: a.n }), [{ t: "f", v: normalizado(a.valor) }], silencioso);
      return `Resolume: opacidad capa ${a.n} = ${a.valor}%`;
    case "rs_opacidad_master":
      await rs.enviar(osc.opacidadMaster, [{ t: "f", v: normalizado(a.valor) }], silencioso);
      return `Resolume: opacidad master = ${a.valor}%`;
    case "rs_osc": {
      const dir = String(a.direccion ?? "").trim();
      let args: ArgOSC[] = [];
      if (a.tipoValor === "f") args = [{ t: "f", v: Number(a.valor) }];
      else if (a.tipoValor === "i") args = [{ t: "i", v: Number(a.valor) }];
      else if (a.tipoValor === "s") args = [{ t: "s", v: String(a.valor ?? "") }];
      if (args[0] && args[0].t !== "s" && !Number.isFinite(Number(args[0].v))) throw new Error(`El valor "${a.valor}" no es un número`);
      await rs.enviar(dir, args, silencioso);
      return `Resolume: OSC ${dir}`;
    }

    // ----- Espera -----
    case "espera": {
      const ms = Math.min(60000, Math.max(0, Number(a.ms) || 0));
      await pausa(ms);
      return `Espera ${ms} ms`;
    }
    default: throw new Error(`Acción desconocida: ${a.tipo}`);
  }
}

/** Ejecuta todas las acciones de un botón en orden. `alPaso` permite informar el avance. */
export async function ejecutarBoton(
  boton: Pick<Boton, "acciones">, ctx: Contexto, alPaso?: (r: ResultadoPaso, total: number) => void,
): Promise<ResultadoBoton> {
  const pasos: ResultadoPaso[] = [];
  const total = boton.acciones.length;
  for (let i = 0; i < total; i++) {
    const a = boton.acciones[i]!;
    let r: ResultadoPaso;
    try {
      r = { paso: i + 1, descripcion: await ejecutarAccion(a, ctx), ok: true };
    } catch (e: any) {
      r = { paso: i + 1, descripcion: a.tipo, ok: false, error: e?.message ?? String(e) };
    }
    pasos.push(r);
    alPaso?.(r, total);
  }
  return { ok: pasos.every((p) => p.ok), pasos };
}

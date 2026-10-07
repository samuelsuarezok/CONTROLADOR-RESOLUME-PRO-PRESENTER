// Detección de las direcciones IP locales de esta computadora.
import { networkInterfaces } from "node:os";

export interface DireccionLocal { nombre: string; ip: string }

export function ipsLocales(): DireccionLocal[] {
  const salida: DireccionLocal[] = [];
  for (const [nombre, lista] of Object.entries(networkInterfaces())) {
    for (const i of lista ?? []) {
      // Solo IPv4, sin la interna (127.x) ni las de enlace local (169.254.x, sin DHCP)
      if (i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254.")) salida.push({ nombre, ip: i.address });
    }
  }
  return salida;
}

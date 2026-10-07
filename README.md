# 🎛 Panel Cabina

Botonera web (tipo Stream Deck) para operar **ProPresenter 6** y **Resolume Arena 6** a la vez desde un celular, una tablet o una compu. Cada botón ejecuta una **lista de acciones en orden**. Por ejemplo, «Inicio de prédica» puede ser: limpiar letras en ProPresenter → disparar una columna en Resolume → bajar la opacidad al 40 %.

Funciona **sin internet**. Solo necesita la red local.

## ⬇️ Descargar

Entrá a **[Releases → última versión](https://github.com/samuelsuarezok/CONTROLADOR-RESOLUME-PRO-PRESENTER/releases/latest)** y bajá el archivo de tu sistema:

| Sistema | Archivo |
|---|---|
| **Windows** (10 / 11) | `Panel-Cabina-win-x64.exe` |
| **Mac con chip Apple** (M1, M2, M3, M4…) | `Panel-Cabina-mac-arm64.zip` |
| **Mac con procesador Intel** | `Panel-Cabina-mac-x64.zip` |

¿Qué Mac tengo? Menú  → **Acerca de esta Mac**: si dice «Chip Apple M…» es la de chip Apple; si dice «Procesador Intel», la de Intel.

No hace falta instalar nada más. (En la parte de arriba de esta página, el botón verde «Code» descarga el **código fuente**, no el programa listo para usar.)

---

## 1. Abrirlo

1. Copiá el archivo a una carpeta propia (o a un pendrive). En Mac, primero hacé doble clic en el `.zip` para descomprimirlo.
2. Hacé **doble clic** en el programa. Se abre una ventana negra: **no la cierres** mientras dure el evento.
3. Si Windows muestra un aviso del **Firewall**, tocá **«Permitir acceso»** (marcá redes privadas). Sin eso, los celulares no se pueden conectar.
4. En la ventana vas a ver la dirección (por ejemplo `http://192.168.1.20:3002`) y un código QR.

> **Mac:** la primera vez puede decir que no se puede abrir porque es de un desarrollador no identificado. Hacé clic derecho sobre el archivo → **Abrir** → **Abrir**. Si no funciona, en la Terminal (desde la carpeta del programa): `xattr -d com.apple.quarantine Panel-Cabina-mac-arm64` (o `-mac-x64`). Si dice que no tiene permiso para ejecutarse: `chmod +x Panel-Cabina-mac-arm64`.
>
> **Windows:** si aparece «Windows protegió su PC», tocá **Más información → Ejecutar de todas formas**. No lo abras desde adentro de un `.zip` ni desde una carpeta temporal: la configuración se guarda junto al programa.

Junto al programa se crea una carpeta **`data`** con toda la configuración. Para llevarlo a otra compu, copiá el programa **y** la carpeta `data`. Si la compu se reinicia, al abrirlo de nuevo todo vuelve como estaba.

## 2. Conectar celulares y tablets

1. El celular tiene que estar en **la misma red wifi** que la compu.
2. Escaneá el **código QR** con la cámara, o escribí la dirección en el navegador (Chrome, Safari, Edge).
3. También podés abrir `http://localhost:3002/conectar` en la compu para ver el QR en grande, o tocar el ícono 📱 del panel.

El puerto normal es **3002**. Si está ocupado, el programa usa el siguiente (3003, 3004…) y te lo avisa. Para elegir otro: `Panel-Cabina-win-x64.exe --puerto=4000`.

La barra superior muestra el estado de **Panel** (este dispositivo con la compu), **ProPresenter**, **Stage** y **Resolume**. Si se corta la conexión, el panel reintenta solo y avisa con una franja de color.

## 3. Usar el panel

- **Tocar un botón** ejecuta sus acciones. Se ilumina mientras corre y después muestra ✔ (todo bien) o ✖ (algo falló; aparece qué paso falló y por qué). Si una acción falla, **las demás se ejecutan igual**.
- Los botones con ⚠ piden confirmación («¿Seguro?»).
- Las pestañas de arriba son las páginas (Alabanza, Prédica…). La pestaña **🎛 Manual** tiene controles directos: diapositiva siguiente/anterior, limpiar, mensaje al Stage Display, columnas de Resolume, faders de opacidad y el registro de actividad.
- Todos los dispositivos se ven sincronizados en tiempo real.
- El ícono 🔆 mantiene la pantalla del celular encendida (funciona sin HTTPS usando un video silencioso; hay que tocar la pantalla una vez). Con 🌙 la pantalla puede apagarse.
- Al final de la pestaña **🎛 Manual**, en «Este dispositivo», podés elegir el **tamaño de los botones** (chico, normal o grande). Se guarda en cada celular o tablet por separado.
- En el celular, los indicadores de arriba muestran solo el punto de color cuando todo está bien; si algo falla, aparece el texto («Error», «Conectando…»). Tocá un indicador para ver el detalle.

## 4. Crear y editar botones

El panel está **bloqueado** por defecto: cualquiera puede usar los botones, pero nadie puede cambiarlos.

1. Tocá el candado 🔒 y escribí el **PIN** (de fábrica: **`1234`**; cambialo en ⚙️ Ajustes → Seguridad). El PIN nuevo tiene que ser de **4 a 12 números** (así se escribe fácil con el teclado numérico del celular).
2. Ahora tocar un botón lo **edita** en vez de ejecutarlo. Podés:
   - **＋ Nuevo botón**: texto, emoji, color, confirmación y lista de acciones.
   - Mover (◀ ▶) y duplicar (⧉) botones; renombrar, duplicar, mover y borrar páginas.
   - **▶ Probar**: ejecuta las acciones sin guardar.
3. Tocá el candado otra vez para volver a bloquear.

**Acciones disponibles:** ProPresenter (siguiente, anterior, diapositiva específica, limpiar todo/texto/fondo, mensaje y ocultar mensaje en Stage Display) · Resolume (columna, clip, limpiar capa, desconectar todo, opacidad de capa y master, OSC personalizado) · Espera en milisegundos.

**Copia de seguridad:** en ⚙️ Ajustes podés **exportar** e **importar** toda la configuración en un archivo JSON (el PIN no se incluye).

## 5. Configurar ProPresenter 6

1. En ProPresenter: **Preferencias → Red**. Activá **«Habilitar red»** y anotá el **puerto**.
2. Activá **ProPresenter Remote** → **Controller** y poné una contraseña. Usá la de **Controller**, no la de *Observer*: con la de Observer, ProPresenter conecta pero ignora todas las órdenes (el panel lo avisa con un error).
3. Si querés ver en el panel la diapositiva actual y el reloj, activá también **Stage Display App** y poné su contraseña.
4. En el panel: ⚙️ **Ajustes** → ProPresenter. Cargá la **IP** de la compu de ProPresenter (`127.0.0.1` si es la misma que corre el panel), el **puerto** y las contraseñas. Escribí solo la IP (por ejemplo `192.168.1.20`); si pegás algo como `http://192.168.1.20:50001/`, el panel se queda con la IP sola.

Todas las órdenes, incluidos los **mensajes al Stage Display**, van por la conexión Remote. La conexión Stage Display solo se usa para *leer* la diapositiva actual y el reloj: si no conecta, todo lo demás funciona igual.

Si la red se corta sin aviso (se cae el wifi, se desenchufa el cable), el panel lo detecta en unos 20 segundos, marca ProPresenter en «Error» y se reconecta solo cuando vuelve la red.

> ⚠️ El protocolo de ProPresenter 6 **no es oficial** (documentación de la comunidad: github.com/jeffmikels/ProPresenter-API). Probalo con tu versión antes del evento.

Para la acción **«Disparar diapositiva específica»**, usá el botón *Cargar lista desde ProPresenter* para elegir la presentación (así el nombre queda exactamente como lo espera el programa).

## 6. Configurar Resolume Arena 6

1. En Resolume: **Preferencias → OSC**. Activá **OSC Input** y anotá el **puerto** (por defecto **7000**).
2. En el panel: ⚙️ **Ajustes** → Resolume: **IP** de la compu de Resolume y ese **puerto**.

### Verificar las direcciones OSC (importante)

Las direcciones están en ⚙️ Ajustes → *Direcciones OSC* y se pueden cambiar. Los valores de fábrica son:

| Acción | Dirección |
|---|---|
| Columna | `/composition/columns/{n}/connect` |
| Clip | `/composition/layers/{capa}/clips/{clip}/connect` |
| Limpiar capa | `/composition/layers/{n}/clear` |
| Opacidad de capa | `/composition/layers/{n}/video/opacity` |
| Opacidad master | `/composition/master` |
| Desconectar todo | `/composition/disconnectall` |

(`{n}`, `{capa}` y `{clip}` se reemplazan por el número que elijas en el botón.)

Columna, clip, limpiar capa y desconectar todo se mandan como un botón real: **1** (apretar) y, 50 ms después, **0** (soltar), igual que lo hace Bitfocus Companion. Sin el «soltar», Resolume puede ignorar el siguiente toque del mismo control.

**Cómo comprobar la dirección correcta en tu Resolume:**

1. En Resolume, activá el **modo de edición de atajos OSC**: menú **Atajos → Editar atajos OSC** (o el botón correspondiente en la barra superior).
2. Pasá el mouse por encima del control que querés manejar (una columna, un clip, el fader de una capa…): Resolume muestra su **dirección OSC**.
3. Copiala tal cual en Ajustes. Para una columna o capa distinta, reemplazá el número por `{n}`.
4. Probá con el botón **▶ Probar** del editor, o con la pestaña Manual.

Para casos especiales usá la acción **«Mensaje OSC personalizado»** (dirección, tipo de valor y valor).

> **Sobre el estado de Resolume:** OSC por UDP no confirma que Resolume recibió el mensaje. Por eso el estado normal es **«Listo»** (el envío funciona), no «Conectado». Si querés que diga «Conectado», en Resolume activá **OSC Output** apuntando a la IP de este panel y poné ese puerto en Ajustes → «Puerto para recibir respuestas».

## 7. Modo simulación

⚙️ Ajustes → **Modo simulación**. El panel funciona completo (botones, estados, diapositiva y reloj de prueba) sin ProPresenter ni Resolume. Todo lo que se enviaría queda en el **registro** de la pestaña Manual. Ideal para ensayar la botonera. Recordá **desactivarlo** antes del evento.

## 8. Solución de problemas

**El celular no abre la página**
- ¿Está en la **misma wifi** que la compu? (no vale datos móviles)
- **Firewall de Windows:** *Panel de control → Firewall de Windows → Permitir una aplicación* y marcá el programa en redes **privadas** (y públicas si la wifi del lugar figura como pública). También podés cerrar el programa y volver a abrirlo para que Windows pregunte de nuevo.
- Algunas wifi (hoteles, iglesias con red de invitados, redes con «aislamiento de clientes / AP isolation») **bloquean la comunicación entre dispositivos**. Solución: usar un **router propio** para el equipo técnico, o conectar la compu por cable al mismo router.
- Si la compu tiene varias redes, probá las otras direcciones de la lista.

**La IP cambió**
- Si la compu recibe una IP distinta, la dirección del celular deja de servir. Volvé a escanear el QR. Lo ideal es **reservar una IP fija** para la compu en el router (reserva DHCP).
- Lo mismo para la IP de ProPresenter/Resolume en Ajustes.

**ProPresenter figura «Error» o «Conectando…»**
- Revisá IP, puerto y contraseña (tocá la etiqueta de estado para ver el detalle).
- Confirmá que en ProPresenter esté habilitada la red y el Remoto.
- Si el detalle dice **«solo lectura (Observer)»**, cargaste la contraseña de Observer: poné la de **Controller**.

**Resolume no reacciona**
- Revisá que **OSC Input** esté activo, y que IP y puerto coincidan.
- Verificá las direcciones OSC (sección 6).
- Si Resolume está en otra compu, revisá el firewall de esa compu para UDP.

**«Puerto ocupado»**
- El programa prueba el siguiente puerto automáticamente. Mirá cuál usó en la ventana.

**Olvidé el PIN**
- Cerrá el programa, abrí `data/config.json` con el Bloc de notas, cambiá el valor de `"pin"` y guardá.

---

## Para quien compila el programa

Requiere [Bun](https://bun.sh) **solo para compilar** (la primera vez necesita internet para bajar los runtimes).

```
bun install
bun run build        # genera dist/ para Windows y Mac
bun run build:win    # solo Windows (.exe)
bun run build:mac    # solo Mac (arm64 y x64)
bun run dev          # modo desarrollo
bun run test         # prueba de punta a punta con ProPresenter y Resolume simulados
```
En Windows también podés hacer doble clic en `build.bat`.

### Publicar una versión nueva

1. Cambiá el número en `package.json` y en `APP_VERSION` (`src/server.ts`).
2. Subí los cambios y una etiqueta con ese número:
   ```
   git tag v1.2.0
   git push origin main v1.2.0
   ```
3. GitHub Actions (`.github/workflows/publicar.yml`) corre la prueba, compila en una Mac (así los ejecutables de Mac quedan firmados) y publica los tres archivos en **Releases**. Si la prueba falla, no se publica nada.

```
src/            servidor (Bun): HTTP/WebSocket, acciones, integraciones, almacenamiento
  integraciones/  resolume.ts (OSC/UDP), propresenter.ts (WebSocket), osc.ts
public/         interfaz web (se embebe dentro del ejecutable)
scripts/        build.ts, embeber.ts, prueba.ts
data/           configuración (se crea junto al ejecutable)
dist/           ejecutables generados (no se suben a git: se publican en Releases)
.github/        publicación automática de versiones
```

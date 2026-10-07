/* ============================================================
   Panel Cabina — cliente web (JavaScript puro, sin librerías).
   El servidor es la fuente de verdad: este código solo muestra
   el estado y envía órdenes por WebSocket.
   ============================================================ */
(() => {
  'use strict';

  // ---------- Estado local ----------
  const S = {
    vista: null,            // { paginas, manual, rev }
    estado: { master: 100, capas: {} },
    con: { pp: null, rs: null },
    editor: false, pinMem: null, ajustes: null, pinDefecto: false,
    pagina: null,           // id de página, o 'manual'
    log: [],
    ejecEstado: {},         // id botón -> { fase, paso, total }
    mios: new Set(),        // botones tocados desde ESTE dispositivo (para mostrar el detalle del error)
    ws: null, red: 'conectando',
    msgStage: '',           // texto escrito para el Stage Display (sobrevive a los redibujos)
  };

  // ---------- Utilidades ----------
  const $ = (s, r = document) => r.querySelector(s);
  /** Crea elementos de forma segura (siempre texto, nunca HTML). */
  function h(tag, attrs, ...hijos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k in e && k !== 'list') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of hijos.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const guardarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const leerLocal = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const vibrar = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  function colorTexto(hex) { // texto oscuro sobre fondos muy claros
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? 'oscuro' : '';
  }

  function toast(titulo, detalle, tipo = 'info', ms = 3500) {
    const t = h('div', { class: 'toast ' + tipo }, h('b', {}, titulo), detalle ? h('div', {}, detalle) : null);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), ms);
  }

  // ---------- Modales ----------
  /** Abre un modal. Escape lo cierra (o llama a alCancelar, si se indica). */
  function modal(contenido, { cerrarAfuera = false, alCancelar } = {}) {
    const fondo = h('div', { class: 'fondo' }, h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, contenido));
    const tecla = (e) => {
      if (e.key !== 'Escape' || fondo !== $('#modales').lastElementChild) return; // solo el de más arriba
      e.preventDefault(); (alCancelar || cerrar)();
    };
    const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', tecla); };
    if (cerrarAfuera) fondo.addEventListener('pointerdown', (e) => { if (e.target === fondo) cerrar(); });
    document.addEventListener('keydown', tecla);
    $('#modales').append(fondo);
    return cerrar;
  }

  function confirmar(titulo, texto, botonTexto = 'Sí, seguro', peligro = true) {
    return new Promise((ok) => {
      let cerrar;
      const fin = (v) => { cerrar(); ok(v); };
      const cancelar = h('button', { class: 'b', onclick: () => fin(false) }, 'Cancelar');
      cerrar = modal([
        h('h2', {}, titulo), h('p', { style: 'font-size:18px' }, texto),
        h('div', { class: 'pie' },
          cancelar,
          h('button', { class: 'b ' + (peligro ? 'peligro' : 'primario'), onclick: () => fin(true) }, botonTexto)),
      ], { alCancelar: () => fin(false) });
      cancelar.focus(); // Enter por accidente no confirma nada peligroso
    });
  }

  // ---------- Conexión WebSocket con reconexión automática ----------
  let intentos = 0, ultimoMensaje = 0, timerRe = null;

  function conectarWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try { ws = new WebSocket(`${proto}://${location.host}/ws`); } catch { return reintentar(); }
    S.ws = ws;
    ws.onopen = () => { intentos = 0; ultimoMensaje = Date.now(); };
    ws.onmessage = (ev) => { ultimoMensaje = Date.now(); try { recibir(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
    ws.onclose = () => { if (S.ws === ws) { S.ws = null; ponerRed(intentos > 3 ? 'desconectado' : 'reconectando'); reintentar(); } };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  function reintentar() {
    clearTimeout(timerRe);
    intentos++;
    timerRe = setTimeout(conectarWS, Math.min(3000, 400 * intentos));
  }
  function enviar(obj) {
    if (S.ws && S.ws.readyState === 1) { S.ws.send(JSON.stringify(obj)); return true; }
    return false;
  }
  // Latido: detecta conexiones "muertas" (pasa seguido en celulares al dormir la pantalla)
  setInterval(() => {
    if (S.ws && S.ws.readyState === 1) {
      enviar({ t: 'ping' });
      if (Date.now() - ultimoMensaje > 20000) { try { S.ws.close(); } catch {} }
    }
  }, 7000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!S.ws || S.ws.readyState > 1)) { clearTimeout(timerRe); conectarWS(); }
  });

  function ponerRed(r) {
    S.red = r;
    const av = $('#aviso-conexion');
    av.hidden = r === 'conectado';
    av.className = r === 'reconectando' ? 'reconectando' : '';
    av.textContent = r === 'reconectando' ? '⏳ Reconectando con el panel…' : '⛔ DESCONECTADO del panel — reintentando…';
    document.body.style.setProperty('--sin-red', r === 'conectado' ? '0' : '1');
    pintarEstados();
  }

  // ---------- Mensajes del servidor ----------
  function recibir(m) {
    switch (m.t) {
      case 'hola':
        S.vista = m.vista; S.estado = m.estado; S.con = { pp: m.pp, rs: m.rs }; S.log = m.registro || [];
        if (!S.pagina || (S.pagina !== 'manual' && !S.vista.paginas.some((p) => p.id === S.pagina))) {
          S.pagina = leerLocal('pagina', null);
          if (S.pagina !== 'manual' && !S.vista.paginas.some((p) => p.id === S.pagina)) S.pagina = S.vista.paginas[0].id;
        }
        ponerRed('conectado');
        if (S.editor && S.pinMem) enviar({ t: 'pin', pin: S.pinMem }); // recuperar el modo edición tras reconectar
        else if (S.editor) salirEditorLocal();
        dibujarTodo();
        break;
      case 'vista':
        S.vista = m;
        if (S.pagina !== 'manual' && !m.paginas.some((p) => p.id === S.pagina)) S.pagina = m.paginas[0].id;
        dibujarTodo();
        break;
      case 'estado': S.estado = m.estado; actualizarFaders(); break;
      case 'con': S.con = { pp: m.pp, rs: m.rs }; pintarEstados(); break;
      case 'log': S.log.push(m.e); if (S.log.length > 120) S.log.shift(); agregarLog(m.e); break;
      case 'ejec': recibirEjec(m); break;
      case 'editor':
        if (m.ok) { S.editor = true; document.body.classList.add('editor'); dibujarTodo(); }
        else if (m.salio) salirEditorLocal();
        else { S.pinMem = null; if (S.editor) salirEditorLocal(); toast('No se pudo entrar', m.msg, 'error'); }
        break;
      case 'ajustes': S.ajustes = m.ajustes; S.pinDefecto = m.pinPorDefecto; break;
      case 'error': toast('No se pudo', m.msg, 'error', 5000); break;
      case 'biblioteca':
        if (m.error) toast('No se pudo leer la biblioteca', m.error, 'error', 5000);
        else {
          const dl = $('#lista-biblioteca'); dl.textContent = '';
          // El valor es la ruta completa (la que espera ProPresenter); la etiqueta, solo el nombre para buscar fácil.
          for (const x of m.lista) dl.append(h('option', { value: x, label: x.split(/[\\/]/).pop().replace(/\.pro6?$/i, '') }));
          toast('Biblioteca cargada', m.lista.length + ' presentaciones', 'ok');
        }
        break;
      case 'exportar': descargarJSON(m.datos); break;
      case 'accionError': toast('Falló la acción', m.msg, 'error', 5000); break;
      case 'accionOk': marcarManual(m.ref, true); break;
      case 'prueba': mostrarPrueba(m); break;
    }
  }

  // ---------- Ejecución de botones (feedback) ----------
  function recibirEjec(m) {
    const el = document.querySelector(`.btn[data-id="${m.id}"]`);
    const marca = el && el.querySelector('.marca');
    if (m.fase === 'inicio') {
      S.ejecEstado[m.id] = { paso: 0, total: m.total };
      if (el) { el.classList.remove('ok', 'error'); el.classList.add('corriendo'); }
    } else if (m.fase === 'paso') {
      const e = S.ejecEstado[m.id]; if (e) e.paso = m.paso;
      if (el) el.querySelector('.prog').style.width = (m.paso / m.total * 100) + '%';
    } else if (m.fase === 'fin') {
      delete S.ejecEstado[m.id];
      if (el) {
        el.classList.remove('corriendo');
        el.querySelector('.prog').style.width = '0';
        el.classList.add(m.ok ? 'ok' : 'error');
        marca.textContent = m.ok ? '✔' : '✖';
        clearTimeout(el._quitarMarca); // si se vuelve a tocar enseguida, el aviso anterior no borra el nuevo
        el._quitarMarca = setTimeout(() => el.classList.remove('ok', 'error'), m.ok ? 1300 : 4000);
      }
      if (S.mios.has(m.id)) {
        S.mios.delete(m.id);
        if (m.ok) vibrar(30);
        else {
          vibrar([80, 60, 80]);
          const malos = (m.pasos || []).filter((p) => !p.ok);
          toast('Algo falló', malos.map((p) => `Paso ${p.paso}: ${p.error}`).join('\n'), 'error', 7000);
        }
      }
    }
  }

  function pulsarBoton(b) {
    if (S.editor) return abrirEditorBoton(b);
    if (S.red !== 'conectado') return toast('Sin conexión', 'El panel no está conectado al servidor.', 'error');
    const ir = () => { S.mios.add(b.id); enviar({ t: 'ejecutar', id: b.id }); };
    if (b.confirmar) confirmar('¿Seguro?', `${b.icono} ${b.texto}`.trim(), 'Sí, ejecutar').then((si) => si && ir());
    else ir();
  }

  // ---------- Dibujo: barra superior ----------
  const ETIQUETA = { conectado: 'Conectado', conectando: 'Conectando…', error: 'Error', desactivado: 'Desactivado', simulado: 'Simulado', listo: 'Listo' };

  const SANO = ['conectado', 'listo', 'simulado'];
  function chip(nombre, info) {
    const est = info ? info.estado : 'conectando';
    const verDetalle = () => toast(nombre + ': ' + (ETIQUETA[est] || est), (info && info.detalle) || '', est === 'error' ? 'error' : 'info', 5000);
    // "sano": en pantallas chicas solo se ve el punto de color; el texto aparece cuando hay un problema.
    return h('span', {
      class: 'chip ' + est + (SANO.includes(est) ? ' sano' : ''), title: info ? info.detalle : '', role: 'button', tabindex: 0,
      onclick: verDetalle, onkeydown: (e) => { if (e.key === 'Enter') verDetalle(); },
    }, h('i'), nombre, h('small', {}, ETIQUETA[est] || est));
  }

  function pintarEstados() {
    const c = $('#estados'); c.textContent = '';
    const redInfo = { estado: S.red === 'conectado' ? 'conectado' : S.red === 'reconectando' ? 'conectando' : 'error', detalle: 'Conexión de este dispositivo con el panel' };
    const chPanel = chip('Panel', redInfo); chPanel.classList.add('panel'); c.append(chPanel);
    if (S.con.pp) { c.append(chip('ProPresenter', S.con.pp.remote)); if (S.con.pp.stage.estado !== 'desactivado') c.append(chip('Stage', S.con.pp.stage)); }
    if (S.con.rs) c.append(chip('Resolume', S.con.rs));
    const sim = (S.con.rs && S.con.rs.estado === 'simulado');
    $('#aviso-sim').hidden = !sim;
    const f = $('#envivo'); f.textContent = '';
    if (S.con.pp && (S.con.pp.hora || S.con.pp.slide)) {
      f.append(h('span', {}, '🕒 ', h('b', {}, S.con.pp.hora || '--:--')));
      if (S.con.pp.slide) f.append(h('span', { class: 'slide' }, '▶ ', h('b', {}, S.con.pp.slide.replace(/\s+/g, ' '))));
    }
  }

  // ---------- Dibujo: pestañas, página y botonera ----------
  function dibujarTodo() {
    pintarEstados();
    dibujarPestanas();
    dibujarHerramientasPagina();
    dibujarContenido();
    $('#b-editar').textContent = S.editor ? '🔓' : '🔒';
    $('#b-editar').classList.toggle('activo', S.editor);
    $('#aviso-edicion').hidden = !S.editor;
  }

  function irAPagina(id) { S.pagina = id; guardarLocal('pagina', id); dibujarPestanas(); dibujarHerramientasPagina(); dibujarContenido(); }

  function dibujarPestanas() {
    const n = $('#pestanas'); n.textContent = '';
    if (!S.vista) return;
    for (const p of S.vista.paginas) n.append(h('button', { class: 'pestana' + (S.pagina === p.id ? ' activa' : ''), onclick: () => irAPagina(p.id) }, p.nombre));
    if (S.editor) n.append(h('button', { class: 'pestana nueva', onclick: () => op({ op: 'pagina.nueva', nombre: 'Nueva página' }) }, '＋ Página'));
    n.append(h('button', { class: 'pestana manual' + (S.pagina === 'manual' ? ' activa' : ''), onclick: () => irAPagina('manual') }, '🎛 Manual'));
    // En el celular las pestañas se deslizan: que la elegida siempre quede a la vista.
    const activa = n.querySelector('.pestana.activa:not(.manual)');
    if (activa) activa.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function dibujarHerramientasPagina() {
    const t = $('#herr-pagina');
    const p = paginaActual();
    t.hidden = !(S.editor && p);
    if (t.hidden) return;
    t.textContent = '';
    t.append(h('span', {}, 'Página:'),
      h('button', { class: 'b chico', onclick: () => pedirNombre('Nombre de la página', p.nombre).then((n) => n && op({ op: 'pagina.guardar', id: p.id, nombre: n })) }, '✏️ Renombrar'),
      h('button', { class: 'b chico', onclick: () => op({ op: 'pagina.duplicar', id: p.id }) }, '⧉ Duplicar'),
      h('button', { class: 'b chico', onclick: () => op({ op: 'pagina.mover', id: p.id, dir: -1 }) }, '◀'),
      h('button', { class: 'b chico', onclick: () => op({ op: 'pagina.mover', id: p.id, dir: 1 }) }, '▶'),
      h('button', { class: 'b chico peligro', onclick: () => confirmar('Borrar página', `¿Borrar "${p.nombre}" con sus ${p.botones.length} botones?`, 'Borrar').then((si) => si && op({ op: 'pagina.borrar', id: p.id })) }, '🗑 Borrar'));
  }

  const paginaActual = () => S.vista && S.vista.paginas.find((p) => p.id === S.pagina);

  function dibujarContenido() {
    const c = $('#contenido'); const scroll = c.scrollTop;
    c.textContent = '';
    if (!S.vista) { c.append(h('p', { class: 'vacio-msg' }, 'Conectando con el panel…')); return; }
    if (S.pagina === 'manual') { dibujarManual(c); return; }
    const p = paginaActual(); if (!p) return;
    const g = h('div', { class: 'grilla' });
    p.botones.forEach((b) => g.append(botonDOM(b, p)));
    if (S.editor) g.append(h('button', { class: 'btn vacio', onclick: () => abrirEditorBoton(null, p.id) }, h('span', { class: 'ico' }, '＋'), h('span', { class: 'txt' }, 'Nuevo botón')));
    c.append(g);
    if (!p.botones.length && !S.editor) c.append(h('p', { class: 'vacio-msg' }, 'Esta página no tiene botones. Entrá al modo edición (🔒) para crearlos.'));
    c.scrollTop = scroll;
  }

  function botonDOM(b, pagina) {
    const el = h('div', {
      class: `btn ${colorTexto(b.color)} ${b.confirmar ? 'confirma' : ''} ${S.ejecEstado[b.id] ? 'corriendo' : ''}`, role: 'button', tabindex: 0,
      style: `background:${b.color}`, 'data-id': b.id,
      onclick: (e) => { if (e.target.closest('.herr span')) return; pulsarBoton(b); },
      onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); pulsarBoton(b); } },
    },
      h('div', { class: 'herr' },
        h('span', { onclick: () => op({ op: 'boton.mover', pagina: pagina.id, id: b.id, dir: -1 }) }, '◀'),
        h('span', { onclick: () => op({ op: 'boton.duplicar', pagina: pagina.id, id: b.id }) }, '⧉'),
        h('span', { onclick: () => op({ op: 'boton.mover', pagina: pagina.id, id: b.id, dir: 1 }) }, '▶')),
      b.icono ? h('span', { class: 'ico' }, b.icono) : null,
      h('span', { class: 'txt' }, b.texto),
      h('div', { class: 'marca' }), h('div', { class: 'prog' }));
    return el;
  }

  // ---------- Control manual ----------
  const refsManual = new Map(); let refN = 0;

  function marcarManual(ref, ok) {
    const el = refsManual.get(ref); if (!el) return;
    refsManual.delete(ref);
    el.classList.add(ok ? 'ok' : 'error'); setTimeout(() => el.classList.remove('ok', 'error'), 700);
  }
  function accion(a, el) {
    if (S.red !== 'conectado') return toast('Sin conexión', 'El panel no está conectado al servidor.', 'error');
    const ref = ++refN; if (el) refsManual.set(ref, el);
    vibrar(15);
    enviar({ t: 'accion', accion: a, ref });
  }
  const bm = (txt, a, clase = '') => { const el = h('button', { class: 'bm ' + clase }, txt); el.onclick = () => accion(a, el); return el; };

  function dibujarManual(c) {
    const man = S.vista.manual;
    c.append(
      h('div', { class: 'seccion' }, h('h2', {}, 'ProPresenter'),
        h('div', { class: 'fila-botones grandes' },
          bm('⏮ Anterior', { tipo: 'pp_anterior' }, 'grande'), bm('Siguiente ⏭', { tipo: 'pp_siguiente' }, 'grande azul')),
        h('div', { class: 'fila-botones tres-col', style: 'margin-top:10px' },
          bm('Limpiar todo', { tipo: 'pp_limpiar_todo' }, 'rojo'), bm('Limpiar texto', { tipo: 'pp_limpiar_texto' }), bm('Limpiar fondo', { tipo: 'pp_limpiar_fondo' })),
        (() => {
          // El texto se conserva aunque la pantalla se redibuje (cambios desde otro dispositivo, reconexión).
          const inp = h('input', { type: 'text', placeholder: 'Mensaje para el Stage Display…', maxLength: 300, value: S.msgStage, enterKeyHint: 'send', 'aria-label': 'Mensaje para el Stage Display' });
          const env = h('button', { class: 'b primario' }, 'Enviar');
          const mandar = () => inp.value.trim() && accion({ tipo: 'pp_msg_stage', texto: inp.value.trim() }, env);
          env.onclick = mandar;
          inp.oninput = () => { S.msgStage = inp.value; };
          inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); mandar(); } };
          const oc = h('button', { class: 'b' }, 'Ocultar'); oc.onclick = () => accion({ tipo: 'pp_ocultar_msg' }, oc);
          return h('div', { class: 'fila-msg' }, inp, env, oc);
        })()),
      h('div', { class: 'seccion' }, h('h2', {}, 'Resolume — columnas'),
        h('div', { class: 'fila-botones columnas' }, Array.from({ length: man.columnas }, (_, i) => bm('Col ' + (i + 1), { tipo: 'rs_columna', n: i + 1 }))),
        h('div', { class: 'fila-botones', style: 'margin-top:10px' }, bm('Desconectar todo', { tipo: 'rs_desconectar_todo' }, 'rojo'))),
      h('div', { class: 'seccion' }, h('h2', {}, 'Resolume — opacidad'),
        fader('Master', 'master', 0),
        ...Array.from({ length: man.capas }, (_, i) => fader('Capa ' + (i + 1), 'capa', i + 1))),
      h('div', { class: 'seccion' }, h('h2', {}, 'Registro de actividad'), h('div', { class: 'registro', id: 'registro' })),
      h('div', { class: 'seccion' }, h('h2', {}, 'Este dispositivo'),
        h('div', { class: 'campo' }, h('label', {}, 'Tamaño de los botones'), selectorTamano())));
    const reg = $('#registro'); S.log.forEach((e) => agregarLog(e, true)); reg.scrollTop = reg.scrollHeight;
  }

  // ---------- Tamaño de los botones (se guarda en cada dispositivo) ----------
  const TAMANOS = [['chico', 'Chico', 115], ['normal', 'Normal', 150], ['grande', 'Grande', 200]];
  function aplicarTamano() {
    const t = TAMANOS.find(([id]) => id === leerLocal('tamano', 'normal')) || TAMANOS[1];
    document.documentElement.style.setProperty('--tam', t[2] + 'px');
  }
  function selectorTamano() {
    const actual = leerLocal('tamano', 'normal');
    return h('div', { class: 'segmentos', role: 'group' }, TAMANOS.map(([id, nombre]) => h('button', {
      class: 'b chico' + (id === actual ? ' primario' : ''), 'aria-pressed': String(id === actual),
      onclick: () => { guardarLocal('tamano', id); aplicarTamano(); dibujarContenido(); },
    }, nombre)));
  }

  function valorFader(tipo, n) { return tipo === 'master' ? S.estado.master : (S.estado.capas[String(n)] ?? 100); }

  function fader(nombre, tipo, n) {
    const salida = h('output', {}, valorFader(tipo, n) + '%');
    let ultimo = 0, pendiente = null;
    const rango = h('input', { type: 'range', min: 0, max: 100, step: 1, value: valorFader(tipo, n), 'data-tipo': tipo, 'data-n': n, 'aria-label': 'Opacidad ' + nombre });
    rango.addEventListener('input', () => {
      salida.textContent = rango.value + '%';
      const ahora = Date.now();
      const mandar = () => { ultimo = Date.now(); enviar({ t: 'fader', tipo, n, valor: Number(rango.value) }); };
      clearTimeout(pendiente);
      if (ahora - ultimo > 70) mandar(); else pendiente = setTimeout(mandar, 70); // limita la frecuencia de envío
    });
    // Mientras se arrastra no se aplican los valores que llegan del servidor. Hay que soltar en TODOS
    // los casos (en el celular el navegador a veces cancela el gesto); si no, el fader quedaba congelado.
    const soltar = () => { delete rango.dataset.arrastrando; };
    rango.addEventListener('pointerdown', () => { rango.dataset.arrastrando = '1'; });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture', 'change', 'blur']) rango.addEventListener(ev, soltar);
    const fila = h('div', { class: 'fader' }, h('label', {}, nombre), rango, salida);
    if (tipo === 'capa') { const lim = h('button', { class: 'bm limpiar', title: 'Limpiar capa ' + n }, 'Limpiar'); lim.onclick = () => accion({ tipo: 'rs_limpiar_capa', n }, lim); fila.append(lim); }
    else fila.append(h('span')); // celda vacía: así todos los faders tienen el mismo largo
    return fila;
  }

  function actualizarFaders() {
    document.querySelectorAll('input[type=range][data-tipo]').forEach((r) => {
      if (r.dataset.arrastrando) return;
      const v = valorFader(r.dataset.tipo, r.dataset.n);
      r.value = v; r.nextSibling.textContent = v + '%';
    });
  }

  function agregarLog(e, sinScroll) {
    const reg = $('#registro'); if (!reg) return;
    reg.append(h('div', { class: e.nivel }, h('span', { class: 'h' }, e.hora + '  '), e.texto));
    while (reg.childNodes.length > 120) reg.firstChild.remove();
    if (!sinScroll) reg.scrollTop = reg.scrollHeight;
  }

  // ---------- Edición: operaciones ----------
  function op(operacion) {
    if (enviar({ t: 'editar', operacion })) return true;
    toast('Sin conexión', 'No se pudo guardar el cambio.', 'error');
    return false;
  }

  function pedirNombre(titulo, actual) {
    return new Promise((ok) => {
      const inp = h('input', { type: 'text', value: actual, maxLength: 40 });
      let cerrar; const fin = (v) => { cerrar(); ok(v); };
      cerrar = modal([h('h2', {}, titulo), inp, h('div', { class: 'pie' },
        h('button', { class: 'b', onclick: () => fin(null) }, 'Cancelar'),
        h('button', { class: 'b primario', onclick: () => fin(inp.value.trim() || null) }, 'Guardar'))]);
      inp.focus(); inp.select();
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') fin(inp.value.trim() || null); });
    });
  }

  // ---------- Modo edición: PIN ----------
  function pedirPin() {
    const inp = h('input', { type: 'password', class: 'pin-in', inputMode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxLength: 12, placeholder: '••••', 'aria-label': 'PIN' });
    let cerrar;
    const probar = () => { S.pinMem = inp.value; enviar({ t: 'pin', pin: inp.value }); cerrar(); };
    cerrar = modal([h('h2', {}, '🔓 Entrar al modo edición'), h('p', { style: 'color:var(--txt2)' }, 'Ingresá el PIN para crear o modificar botones.'), inp,
      h('div', { class: 'pie' }, h('button', { class: 'b', onclick: () => cerrar() }, 'Cancelar'), h('button', { class: 'b primario', onclick: probar }, 'Entrar'))]);
    inp.focus();
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') probar(); });
  }

  function salirEditorLocal() {
    S.editor = false; S.pinMem = null; S.ajustes = null;
    document.body.classList.remove('editor');
    document.querySelectorAll('.fondo').forEach((f) => f.remove());
    if (S.vista) dibujarTodo();
  }

  // ---------- Editor de botones ----------
  const EMOJIS = '▶️ ⏸️ ⏭️ ⏮️ ⏹️ 🔊 🔇 🎵 🎶 🎤 🎸 🥁 🙏 ✝️ 📖 ✨ 🔥 🕊️ ❤️ 🌅 🌌 🌊 🌲 ☁️ ⭐ 💡 🔆 ⬛ ⬜ 🎬 🎞️ 📢 📣 ⏱️ ⏰ 🧹 🚫 🛑 ⚠️ 🏠 👋 🎁 🎉 ☕'.split(' ');
  const COLORES = ['#2563eb', '#7c3aed', '#be185d', '#b91c1c', '#c2410c', '#b45309', '#15803d', '#0f766e', '#0369a1', '#475569', '#111827', '#e2e8f0'];

  const GRUPOS = [
    ['ProPresenter', [
      ['pp_siguiente', 'Siguiente diapositiva', []],
      ['pp_anterior', 'Diapositiva anterior', []],
      ['pp_slide', 'Disparar diapositiva específica', [{ k: 'ruta', et: 'Presentación', tipo: 'ruta' }, { k: 'diapositiva', et: 'N.º de diapositiva (desde 1)', tipo: 'num', def: 1, min: 1, max: 9999 }]],
      ['pp_limpiar_todo', 'Limpiar todo', []],
      ['pp_limpiar_texto', 'Limpiar texto', []],
      ['pp_limpiar_fondo', 'Limpiar fondo', []],
      ['pp_msg_stage', 'Enviar mensaje al Stage Display', [{ k: 'texto', et: 'Mensaje', tipo: 'texto', def: '' }]],
      ['pp_ocultar_msg', 'Ocultar mensaje del Stage Display', []],
    ]],
    ['Resolume', [
      ['rs_columna', 'Disparar columna', [{ k: 'n', et: 'Columna', tipo: 'num', def: 1, min: 1, max: 999 }]],
      ['rs_clip', 'Disparar clip', [{ k: 'capa', et: 'Capa', tipo: 'num', def: 1, min: 1, max: 999 }, { k: 'clip', et: 'Clip', tipo: 'num', def: 1, min: 1, max: 999 }]],
      ['rs_limpiar_capa', 'Limpiar capa', [{ k: 'n', et: 'Capa', tipo: 'num', def: 1, min: 1, max: 999 }]],
      ['rs_desconectar_todo', 'Desconectar todo (limpiar composición)', []],
      ['rs_opacidad_capa', 'Opacidad de una capa', [{ k: 'n', et: 'Capa', tipo: 'num', def: 1, min: 1, max: 999 }, { k: 'valor', et: 'Opacidad (0-100 %)', tipo: 'num', def: 100, min: 0, max: 100 }]],
      ['rs_opacidad_master', 'Opacidad master', [{ k: 'valor', et: 'Opacidad (0-100 %)', tipo: 'num', def: 100, min: 0, max: 100 }]],
      ['rs_osc', 'Mensaje OSC personalizado', [
        { k: 'direccion', et: 'Dirección OSC', tipo: 'texto', def: '/composition/' },
        { k: 'tipoValor', et: 'Tipo de valor', tipo: 'sel', def: 'f', opciones: [['f', 'Decimal (0.5)'], ['i', 'Entero (1)'], ['s', 'Texto'], ['ninguno', 'Sin valor']] },
        { k: 'valor', et: 'Valor', tipo: 'texto', def: '1' }]],
    ]],
    ['Otros', [['espera', 'Esperar (pausa)', [{ k: 'ms', et: 'Milisegundos (1000 = 1 segundo)', tipo: 'num', def: 500, min: 0, max: 60000 }]]]],
  ];
  const DEF = {}; GRUPOS.forEach(([, l]) => l.forEach(([id, nombre, campos]) => { DEF[id] = { nombre, campos }; }));

  function abrirEditorBoton(existente, paginaId) {
    const pagina = paginaId || (paginaActual() && paginaActual().id);
    const b = existente ? structuredClone(existente) : { texto: '', icono: '', color: COLORES[0], confirmar: false, acciones: [] };
    const listaAcc = h('div');
    let cerrar;

    const iTexto = h('input', { type: 'text', value: b.texto, maxLength: 60, placeholder: 'Ej.: Inicio de prédica' });
    iTexto.oninput = () => { b.texto = iTexto.value; };
    const iIcono = h('input', { type: 'text', value: b.icono, maxLength: 8, placeholder: 'Emoji o símbolo' });
    iIcono.oninput = () => { b.icono = iIcono.value; };
    const emojis = h('div', { class: 'emojis' }, EMOJIS.map((e) => h('button', { type: 'button', onclick: () => { b.icono = e; iIcono.value = e; } }, e)));

    const sw = h('div', { class: 'colores' });
    const iColor = h('input', { type: 'color', value: b.color });
    const pintarColores = () => {
      sw.textContent = '';
      COLORES.forEach((c) => sw.append(h('button', { type: 'button', class: c === b.color ? 'sel' : '', style: `background:${c}`, onclick: () => { b.color = c; iColor.value = c; pintarColores(); } })));
      sw.append(iColor);
    };
    iColor.oninput = () => { b.color = iColor.value; pintarColores(); };
    pintarColores();

    const iConf = h('input', { type: 'checkbox', checked: !!b.confirmar }); iConf.onchange = () => { b.confirmar = iConf.checked; };

    function dibujarAcciones() {
      listaAcc.textContent = '';
      if (!b.acciones.length) listaAcc.append(h('p', { style: 'color:var(--txt2)' }, 'Sin acciones todavía. Agregá la primera abajo.'));
      b.acciones.forEach((a, i) => listaAcc.append(filaAccion(a, i)));
    }
    function mover(i, d) { const j = i + d; if (j < 0 || j >= b.acciones.length) return; [b.acciones[i], b.acciones[j]] = [b.acciones[j], b.acciones[i]]; dibujarAcciones(); }

    function filaAccion(a, i) {
      const sel = h('select', {}, GRUPOS.map(([g, lista]) => h('optgroup', { label: g }, lista.map(([id, n]) => h('option', { value: id, selected: id === a.tipo }, n)))));
      sel.onchange = () => { b.acciones[i] = nuevaAccion(sel.value); dibujarAcciones(); };
      const campos = (DEF[a.tipo] ? DEF[a.tipo].campos : []).map((c) => campoAccion(a, c));
      return h('div', { class: 'acc' },
        h('div', { class: 'cab' }, h('span', { class: 'n' }, i + 1), sel,
          h('button', { type: 'button', onclick: () => mover(i, -1) }, '↑'), h('button', { type: 'button', onclick: () => mover(i, 1) }, '↓'),
          h('button', { type: 'button', onclick: () => { b.acciones.splice(i, 1); dibujarAcciones(); } }, '✕')),
        campos.length ? h('div', { class: campos.length > 2 ? 'tres' : 'dos' }, campos) : null);
    }

    function campoAccion(a, c) {
      let ctl;
      if (c.tipo === 'sel') {
        ctl = h('select', {}, c.opciones.map(([v, n]) => h('option', { value: v, selected: v === a[c.k] }, n)));
        ctl.onchange = () => { a[c.k] = ctl.value; };
      } else {
        ctl = h('input', { type: c.tipo === 'num' ? 'number' : 'text', value: a[c.k] ?? c.def ?? '', inputMode: c.tipo === 'num' ? 'numeric' : undefined, min: c.min, max: c.max, list: c.tipo === 'ruta' ? 'lista-biblioteca' : undefined, placeholder: c.tipo === 'ruta' ? 'Escribí o cargá la lista' : undefined });
        ctl.oninput = () => { a[c.k] = c.tipo === 'num' ? Number(ctl.value) : ctl.value; };
      }
      const cont = h('div', { class: 'campo', style: c.tipo === 'ruta' ? 'grid-column:1/-1' : '' }, h('label', {}, c.et), ctl);
      if (c.tipo === 'ruta') cont.append(h('button', { type: 'button', class: 'b chico', style: 'margin-top:6px', onclick: () => enviar({ t: 'biblioteca' }) }, '📂 Cargar lista desde ProPresenter'));
      return cont;
    }

    function nuevaAccion(tipo) {
      const a = { tipo };
      (DEF[tipo] ? DEF[tipo].campos : []).forEach((c) => { a[c.k] = c.def ?? ''; });
      return a;
    }

    const selNueva = h('select', {}, GRUPOS.map(([g, lista]) => h('optgroup', { label: g }, lista.map(([id, n]) => h('option', { value: id }, n)))));
    dibujarAcciones();

    const guardar = () => {
      if (!b.texto.trim() && !b.icono.trim()) return toast('Falta el texto', 'Poné un nombre o un ícono al botón.', 'error');
      op({ op: 'boton.guardar', pagina, boton: b }); cerrar();
    };

    cerrar = modal([
      h('h2', {}, existente ? 'Editar botón' : 'Nuevo botón'),
      h('div', { class: 'dos' },
        h('div', { class: 'campo' }, h('label', {}, 'Texto'), iTexto),
        h('div', { class: 'campo' }, h('label', {}, 'Ícono (emoji)'), iIcono)),
      emojis,
      h('div', { class: 'campo', style: 'margin-top:12px' }, h('label', {}, 'Color'), sw),
      h('div', { class: 'campo check' }, h('label', {}, iConf, 'Pedir confirmación («¿seguro?») antes de ejecutar')),
      h('h3', {}, 'Acciones (se ejecutan en orden)'),
      listaAcc,
      h('div', { class: 'agregar' }, selNueva, h('button', { type: 'button', class: 'b primario', onclick: () => { b.acciones.push(nuevaAccion(selNueva.value)); dibujarAcciones(); } }, '＋ Agregar')),
      h('div', { class: 'pie' },
        h('div', { class: 'izq' },
          existente ? h('button', { class: 'b peligro', onclick: () => confirmar('Borrar botón', `¿Borrar "${existente.texto}"?`, 'Borrar').then((si) => { if (si) { op({ op: 'boton.borrar', pagina, id: existente.id }); cerrar(); } }) }, '🗑') : null,
          h('button', { class: 'b', onclick: () => { if (!enviar({ t: 'probar', acciones: b.acciones })) toast('Sin conexión', '', 'error'); } }, '▶ Probar')),
        h('button', { class: 'b', onclick: () => cerrar() }, 'Cancelar'),
        h('button', { class: 'b primario', onclick: guardar }, 'Guardar')),
    ]);
  }

  function mostrarPrueba(m) {
    const malos = m.pasos.filter((p) => !p.ok);
    if (m.ok) toast('Prueba correcta', `${m.pasos.length} acciones ejecutadas`, 'ok');
    else toast('La prueba tuvo errores', malos.map((p) => `Paso ${p.paso}: ${p.error}`).join('\n'), 'error', 8000);
  }

  // ---------- Ajustes ----------
  function abrirAjustes() {
    if (!S.ajustes) return toast('Cargando…', 'Probá de nuevo en un instante.');
    const A = structuredClone(S.ajustes);
    let cerrar;
    const campo = (et, obj, k, tipo = 'text', ayuda, extra = {}) => {
      const i = h('input', { type: tipo, value: obj[k], inputMode: tipo === 'number' ? 'numeric' : undefined, ...extra });
      i.oninput = () => {
        if (tipo !== 'number') obj[k] = i.value;
        else if (i.value.trim() !== '' && Number.isFinite(Number(i.value))) obj[k] = Number(i.value); // vacío: se deja el valor anterior
      };
      return h('div', { class: 'campo' }, h('label', {}, et), i, ayuda ? h('div', { class: 'ayuda' }, ayuda) : null);
    };
    const check = (et, obj, k) => { const i = h('input', { type: 'checkbox', checked: !!obj[k] }); i.onchange = () => { obj[k] = i.checked; }; return h('div', { class: 'campo check' }, h('label', {}, i, et)); };

    const nuevoPin = h('input', { type: 'password', placeholder: 'Nuevo PIN (4 a 12 números)', autocomplete: 'new-password', inputMode: 'numeric', maxLength: 12 });
    const archivo = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    archivo.onchange = async () => {
      const f = archivo.files[0]; if (!f) return;
      try {
        const datos = JSON.parse(await f.text());
        if (!(await confirmar('Importar configuración', 'Esto REEMPLAZA todos los botones, páginas y ajustes actuales. ¿Continuar?', 'Importar'))) return;
        op({ op: 'importar', datos }); cerrar(); toast('Importado', 'La configuración se reemplazó.', 'ok');
      } catch { toast('Archivo inválido', 'No es un JSON de configuración válido.', 'error'); }
    };

    cerrar = modal([
      h('h2', {}, '⚙️ Ajustes'),
      check('Modo simulación (probar sin ProPresenter ni Resolume)', A, 'simulacion'),
      h('h3', {}, 'ProPresenter 6'),
      h('div', { class: 'dos' },
        campo('IP de la compu con ProPresenter', A.propresenter, 'ip', 'text', '127.0.0.1 si es esta misma compu', { placeholder: '192.168.1.20', autocapitalize: 'off' }),
        campo('Puerto de red', A.propresenter, 'puerto', 'number', 'Preferencias > Red > Puerto')),
      campo('Contraseña de Remote («Controller»)', A.propresenter, 'passRemoto', 'password', 'La de «Controller», no la de «Observer»: con esa ProPresenter ignora las órdenes.'),
      check('Usar Stage Display (para ver la diapositiva actual y el reloj)', A.propresenter, 'usarStage'),
      h('div', { class: 'dos' }, campo('Contraseña de Stage Display', A.propresenter, 'passStage', 'password'), campo('Puerto del Stage (0 = el mismo)', A.propresenter, 'puertoStage', 'number')),
      h('h3', {}, 'Resolume Arena 6 (OSC)'),
      h('div', { class: 'dos' },
        campo('IP de la compu con Resolume', A.resolume, 'ip', 'text', '127.0.0.1 si es esta misma compu', { placeholder: '192.168.1.20', autocapitalize: 'off' }),
        campo('Puerto de entrada de Resolume', A.resolume, 'puerto', 'number', 'Preferencias > OSC (por defecto 7000)')),
      campo('Puerto para recibir respuestas (0 = no)', A.resolume, 'puertoEntrada', 'number', 'Opcional: si Resolume envía OSC a este puerto, el estado pasa a «Conectado».'),
      h('h3', {}, 'Direcciones OSC de Resolume'),
      h('p', { style: 'color:var(--txt2);font-size:13px;margin-top:0' }, 'Usá {n} para el número, o {capa} y {clip}. Verificalas con el modo de edición de atajos OSC de Resolume.'),
      ...[['columna', 'Disparar columna'], ['clip', 'Disparar clip'], ['limpiarCapa', 'Limpiar capa'], ['opacidadCapa', 'Opacidad de capa'], ['opacidadMaster', 'Opacidad master'], ['desconectarTodo', 'Desconectar todo']].map(([k, et]) => campo(et, A.osc, k)),
      h('h3', {}, 'Control manual'),
      h('div', { class: 'dos' }, campo('Cantidad de columnas', A.manual, 'columnas', 'number'), campo('Cantidad de capas', A.manual, 'capas', 'number')),
      h('h3', {}, 'Seguridad'),
      S.pinDefecto ? h('p', { style: 'color:var(--warn)' }, '⚠ Todavía usás el PIN de fábrica (1234). Cambialo.') : null,
      h('div', { class: 'campo' }, h('label', {}, 'Cambiar PIN'), nuevoPin),
      h('h3', {}, 'Copia de seguridad'),
      h('div', { class: 'fila-msg' },
        h('button', { class: 'b', onclick: () => enviar({ t: 'exportar' }) }, '⬇ Exportar configuración'),
        h('button', { class: 'b', onclick: () => archivo.click() }, '⬆ Importar configuración'), archivo),
      h('div', { class: 'pie' },
        h('button', { class: 'b', onclick: () => cerrar() }, 'Cancelar'),
        h('button', { class: 'b primario', onclick: () => {
          const pin = nuevoPin.value.trim();
          if (pin && !/^[0-9]{4,12}$/.test(pin)) { nuevoPin.focus(); return toast('PIN inválido', 'Tiene que tener entre 4 y 12 números.', 'error'); }
          if (!op({ op: 'ajustes.guardar', ajustes: A })) return;
          if (pin && op({ op: 'pin.cambiar', nuevo: pin })) S.pinMem = pin; // para volver a entrar solo si se corta la conexión
          cerrar(); toast('Ajustes guardados', pin ? 'También se cambió el PIN.' : '', 'ok');
        } }, 'Guardar')),
    ]);
  }

  function descargarJSON(datos) {
    const fecha = new Date().toISOString().slice(0, 10);
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' })), download: `panel-cabina-${fecha}.json` });
    document.body.append(a); a.click(); a.remove();
  }

  // ---------- Pantalla siempre encendida (compatible con http, sin Wake Lock) ----------
  let noSleep = null, pantallaActiva = leerLocal('pantalla', '1') === '1';
  try { noSleep = new window.NoSleep(); } catch {}
  function aplicarPantalla(conGesto) {
    $('#b-pantalla').textContent = pantallaActiva ? '🔆' : '🌙';
    $('#b-pantalla').title = pantallaActiva ? 'La pantalla no se apaga (tocá para permitir que se apague)' : 'La pantalla puede apagarse (tocá para mantenerla encendida)';
    if (!noSleep || !conGesto) return;
    try {
      const r = pantallaActiva ? noSleep.enable() : noSleep.disable();
      if (r && r.catch) r.catch(() => {}); // si el navegador lo rechaza, el panel sigue igual
    } catch {}
  }
  // El video silencioso solo puede arrancar después de un toque del usuario.
  const primerToque = () => { document.removeEventListener('pointerdown', primerToque); if (pantallaActiva) aplicarPantalla(true); };
  document.addEventListener('pointerdown', primerToque);
  $('#b-pantalla').onclick = () => { pantallaActiva = !pantallaActiva; guardarLocal('pantalla', pantallaActiva ? '1' : '0'); aplicarPantalla(true); toast(pantallaActiva ? 'La pantalla no se apagará' : 'La pantalla puede apagarse'); };

  // ---------- Botones de la barra ----------
  $('#b-editar').onclick = () => { if (S.editor) enviar({ t: 'salirEditor' }); else pedirPin(); };
  $('#b-ajustes').onclick = abrirAjustes;

  // ---------- Arranque ----------
  aplicarTamano();
  aplicarPantalla();
  pintarEstados();
  dibujarContenido();
  ponerRed('reconectando');
  conectarWS();
})();

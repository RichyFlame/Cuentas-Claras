/* Cuentas Claras — web app v2 (sin frameworks). Reglas de negocio en core.js */
(function () {
  'use strict';
  var C = window.Core;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var Q = C.fmtQ;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- Almacenamiento del dispositivo ---------- */
  var LS = {
    get: function (k, def) { try { var v = localStorage.getItem('cc.' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem('cc.' + k, JSON.stringify(v)); } catch (e) { /* sin espacio o bloqueado */ } }
  };

  /* ---------- Estado ---------- */
  function repartoInicial() { return { modo: 'mio', persona: null, sel: ['yo'], dividir: 'iguales', montos: {} }; }
  var S = {
    cfg: LS.get('cfg', null), data: null, mes: null, mesElegido: false, tab: 'anotar',
    medio: null, fecha: null, reparto: repartoInicial(), outbox: LS.get('outbox', []), sync: 'ok', cargando: false
  };
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nuevoId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function ctx() { return { hoy: hoy(), ahora: new Date().toISOString(), id: nuevoId }; }
  function asegurarDatos(d) { if (d) C.NOMBRES_TABLAS.forEach(function (t) { if (!d[t]) d[t] = []; }); return d; }
  function mesActual() {
    if (!S.mesElegido && S.data) S.mes = C.mesContable(S.data, C.ultimoMedio(S.data), hoy());
    return S.mes || C.mesDe(hoy());
  }
  function activos(lista) { return (lista || []).filter(C.activo); }

  /* ---------- Conexión con Apps Script ---------- */
  function api(body) {
    var payload = JSON.stringify(Object.assign({ clave: S.cfg.clave }, body));
    return fetch(S.cfg.url, { method: 'POST', body: payload, redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function esLocal() { return S.cfg && S.cfg.modo === 'local'; }
  function guardarCache() { LS.set(esLocal() ? 'local' : 'cache', S.data); }

  // Valida y aplica al instante en el teléfono; luego lo manda al servidor (o queda en cola).
  function ejecutar(accion) {
    var res = C.aplicar(S.data, accion, ctx());
    if (!res.ok) return res;
    var add = res.ops[0] && res.ops[0].op === 'add' ? res.ops[0].row : null;
    if (add) { // el servidor guarda exactamente lo calculado aquí
      var k = C.TABLAS[res.ops[0].tabla].clave;
      if (k === 'id') accion.id = add.id;
      if (add.fecha) accion.fecha = add.fecha;
      if (accion.tipo === 'agregarGasto') { accion.medio = add.medio; accion.categoria = add.categoria; accion.tipoGasto = add.tipo; accion.partes = add.partes; }
    }
    C.aplicarOps(S.data, res.ops);
    guardarCache();
    if (!esLocal() && res.ops.length) { S.outbox.push(JSON.parse(JSON.stringify(accion))); LS.set('outbox', S.outbox); vaciarCola(); }
    return res;
  }
  var enviando = false;
  function vaciarCola() {
    if (enviando || esLocal()) return Promise.resolve();
    if (!S.outbox.length) { ponerEstado('ok'); return Promise.resolve(); }
    enviando = true; ponerEstado('pendiente');
    var recargar = false;
    function siguiente() {
      if (!S.outbox.length) { enviando = false; ponerEstado('ok'); return recargar ? cargar(true) : null; }
      return api({ accion: 'aplicar', datos: S.outbox[0] }).then(function (r) {
        S.outbox.shift(); LS.set('outbox', S.outbox);
        if (!r.ok) { recargar = true; aviso('No se guardó en la hoja: ' + r.error); }
        return siguiente();
      }, function () { enviando = false; ponerEstado('pendiente'); });
    }
    return siguiente();
  }
  function cargar(silencioso) {
    if (esLocal()) { S.data = asegurarDatos(LS.get('local', null)) || datosLocalesNuevos(); render(); return Promise.resolve(); }
    if (S.cargando) return Promise.resolve();
    S.cargando = true; if (!silencioso) ponerEstado('cargando');
    return vaciarCola().then(function () { return api({ accion: 'cargar' }); }).then(function (r) {
      S.cargando = false;
      if (!r.ok) { ponerEstado('error'); if (/clave/i.test(r.error)) mostrarBienvenida(r.error); else aviso(r.error); return; }
      S.data = asegurarDatos(r.data);
      S.outbox.forEach(function (a) { var x = C.aplicar(S.data, a, ctx()); if (x.ok) C.aplicarOps(S.data, x.ops); });
      guardarCache(); ponerEstado(S.outbox.length ? 'pendiente' : 'ok'); render();
    }).catch(function () {
      S.cargando = false; ponerEstado(S.outbox.length ? 'pendiente' : 'error');
      if (!S.data) { S.data = asegurarDatos(LS.get('cache', null)); if (S.data) render(); }
    });
  }
  function datosLocalesNuevos() { var d = C.datosBase(); C.sembrarEjemplos(d, ctx()); LS.set('local', d); return d; }
  function ponerEstado(e) {
    S.sync = e;
    var el = $('#estado');
    var txt = { ok: 'Guardado', pendiente: S.outbox.length + ' sin enviar', error: 'Sin conexión', cargando: 'Actualizando…', local: 'Modo de prueba' };
    if (esLocal()) e = 'local';
    el.dataset.estado = e === 'cargando' ? 'pendiente' : e;
    el.textContent = txt[e] || '';
  }

  /* ---------- Avisos y hoja inferior ---------- */
  var tAviso;
  function aviso(msg) {
    var el = $('#aviso'); el.textContent = msg; el.hidden = false;
    clearTimeout(tAviso); tAviso = setTimeout(function () { el.hidden = true; }, 3400);
  }
  var alCerrar = null;
  function abrirHoja(titulo, html, montar, cerrar) {
    var prev = alCerrar; alCerrar = null; if (prev && !$('#hoja').hidden) prev();
    $('#hoja-titulo').textContent = titulo;
    var cuerpo = $('#hoja-cuerpo'); cuerpo.onclick = cuerpo.onchange = cuerpo.oninput = null;
    cuerpo.innerHTML = html; cuerpo.scrollTop = 0;
    $('#hoja').hidden = false; $('#velo').hidden = false;
    alCerrar = cerrar || null;
    if (montar) montar(cuerpo);
  }
  function cerrarHoja() {
    $('#hoja').hidden = true; $('#velo').hidden = true;
    var f = alCerrar; alCerrar = null; if (f) f();
  }
  $('#hoja-cerrar').addEventListener('click', cerrarHoja);
  $('#velo').addEventListener('click', cerrarHoja);
  function dobleToque(btn, texto, fn) {
    var armado = false, t;
    btn.addEventListener('click', function () {
      if (armado) { clearTimeout(t); fn(); return; }
      armado = true; var orig = btn.textContent; btn.textContent = texto; btn.classList.add('confirmar');
      t = setTimeout(function () { armado = false; btn.textContent = orig; btn.classList.remove('confirmar'); }, 4000);
    });
  }
  function errorEn(root, sel, msg) { var e = $(sel, root); e.textContent = msg; e.hidden = false; }

  /* ---------- Ayudas de presentación ---------- */
  function medioDe(id) { var m = C.medio(S.data, id); return m ? m.obj : { nombre: id || '—', color: '#8F9C95', banco: '' }; }
  function muestra(color, grande) { return '<span class="muestra' + (grande ? ' grande' : '') + '" style="--c:' + esc(color) + '"></span>'; }
  function fechaTxt(f) { return f === hoy() ? 'Hoy' : C.fechaCorta(f); }
  function personaTxt(id) { return C.nombrePersona(S.data, id); }
  function describirPartes(partes) {
    if (partes.length === 1 && partes[0].p === 'yo') return '';
    if (partes.length === 1) return 'De ' + personaTxt(partes[0].p);
    return 'Dividido entre ' + partes.length;
  }
  function opciones(lista, sel, etiqueta) {
    return lista.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(etiqueta(x)) + '</option>'; }).join('');
  }
  function opcionesMedio(sel) {
    var t = activos(S.data.tarjetas), c = activos(S.data.cuentas);
    return (t.length ? '<optgroup label="Tarjetas">' + opciones(t, sel, function (x) { return x.nombre; }) + '</optgroup>' : '') +
      (c.length ? '<optgroup label="Cuentas">' + opciones(c, sel, function (x) { return x.nombre; }) + '</optgroup>' : '');
  }
  function textoCiclo(ciclo) {
    return ciclo.pago ? 'Del ' + C.diaMes(ciclo.desde) + ' al ' + C.diaMes(ciclo.hasta) + ' · pagas el ' + C.diaMes(ciclo.pago) : 'Mes calendario (sin día de corte)';
  }

  /* ---------- Reparto (gastos y cuotas) ---------- */
  function partesDe(r, total) {
    if (r.modo === 'mio') return { partes: [{ p: 'yo', m: total }] };
    if (r.modo === 'otra') return r.persona ? { partes: [{ p: r.persona, m: total }] } : { error: 'Elige de quién es (toca "Para").' };
    var sel = ['yo'].concat(r.sel.filter(function (p) { return p !== 'yo'; })).filter(function (p) { return r.sel.indexOf(p) >= 0; });
    if (sel.length < 2) return { error: 'Para dividir elige al menos dos personas.' };
    if (r.dividir === 'iguales') return { partes: C.dividirIguales(total, sel) };
    var partes = sel.map(function (p) { return { p: p, m: C.parseMonto(r.montos[p] || '0') }; });
    if (partes.some(function (x) { return x.m === null || x.m < 0; })) return { error: 'Revisa los montos del reparto.' };
    return { partes: partes };
  }
  function textoPara(r) {
    if (r.modo === 'otra') return r.persona ? 'De ' + personaTxt(r.persona) : 'Elige persona';
    if (r.modo === 'dividir') return 'Dividido · ' + r.sel.length;
    return 'Solo mío';
  }
  // op: { estado, total(): centavos, personas(): lista, titulo, nota, alCerrar }
  function abrirReparto(op) {
    var r = op.estado;
    function html() {
      var per = op.personas(), total = op.total() || 0;
      var h = '<div class="segmentos">' + [['mio', 'Solo mío'], ['otra', 'Otra persona'], ['dividir', 'Dividido']].map(function (o) {
        return '<button type="button" data-modo="' + o[0] + '" aria-pressed="' + (r.modo === o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div>';
      if (op.nota) h += '<p class="nota">' + esc(op.nota) + '</p>';
      if (r.modo === 'mio') h += '<p class="nota">Todo cuenta como tuyo.</p>';
      if (r.modo === 'otra') {
        h += '<p class="nota">Tú lo pagas con tu tarjeta y esa persona te lo debe. No cuenta como gasto tuyo.</p>';
        h += per.length ? per.map(function (p) {
          return '<label class="check"><input type="radio" name="rp-p" value="' + esc(p.id) + '"' + (r.persona === p.id ? ' checked' : '') + '><span class="grow">' + esc(p.nombre) + '</span></label>';
        }).join('') : '<p class="vacio">No hay personas disponibles. Agrégalas en la pestaña Personas.</p>';
      }
      if (r.modo === 'dividir') {
        h += '<div class="segmentos"><button type="button" data-div="iguales" aria-pressed="' + (r.dividir === 'iguales') + '">Partes iguales</button>' +
          '<button type="button" data-div="montos" aria-pressed="' + (r.dividir === 'montos') + '">Montos a mano</button></div>';
        var sel = ['yo'].concat(r.sel.filter(function (p) { return p !== 'yo'; })).filter(function (p) { return r.sel.indexOf(p) >= 0; });
        var ig = total && sel.length ? C.dividirIguales(total, sel) : [];
        h += [{ id: 'yo', nombre: 'Yo' }].concat(per).map(function (p) {
          var on = r.sel.indexOf(p.id) >= 0, x = ig.filter(function (y) { return y.p === p.id; })[0];
          return '<label class="check"><input type="checkbox" value="' + esc(p.id) + '"' + (on ? ' checked' : '') + '><span class="grow">' + esc(p.nombre) + '</span>' +
            (r.dividir === 'montos' ? (on ? '<input class="campo-monto" inputmode="decimal" data-monto="' + esc(p.id) + '" value="' + esc(r.montos[p.id] || '') + '" placeholder="0.00" aria-label="Monto de ' + esc(p.nombre) + '">' : '')
              : '<span class="num sub">' + (on && x ? Q(x.m) : '') + '</span>') + '</label>';
        }).join('') + '<p class="resto" id="rp-resto"></p>';
      }
      return h + '<button type="button" class="btn btn-principal" id="rp-listo">Listo</button>';
    }
    function resto() {
      var el = $('#rp-resto'); if (!el) return;
      var total = op.total() || 0;
      if (r.dividir !== 'montos') { el.className = 'resto'; el.textContent = total ? 'Si sobran centavos, se asignan a la primera persona.' : 'Escribe primero el monto para ver cuánto le toca a cada quien.'; return; }
      var suma = r.sel.reduce(function (a, p) { return a + (C.parseMonto(r.montos[p] || '0') || 0); }, 0), falta = total - suma;
      el.textContent = falta === 0 ? 'Cuadra con ' + Q(total) : (falta > 0 ? 'Falta asignar ' + Q(falta) : 'Te pasaste por ' + Q(-falta));
      el.className = 'resto' + (falta === 0 ? '' : ' mal');
    }
    function montar(root) {
      root.innerHTML = html(); resto();
      root.onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.modo) { r.modo = b.dataset.modo; montar(root); }
        else if (b.dataset.div) { r.dividir = b.dataset.div; montar(root); }
        else if (b.id === 'rp-listo') cerrarHoja();
      };
      root.onchange = function (e) {
        var t = e.target;
        if (t.name === 'rp-p') r.persona = t.value;
        else if (t.type === 'checkbox') {
          var i = r.sel.indexOf(t.value);
          if (t.checked && i < 0) r.sel.push(t.value); else if (!t.checked && i >= 0) r.sel.splice(i, 1);
          montar(root);
        }
      };
      root.oninput = function (e) { if (e.target.dataset.monto) { r.montos[e.target.dataset.monto] = e.target.value; resto(); } };
    }
    abrirHoja(op.titulo || '¿Para quién es?', '', montar, op.alCerrar);
  }

  /* =====================================================================
     ANOTAR: solo el registro y los últimos 10 gastos
     ===================================================================== */
  function renderAnotar() {
    var d = S.data, disp = activos(d.tarjetas).concat(activos(d.cuentas));
    if (!S.medio || !disp.some(function (m) { return m.id === S.medio; })) S.medio = C.ultimoMedio(d);
    $('#g-medio').innerHTML = disp.length ? opcionesMedio(S.medio) : '<option value="">Agrega una tarjeta en Bancos</option>';
    $('#g-medio-color').style.setProperty('--c', medioDe(S.medio).color);
    $('#g-fecha').value = S.fecha || hoy();
    $('#g-fecha-txt').textContent = fechaTxt(S.fecha || hoy());
    $('#g-para-txt').textContent = textoPara(S.reparto);
    pista();
    var ult = d.gastos.slice().sort(function (a, b) { return (b.creado || b.fecha).localeCompare(a.creado || a.fecha); }).slice(0, 10);
    $('#g-ultimos').innerHTML = ult.length ? ult.map(itemGasto).join('') : '<li class="vacio">Todavía no hay gastos. Escribe el monto y en qué fue.</li>';
  }
  function itemGasto(g) {
    var m = medioDe(g.medio), extra = describirPartes(g.partes), mio = C.miParte(g);
    return '<li><button type="button" class="item" data-gasto="' + esc(g.id) + '">' + muestra(m.color) +
      '<span class="item-txt"><span class="item-nombre">' + esc(g.nombre) + '</span>' +
      '<span class="item-meta">' + esc(g.categoria) + ' · ' + esc(fechaTxt(g.fecha)) + (extra ? ' · ' + esc(extra) : '') + '</span></span>' +
      '<span class="item-monto num">' + Q(g.monto) + (mio !== g.monto ? '<small>tuyo ' + Q(mio) + '</small>' : '') + '</span></button></li>';
  }
  function pista() {
    if (!S.data) return;
    var n = $('#g-nombre').value.trim(), el = $('#g-pista');
    if (!n) { el.innerHTML = '&nbsp;'; return; }
    var c = C.clasificar(n, S.data.reglas);
    el.innerHTML = 'Irá a <b>' + esc(c.categoria) + '</b> · ' + esc(c.tipo);
  }
  function mesDelGasto() { return C.mesContable(S.data, S.medio, S.fecha || hoy()); }
  function registrar(ev) {
    ev.preventDefault();
    var err = $('#g-error'); err.hidden = true;
    var montoTxt = $('#g-monto').value, total = C.parseMonto(montoTxt);
    var accion = { tipo: 'agregarGasto', nombre: $('#g-nombre').value, monto: montoTxt, medio: S.medio, fecha: S.fecha || hoy() };
    if (total !== null && total > 0) {
      var pr = partesDe(S.reparto, total);
      if (pr.error) { err.textContent = pr.error; err.hidden = false; return; }
      accion.partes = pr.partes;
    }
    var mes = mesDelGasto(), antes = C.presupuestoMes(S.data, mes);
    var res = ejecutar(accion);
    if (!res.ok) { err.textContent = res.error; err.hidden = false; return; }
    $('#g-monto').value = ''; $('#g-nombre').value = '';
    S.reparto = repartoInicial(); S.fecha = null;
    $('#g-monto').blur(); $('#g-nombre').blur();
    mostrarResultado(res.info.gasto, antes);
    renderAnotar();
  }
  function alertaPresupuesto(cat, mes, antes) {
    var ahora = C.presupuestoMes(S.data, mes).filter(function (x) { return x.categoria === cat; })[0];
    var prev = (antes || []).filter(function (x) { return x.categoria === cat; })[0];
    if (!ahora || ahora.estado === 'sin' || ahora.estado === 'bien') return '';
    if (prev && prev.estado === ahora.estado && ahora.estado === 'cerca') return '';
    if (ahora.estado === 'pasado') return '<div class="alerta pasado">Te pasaste del presupuesto de ' + esc(cat) + ' por ' + Q(ahora.gastado - ahora.limite) + '.</div>';
    return '<div class="alerta">Llevas ' + ahora.pct + '% del presupuesto de ' + esc(cat) + '. Quedan ' + Q(ahora.limite - ahora.gastado) + '.</div>';
  }
  function mostrarResultado(g, antes) {
    var m = medioDe(g.medio), mio = C.miParte(g), extra = describirPartes(g.partes);
    $('#g-resultado').innerHTML = '<div class="resultado">' +
      '<div class="resultado-cab"><span class="resultado-monto num">' + Q(g.monto) + '</span><span class="sub">' + esc(g.nombre) + '</span></div>' +
      '<div class="etiquetas"><span class="etiqueta">' + esc(g.categoria) + '</span>' +
      '<span class="etiqueta ' + (g.tipo === 'Necesario' ? 'necesario' : 'prescindible') + '">' + esc(g.tipo) + '</span>' +
      '<span class="etiqueta">' + muestra(m.color) + esc(m.nombre) + '</span>' +
      (extra ? '<span class="etiqueta">' + esc(extra) + (mio ? ' · tuyo ' + Q(mio) : '') + '</span>' : '') + '</div>' +
      alertaPresupuesto(g.categoria, C.mesContable(S.data, g.medio, g.fecha), antes) +
      '<div class="fila-btns"><button type="button" class="btn btn-chico" data-gasto="' + esc(g.id) + '">Cambiar clasificación</button></div></div>';
  }

  /* ----- Hoja: reclasificar / borrar un gasto ----- */
  function abrirGasto(id) {
    var g = C.buscar(S.data.gastos, id); if (!g) return;
    var m = medioDe(g.medio), cat = g.categoria, tipo = g.tipo;
    var partes = g.partes.map(function (x) { return '<li class="item"><span></span><span class="item-txt"><span class="item-nombre">' + esc(personaTxt(x.p)) + '</span></span><span class="item-monto num">' + Q(x.m) + '</span></li>'; }).join('');
    var html = '<div class="cifra"><span class="eyebrow">' + esc(fechaTxt(g.fecha)) + ' · cuenta en ' + esc(C.nombreMes(C.mesContable(S.data, g.medio, g.fecha))) + '</span>' +
      '<span class="cifra-valor num">' + Q(g.monto) + '</span><span class="etiquetas"><span class="etiqueta">' + muestra(m.color) + esc(m.nombre) + '</span></span></div>' +
      (describirPartes(g.partes) ? '<div><span class="eyebrow">Reparto</span><ul class="lista">' + partes + '</ul></div>' : '') +
      '<div><span class="eyebrow">Categoría</span><div class="cats" id="eg-cats">' +
      C.CATEGORIAS.map(function (c) { return '<button type="button" class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (c === cat) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>' +
      '<div><span class="eyebrow">Tipo</span><div class="segmentos" id="eg-tipo">' +
      C.TIPOS.map(function (t) { return '<button type="button" data-tipo="' + t + '" aria-pressed="' + (t === tipo) + '">' + t + '</button>'; }).join('') + '</div></div>' +
      '<p class="nota">Al guardar, la próxima vez que escribas “' + esc(C.palabraParaRegla(g.nombre)) + '” se clasificará igual.</p>' +
      '<button type="button" class="btn btn-principal" id="eg-guardar">Guardar clasificación</button>' +
      '<button type="button" class="btn btn-peligro" id="eg-borrar">Borrar gasto</button>';
    abrirHoja(g.nombre, html, function (root) {
      function marcar() {
        $$('#eg-cats .chip', root).forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.cat === cat); });
        $$('#eg-tipo button', root).forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.tipo === tipo); });
      }
      root.onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.cat) { cat = b.dataset.cat; tipo = C.TIPO_POR_CATEGORIA[cat]; marcar(); }
        if (b.dataset.tipo) { tipo = b.dataset.tipo; marcar(); }
        if (b.id === 'eg-guardar') {
          var r = ejecutar({ tipo: 'reclasificar', id: g.id, categoria: cat, tipoGasto: tipo });
          if (!r.ok) return aviso(r.error);
          cerrarHoja(); aviso('Guardado. Aprendí la regla para “' + (r.info.palabra || g.nombre) + '”.');
          if ($('#g-resultado [data-gasto="' + g.id + '"]')) mostrarResultado(C.buscar(S.data.gastos, g.id));
          render();
        }
      };
      dobleToque($('#eg-borrar', root), 'Toca otra vez para borrar', function () {
        ejecutar({ tipo: 'borrarGasto', id: g.id }); cerrarHoja(); aviso('Gasto borrado');
        if ($('#g-resultado [data-gasto="' + g.id + '"]')) $('#g-resultado').innerHTML = '';
        render();
      });
    });
  }

  /* =====================================================================
     MES: presupuesto por categoría → por persona (según cortes) → por tarjeta
     ===================================================================== */
  function renderMes() {
    var ym = mesActual(), r = C.recuento(S.data, ym), d = S.data;
    $$('[data-mes-txt]').forEach(function (el) { el.textContent = C.nombreMes(ym); });
    var lista = C.presupuestoMes(d, ym);
    var conLim = lista.filter(function (x) { return x.limite > 0; });
    var sinLim = lista.filter(function (x) { return !x.limite && x.gastado; }).sort(function (a, b) { return b.gastado - a.gastado; });
    var lim = conLim.reduce(function (a, x) { return a + x.limite; }, 0);
    var h = '<div class="bloque-mes"><div class="cifra"><span class="eyebrow">Tu gasto del mes</span><span class="cifra-valor num">' + Q(r.mio) + '</span>' +
      '<span class="sub">' + (lim ? 'de ' + Q(lim) + ' presupuestado · ' + (r.mio <= lim ? 'quedan ' + Q(lim - r.mio) : 'te pasaste por ' + Q(r.mio - lim)) : 'Toca una categoría para ponerle límite.') + '</span></div>';
    function fila(x) {
      var pct = x.limite ? Math.min(100, Math.floor(x.gastado * 100 / x.limite)) : 0;
      var est = { bien: 'Quedan ' + Q(x.limite - x.gastado), cerca: 'Cerca del límite · quedan ' + Q(x.limite - x.gastado), pasado: 'Te pasaste por ' + Q(x.gastado - x.limite), sin: 'Sin límite' }[x.estado];
      return '<button type="button" class="pres" data-estado="' + x.estado + '" data-cat="' + esc(x.categoria) + '">' +
        '<span class="pres-cab"><span class="pres-cat">' + esc(x.categoria) + '</span><span class="pres-num num"><b>' + Q(x.gastado) + '</b>' + (x.limite ? ' de ' + Q(x.limite) : '') + '</span></span>' +
        (x.limite ? '<span class="barra"><span style="width:' + pct + '%"></span></span>' : '') + '<span class="pres-estado">' + est + '</span></button>';
    }
    h += '<div>' + conLim.map(fila).join('') + sinLim.map(fila).join('') + '</div>' +
      '<button type="button" class="btn btn-texto" id="mes-limites">Poner límite a otra categoría</button></div>';

    h += '<div><h2 class="titulo-bloque">Por persona</h2><p class="nota">Según el corte de cada tarjeta. Lo pagado con cuentas va por mes calendario.</p>' +
      '<div class="tabla-scroll"><table class="tabla"><thead><tr><th>Persona</th><th>Gastos</th><th>Cuotas</th><th>Total</th></tr></thead><tbody>' +
      r.personas.map(function (p) {
        var sub = p.id === 'yo' ? '' : (p.total ? '<span class="debe">te debe ' + Q(p.total) + '</span>' : '');
        return '<tr><td>' + esc(p.nombre) + sub + '</td><td class="num">' + Q(p.gastos) + '</td><td class="num">' + Q(p.cuotas) + '</td><td class="num"><b>' + Q(p.total) + '</b></td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Total</td><td class="num">' + Q(r.personas.reduce(function (a, p) { return a + p.gastos; }, 0)) + '</td><td class="num">' +
      Q(r.personas.reduce(function (a, p) { return a + p.cuotas; }, 0)) + '</td><td class="num">' + Q(r.total) + '</td></tr></tfoot></table></div></div>';

    h += '<div><h2 class="titulo-bloque">Por tarjeta</h2><ul class="lista">' + (r.tarjetas.length ? r.tarjetas.map(function (t) {
      var m = medioDe(t.id);
      return '<li><button type="button" class="item" data-tarjeta="' + esc(t.id) + '">' + muestra(m.color) + '<span class="item-txt"><span class="item-nombre">' + esc(m.nombre) + '</span>' +
        '<span class="item-meta">' + esc(textoCiclo(t.ciclo)) + '</span></span><span class="item-monto num">' + Q(t.total) +
        (t.deOtros ? '<small>tuyo ' + Q(t.mio) + ' · otros ' + Q(t.deOtros) + '</small>' : '') + '</span></button></li>';
    }).join('') : '<li class="vacio">Agrega tus tarjetas en Bancos.</li>') + '</ul>' +
      '<p class="cuadre' + (r.cuadra ? '' : ' mal') + '">' + (r.cuadra ? '✓ Categorías, personas y tarjetas suman el total del mes (' + Q(r.total) + ').' : '⚠ Las sumas no cuadran. Revisa los repartos.') + '</p></div>';
    var n = r.gastos.length + r.cuotas.length;
    if (n) h += '<button type="button" class="btn" id="mes-movs">Ver los ' + n + ' movimientos del mes</button>';
    $('#mes-cuerpo').innerHTML = h;
    var b = $('#mes-movs'); if (b) b.addEventListener('click', function () { abrirMovimientos(r); });
    $('#mes-limites').addEventListener('click', abrirCategoriasSinLimite);
  }
  function abrirMovimientos(r) {
    var movs = r.gastos.map(function (g) { return { f: g.fecha, k: g.creado || '', g: g }; })
      .concat(r.cuotas.map(function (c) { return { f: c.fecha, k: '', c: c }; }))
      .sort(function (a, b) { return a.f === b.f ? b.k.localeCompare(a.k) : b.f.localeCompare(a.f); });
    var h = '', dia = null;
    movs.forEach(function (x) {
      if (x.f !== dia) { if (dia) h += '</ul>'; dia = x.f; h += '<div class="dia">' + esc(fechaTxt(dia)) + '</div><ul class="lista">'; }
      if (x.g) h += itemGasto(x.g);
      else {
        var c = x.c, m = medioDe(c.tarjeta), extra = describirPartes(c.partes);
        h += '<li><button type="button" class="item" data-cuota="' + esc(c.cuotaId) + '">' + muestra(m.color) + '<span class="item-txt"><span class="item-nombre">' + esc(c.nombre) +
          '<span class="insignia">' + c.n + '/' + c.de + '</span></span><span class="item-meta">Cuota · ' + esc(c.categoria) + (extra ? ' · ' + esc(extra) : '') + '</span></span>' +
          '<span class="item-monto num">' + Q(c.monto) + '</span></button></li>';
      }
    });
    abrirHoja('Movimientos de ' + C.nombreMes(r.mes), h + (dia ? '</ul>' : ''), function (root) {
      root.onclick = function (e) {
        var b = e.target.closest('[data-gasto],[data-cuota]'); if (!b) return;
        if (b.dataset.gasto) abrirGasto(b.dataset.gasto); else abrirCuota(b.dataset.cuota);
      };
    });
  }
  function abrirCategoriasSinLimite() {
    var sin = C.CATEGORIAS.filter(function (c) { return !C.buscar(S.data.presupuesto, c, 'categoria'); });
    abrirHoja('Poner límite', '<div class="cats">' + sin.map(function (c) { return '<button type="button" class="chip" data-cat="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>', function (root) {
      root.onclick = function (e) { var b = e.target.closest('[data-cat]'); if (b) abrirLimite(b.dataset.cat); };
    });
  }
  function abrirLimite(cat) {
    var x = C.buscar(S.data.presupuesto, cat, 'categoria');
    abrirHoja(cat, '<form class="form" id="f-lim" novalidate><label class="campo"><span>Límite mensual (solo tu parte)</span>' +
      '<input id="lim-monto" inputmode="decimal" placeholder="0.00" value="' + (x ? C.decimal(x.monto) : '') + '"></label>' +
      '<p class="error" id="lim-err" hidden></p><button class="btn btn-principal" type="submit">Guardar límite</button>' +
      (x ? '<button class="btn btn-peligro" type="button" id="lim-quitar">Quitar límite</button>' : '') + '</form>', function (root) {
      $('#f-lim', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var r = ejecutar({ tipo: 'guardarPresupuesto', categoria: cat, monto: $('#lim-monto', root).value || '0' });
        if (!r.ok) return errorEn(root, '#lim-err', r.error);
        cerrarHoja(); render();
      });
      var q = $('#lim-quitar', root);
      if (q) q.addEventListener('click', function () { ejecutar({ tipo: 'guardarPresupuesto', categoria: cat, monto: '0' }); cerrarHoja(); render(); });
    });
  }

  /* =====================================================================
     BANCOS
     ===================================================================== */
  function renderBancos() {
    var d = S.data, h = hoy(), tarjetas = activos(d.tarjetas), cuentas = activos(d.cuentas);
    var recs = C.recordatorios(d, h);
    var html = recs.length ? '<div class="avisos">' + recs.map(function (r) {
      return '<button type="button" class="alerta' + (r.dias <= 1 ? ' pasado' : '') + '" data-pagar="' + esc(r.tarjeta) + '">' + esc(C.textoRecordatorio(r)) + '</button>';
    }).join('') + '</div>' : '';
    var deudas = tarjetas.map(function (t) { return C.estadoTarjeta(d, t.id, h); });
    html += '<div><div class="cab-bloque"><h2 class="titulo-bloque">Tarjetas</h2><span class="sub num">Debes ' + Q(deudas.reduce(function (a, e) { return a + e.deuda; }, 0)) + '</span></div>' +
      (tarjetas.length ? tarjetas.map(function (t, i) {
        var e = deudas[i];
        return '<button type="button" class="banco" data-tarjeta="' + esc(t.id) + '">' + muestra(t.color, true) + '<span class="item-txt"><span class="item-nombre">' + esc(t.nombre) + '</span>' +
          '<span class="item-meta">' + (e.conCorte ? 'Corte ' + t.corte + ' · pago ' + t.pago : 'Falta día de corte') + (e.conCorte && e.contado ? ' · contado ' + Q(e.contado) : '') + '</span></span>' +
          '<span class="banco-valor num">' + Q(e.deuda) + '<small>deuda</small></span></button>';
      }).join('') : '<p class="vacio">Todavía no tienes tarjetas. Agrega la primera.</p>') +
      '<div class="fila-btns"><button type="button" class="btn" id="b-pagar"' + (tarjetas.length ? '' : ' disabled') + '>Pagar tarjeta</button><button type="button" class="btn" id="b-nueva-t">Agregar tarjeta</button></div></div>';
    var saldos = cuentas.map(function (c) { return C.saldoCuenta(d, c.id); });
    html += '<div><div class="cab-bloque"><h2 class="titulo-bloque">Cuentas</h2><span class="sub num">Tienes ' + Q(saldos.reduce(function (a, b) { return a + b; }, 0)) + '</span></div>' +
      (cuentas.length ? cuentas.map(function (c, i) {
        return '<button type="button" class="banco" data-cuenta="' + esc(c.id) + '">' + muestra(c.color, true) + '<span class="item-txt"><span class="item-nombre">' + esc(c.nombre) + '</span><span class="item-meta">' + esc(c.banco) + '</span></span>' +
          '<span class="banco-valor num' + (saldos[i] < 0 ? ' negativo' : '') + '">' + Q(saldos[i]) + '<small>saldo</small></span></button>';
      }).join('') : '<p class="vacio">Todavía no tienes cuentas. Agrega la primera.</p>') +
      '<div class="fila-btns"><button type="button" class="btn" id="b-ingreso"' + (cuentas.length ? '' : ' disabled') + '>Ingreso</button><button type="button" class="btn" id="b-retiro"' + (cuentas.length ? '' : ' disabled') + '>Retiro</button><button type="button" class="btn" id="b-nueva-c">Agregar cuenta</button></div></div>';
    var movs = d.pagos.map(function (p) { return { f: p.fecha, p: p }; })
      .concat(d.ingresos.map(function (i) { return { f: i.fecha, i: i }; }))
      .concat(d.retiros.map(function (r) { return { f: r.fecha, r: r }; }))
      .sort(function (a, b) { return b.f.localeCompare(a.f); }).slice(0, 15);
    html += '<div><h2 class="titulo-bloque">Pagos, ingresos y retiros</h2><ul class="lista">' + (movs.length ? movs.map(function (x) {
      if (x.p) {
        var t = medioDe(x.p.tarjeta), c = medioDe(x.p.cuenta);
        return '<li class="item">' + muestra(t.color) + '<span class="item-txt"><span class="item-nombre">Pago a ' + esc(t.nombre) + '</span><span class="item-meta">Desde ' + esc(c.nombre) + ' · ' + esc(fechaTxt(x.f)) + '</span></span><span class="item-monto num">' + Q(x.p.monto) + '</span></li>';
      }
      var mv = x.i || x.r, cu = medioDe(mv.cuenta);
      return '<li class="item">' + muestra(cu.color) + '<span class="item-txt"><span class="item-nombre">' + esc(mv.descripcion) + '</span><span class="item-meta">' + (x.r ? 'Retiro · ' : '') + esc(cu.nombre) + ' · ' + esc(fechaTxt(x.f)) + '</span></span><span class="item-monto num">' + (x.i ? '+' : '−') + Q(mv.monto) + '</span></li>';
    }).join('') : '<li class="vacio">Sin movimientos todavía.</li>') + '</ul></div>';
    $('#bancos-cuerpo').innerHTML = html;
  }

  function infoContado(e) {
    if (!e.conCorte) return 'Esta tarjeta no tiene día de corte. Agrégalo en Editar para calcular el pago de contado.';
    if (e.contado > 0) return 'Pago de contado del corte del ' + C.diaMes(e.ultimoCorte) + ': ' + Q(e.contado) + '. Vence el ' + C.diaMes(e.pagoUltimo) + '.';
    return 'Ya cubriste el corte del ' + C.diaMes(e.ultimoCorte) + '. El próximo corte es el ' + C.diaMes(e.siguienteCorte) + ' y llevas ' + Q(e.contadoSiguiente) + '.';
  }
  function abrirPago(tid) {
    var d = S.data, h = hoy(), tarjetas = activos(d.tarjetas).concat(d.tarjetas.filter(function (t) { return !C.activo(t) && C.deudaTarjeta(d, t.id, h) > 0; }));
    if (!tid) { var rec = C.recordatorios(d, h)[0]; tid = rec ? rec.tarjeta : ((tarjetas.filter(function (t) { return C.estadoTarjeta(d, t.id, h).contado > 0; })[0] || tarjetas[0] || {}).id); }
    var html = '<form class="form" id="f-pago" novalidate>' +
      '<label class="campo"><span>Tarjeta</span><select id="pg-t">' + opciones(tarjetas, tid, function (t) { return t.nombre; }) + '</select></label>' +
      '<p class="alerta suave" id="pg-info"></p>' +
      '<label class="campo"><span>Desde la cuenta</span><select id="pg-c">' + opciones(activos(d.cuentas), null, function (c) { return c.nombre + ' · ' + Q(C.saldoCuenta(d, c.id)); }) + '</select></label>' +
      '<div class="dos"><label class="campo"><span>Monto</span><input id="pg-m" inputmode="decimal" placeholder="0.00"></label>' +
      '<label class="campo"><span>Fecha</span><input id="pg-f" type="date" value="' + h + '"></label></div>' +
      '<div class="fila-btns"><button type="button" class="btn btn-chico" id="pg-contado"></button><button type="button" class="btn btn-chico" id="pg-todo"></button></div>' +
      '<p class="nota">El pago baja la deuda de la tarjeta y el saldo de la cuenta por el mismo monto. No cuenta como gasto.</p>' +
      '<p class="error" id="pg-err" hidden></p><button class="btn btn-principal" type="submit">Registrar pago</button></form>';
    abrirHoja('Pagar tarjeta', html, function (root) {
      function actualizar() {
        var e = C.estadoTarjeta(d, $('#pg-t', root).value, h);
        var contado = Math.min(e.conCorte ? (e.contado || e.contadoSiguiente) : e.deuda, e.deuda);
        $('#pg-info', root).textContent = infoContado(e);
        $('#pg-m', root).value = contado > 0 ? C.decimal(contado) : '';
        $('#pg-contado', root).textContent = 'Contado ' + Q(contado);
        $('#pg-todo', root).textContent = 'Todo lo que debes ' + Q(e.deuda);
        $('#pg-contado', root).onclick = function () { $('#pg-m', root).value = C.decimal(contado); };
        $('#pg-todo', root).onclick = function () { $('#pg-m', root).value = C.decimal(e.deuda); };
      }
      actualizar(); $('#pg-t', root).addEventListener('change', actualizar);
      $('#f-pago', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var r = ejecutar({ tipo: 'pagarTarjeta', tarjeta: $('#pg-t', root).value, cuenta: $('#pg-c', root).value, monto: $('#pg-m', root).value, fecha: $('#pg-f', root).value });
        if (!r.ok) return errorEn(root, '#pg-err', r.error);
        cerrarHoja(); aviso('Pago registrado'); render();
      });
    });
  }
  function abrirMovCuenta(tipo, cid) {
    var d = S.data, esR = tipo === 'retiro';
    var html = '<form class="form" id="f-mov" novalidate>' +
      '<label class="campo"><span>Cuenta</span><select id="mv-c">' + opciones(activos(d.cuentas), cid, function (c) { return c.nombre + ' · ' + Q(C.saldoCuenta(d, c.id)); }) + '</select></label>' +
      '<label class="campo"><span>Descripción</span><input id="mv-d" placeholder="' + (esR ? 'Cajero, efectivo, transferencia…' : 'Salario, bono 14, venta…') + '"></label>' +
      '<div class="dos"><label class="campo"><span>Monto</span><input id="mv-m" inputmode="decimal" placeholder="0.00"></label>' +
      '<label class="campo"><span>Fecha</span><input id="mv-f" type="date" value="' + hoy() + '"></label></div>' +
      (esR ? '<p class="nota">Un retiro baja el saldo de la cuenta y puede dejarla en negativo. No cuenta como gasto: anota aparte en qué usas el efectivo.</p>' : '') +
      '<p class="error" id="mv-err" hidden></p><button class="btn btn-principal" type="submit">Registrar ' + (esR ? 'retiro' : 'ingreso') + '</button></form>';
    abrirHoja(esR ? 'Registrar retiro' : 'Registrar ingreso', html, function (root) {
      $('#f-mov', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var r = ejecutar({ tipo: esR ? 'agregarRetiro' : 'agregarIngreso', cuenta: $('#mv-c', root).value, descripcion: $('#mv-d', root).value, monto: $('#mv-m', root).value, fecha: $('#mv-f', root).value });
        if (!r.ok) return errorEn(root, '#mv-err', r.error);
        cerrarHoja(); aviso(esR ? 'Retiro registrado' : 'Ingreso registrado'); render();
      });
    });
  }
  function abrirTarjeta(id) {
    var d = S.data, t = C.buscar(d.tarjetas, id), h = hoy(), e = C.estadoTarjeta(d, id, h);
    var prox = [];
    d.cuotas.forEach(function (c) { if (c.tarjeta === id) { var x = C.estadoCuota(c, h); if (x.proxima) prox.push(x.proxima); } });
    prox.sort(function (a, b) { return a.fecha.localeCompare(b.fecha); });
    var html = '<div class="cifra"><span class="eyebrow">Deuda actual' + (t.banco ? ' · ' + esc(t.banco) : '') + '</span><span class="cifra-valor num">' + Q(e.deuda) + '</span>' +
      '<span class="sub">' + (e.conCorte ? 'Corte el ' + t.corte + ' · pago el ' + t.pago + ' de cada mes' : 'Sin día de corte') + '</span></div>' +
      '<p class="alerta suave">' + esc(infoContado(e)) + '</p>' +
      '<div><span class="eyebrow">Próximas cuotas</span><ul class="lista">' + (prox.length ? prox.map(function (x) {
        return '<li class="item"><span></span><span class="item-txt"><span class="item-nombre">' + esc(x.nombre) + '<span class="insignia">' + x.n + '/' + x.de + '</span></span><span class="item-meta">' + esc(C.fechaCorta(x.fecha)) + '</span></span><span class="item-monto num">' + Q(x.monto) + '</span></li>';
      }).join('') : '<li class="vacio">Sin cuotas pendientes en esta tarjeta.</li>') + '</ul></div>' +
      '<div class="fila-btns"><button type="button" class="btn btn-principal" id="t-pagar">Pagar</button><button type="button" class="btn" id="t-editar">Editar o quitar</button></div>';
    abrirHoja(t.nombre, html, function (root) {
      $('#t-pagar', root).addEventListener('click', function () { abrirPago(id); });
      $('#t-editar', root).addEventListener('click', function () { abrirBanco('tarjetas', id); });
    });
  }
  function abrirCuenta(id) {
    var c = C.buscar(S.data.cuentas, id);
    var html = '<div class="cifra"><span class="eyebrow">Saldo' + (c.banco ? ' · ' + esc(c.banco) : '') + '</span><span class="cifra-valor num' + (C.saldoCuenta(S.data, id) < 0 ? ' negativo' : '') + '">' + Q(C.saldoCuenta(S.data, id)) + '</span></div>' +
      '<div class="fila-btns"><button type="button" class="btn btn-principal" id="c-ing">Ingreso</button><button type="button" class="btn btn-principal" id="c-ret">Retiro</button></div>' +
      '<button type="button" class="btn" id="c-editar">Editar o quitar</button>';
    abrirHoja(c.nombre, html, function (root) {
      $('#c-ing', root).addEventListener('click', function () { abrirMovCuenta('ingreso', id); });
      $('#c-ret', root).addEventListener('click', function () { abrirMovCuenta('retiro', id); });
      $('#c-editar', root).addEventListener('click', function () { abrirBanco('cuentas', id); });
    });
  }
  // Agregar (sin id) o editar una tarjeta o cuenta.
  function abrirBanco(tabla, id) {
    var esT = tabla === 'tarjetas', x = id ? C.buscar(S.data[tabla], id) : { nombre: '', banco: '', color: '#1F4E9C', inicial: 0, corte: '', pago: '' };
    var html = '<form class="form" id="f-banco" novalidate>' +
      '<label class="campo"><span>Nombre</span><input id="bk-n" value="' + esc(x.nombre) + '" placeholder="' + (esT ? 'Ej.: Visa Promerica …1320' : 'Ej.: Monetaria BI') + '"></label>' +
      '<div class="dos"><label class="campo"><span>Banco</span><input id="bk-b" value="' + esc(x.banco) + '"></label>' +
      '<label class="campo"><span>Color del banco</span><input id="bk-c" type="color" value="' + esc(x.color) + '"></label></div>' +
      (esT ? '<div class="dos"><label class="campo"><span>Día de corte</span><input id="bk-corte" inputmode="numeric" placeholder="27" value="' + (x.corte || '') + '"></label>' +
        '<label class="campo"><span>Día de pago</span><input id="bk-pago" inputmode="numeric" placeholder="27" value="' + (x.pago || '') + '"></label></div>' +
        '<p class="nota">Te aviso 5 días antes del día de pago. Si pagas el mismo día del corte, pon el mismo número en los dos.</p>' : '') +
      '<label class="campo"><span>' + (esT ? 'Deuda al empezar a usar la app' : 'Saldo al empezar a usar la app') + '</span><input id="bk-i" inputmode="decimal" value="' + (x.inicial ? C.decimal(x.inicial) : '') + '" placeholder="0.00"></label>' +
      '<p class="error" id="bk-err" hidden></p><button class="btn btn-principal" type="submit">' + (id ? 'Guardar' : 'Agregar ' + (esT ? 'tarjeta' : 'cuenta')) + '</button>' +
      (id ? '<button class="btn btn-peligro" type="button" id="bk-quitar">Quitar ' + (esT ? 'tarjeta' : 'cuenta') + '</button>' : '') + '</form>';
    abrirHoja(id ? (esT ? 'Editar tarjeta' : 'Editar cuenta') : (esT ? 'Nueva tarjeta' : 'Nueva cuenta'), html, function (root) {
      $('#f-banco', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var a = { tipo: id ? 'editarBanco' : 'agregarBanco', tabla: tabla, nombre: $('#bk-n', root).value, banco: $('#bk-b', root).value,
          color: $('#bk-c', root).value, inicial: $('#bk-i', root).value };
        if (id) a.id = id;
        if (esT) { a.corte = $('#bk-corte', root).value; a.pago = $('#bk-pago', root).value; }
        var r = ejecutar(a);
        if (!r.ok) return errorEn(root, '#bk-err', r.error);
        cerrarHoja(); aviso(id ? 'Guardado' : (esT ? 'Tarjeta agregada' : 'Cuenta agregada')); render();
      });
      var q = $('#bk-quitar', root);
      if (q) dobleToque(q, 'Toca otra vez para quitar', function () {
        var r = ejecutar({ tipo: 'borrarBanco', tabla: tabla, id: id });
        if (!r.ok) return errorEn(root, '#bk-err', r.error);
        cerrarHoja(); aviso(r.info.archivada ? 'Quitada. Sus movimientos siguen en tu historial.' : 'Quitada'); render();
      });
    });
  }

  /* =====================================================================
     CUOTAS
     ===================================================================== */
  function renderCuotas() {
    var d = S.data, h = hoy();
    var lista = d.cuotas.map(function (c) { return { c: c, e: C.estadoCuota(c, h) }; }).sort(function (a, b) { return a.e.final.localeCompare(b.e.final); });
    var activas = lista.filter(function (x) { return x.e.cargadas < x.c.numCuotas; }), fin = lista.filter(function (x) { return x.e.cargadas >= x.c.numCuotas; });
    var mensual = activas.reduce(function (a, x) { return a + (x.e.proxima ? x.e.proxima.monto : 0); }, 0);
    var mio = activas.reduce(function (a, x) { return a + (x.e.proxima ? C.sumaPartes(x.e.proxima.partes, 'yo') : 0); }, 0);
    function fila(x) {
      var c = x.c, m = medioDe(c.tarjeta), partes = C.partesCuota(c);
      return '<li><button type="button" class="item" data-cuota="' + esc(c.id) + '">' + muestra(m.color) +
        '<span class="item-txt"><span class="item-nombre">' + esc(c.nombre) + '<span class="insignia">' + x.e.cargadas + '/' + c.numCuotas + '</span></span>' +
        '<span class="item-meta">' + esc(C.describirDueno(d, partes)) + ' · termina ' + esc(C.fechaCorta(x.e.final)) + '</span></span>' +
        '<span class="item-monto num">' + Q(x.e.montoCuota) + '<small>al mes</small></span></button></li>';
    }
    $('#cuotas-cuerpo').innerHTML = (activas.length ? '<div class="cifra"><span class="eyebrow">Próximas cuotas</span><span class="cifra-valor num">' + Q(mensual) + '</span><span class="sub">Tuyo ' + Q(mio) + ' · de otros ' + Q(mensual - mio) + '</span></div>' : '') +
      '<button type="button" class="btn btn-principal" id="cu-nueva">Nueva compra en cuotas</button>' +
      '<div><h2 class="titulo-bloque">Activas</h2><ul class="lista">' + (activas.length ? activas.map(fila).join('') : '<li class="vacio">No hay cuotas activas.</li>') + '</ul></div>' +
      (fin.length ? '<div><h2 class="titulo-bloque">Terminadas</h2><ul class="lista">' + fin.map(fila).join('') + '</ul></div>' : '');
  }
  function abrirNuevaCuota() {
    var d = S.data, reparto = repartoInicial(), tarjetas = activos(d.tarjetas);
    if (!tarjetas.length) return aviso('Primero agrega una tarjeta en Bancos.');
    var html = '<form class="form" id="f-cuota" novalidate>' +
      '<label class="campo"><span>¿Qué compraste?</span><input id="cu-n" placeholder="Ej.: Intelaf El Naranjo"></label>' +
      '<div class="dos"><label class="campo"><span>Monto total</span><input id="cu-t" inputmode="decimal" placeholder="0.00"></label>' +
      '<label class="campo"><span>Número de cuotas</span><input id="cu-k" inputmode="numeric" placeholder="12"></label></div>' +
      '<div class="dos"><label class="campo"><span>Primera cuota</span><input id="cu-f" type="date" value="' + hoy() + '"></label>' +
      '<label class="campo"><span>Tarjeta</span><select id="cu-tc">' + opciones(tarjetas, C.medio(d, S.medio) && C.medio(d, S.medio).tipo === 'tarjeta' ? S.medio : null, function (t) { return t.nombre; }) + '</select></label></div>' +
      '<label class="campo"><span>Categoría</span><select id="cu-cat">' + C.CATEGORIAS.map(function (c) { return '<option' + (c === 'Deudas y tarjetas' ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<button type="button" class="opcion" id="cu-para"><span class="opcion-lbl">Para</span><span id="cu-para-txt">Solo mío</span></button>' +
      '<p class="nota" id="cu-prev">Escribe el monto y el número de cuotas para ver el calendario.</p>' +
      '<p class="error" id="cu-err" hidden></p><button class="btn btn-principal" type="submit">Guardar cuotas</button></form>';
    var guardado = null;
    function montar(root) {
      if (guardado) Object.keys(guardado).forEach(function (k) { $('#' + k, root).value = guardado[k]; });
      $('#cu-para-txt', root).textContent = textoPara(reparto);
      function prev() {
        var t = C.parseMonto($('#cu-t', root).value), k = parseInt($('#cu-k', root).value, 10), f = $('#cu-f', root).value;
        if (!(t > 0 && k >= 1 && k <= 120 && t >= k && C.fechaValida(f))) return;
        var pr = partesDe(reparto, t);
        var cal = C.calendarioCuota({ id: 'x', nombre: '', fechaInicio: f, total: t, numCuotas: k, partes: pr.partes || [{ p: 'yo', m: t }] });
        var ult = cal[cal.length - 1];
        $('#cu-prev', root).textContent = k + (k === 1 ? ' cuota' : ' cuotas') + ' de ' + Q(cal[0].monto) +
          (ult.monto !== cal[0].monto ? ' (la última de ' + Q(ult.monto) + ')' : '') + '. Última cuota: ' + C.fechaCorta(ult.fecha) + '.' +
          (pr.partes && pr.partes.length > 1 ? ' Cada mes: ' + cal[0].partes.map(function (x) { return personaTxt(x.p) + ' ' + Q(x.m); }).join(', ') + '.' : '');
      }
      prev(); root.oninput = prev; root.onchange = prev;
      $('#cu-para', root).addEventListener('click', function () {
        guardado = {}; ['cu-n', 'cu-t', 'cu-k', 'cu-f', 'cu-tc', 'cu-cat'].forEach(function (k) { guardado[k] = $('#' + k, root).value; });
        abrirReparto({ estado: reparto, titulo: '¿De quién es la cuota?', nota: 'Solo personas permanentes. Cada una paga su parte en cuotas iguales.',
          total: function () { return C.parseMonto(guardado['cu-t']); },
          personas: function () { return activos(d.personas).filter(function (p) { return p.tipo === 'permanente'; }); },
          alCerrar: function () { setTimeout(function () { abrirHoja('Compra en cuotas', html, montar); }, 0); } });
      });
      $('#f-cuota', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var t = C.parseMonto($('#cu-t', root).value), partes;
        if (t > 0) { var pr = partesDe(reparto, t); if (pr.error) return errorEn(root, '#cu-err', pr.error); partes = pr.partes; }
        var r = ejecutar({ tipo: 'agregarCuota', nombre: $('#cu-n', root).value, total: $('#cu-t', root).value, numCuotas: $('#cu-k', root).value,
          fechaInicio: $('#cu-f', root).value, tarjeta: $('#cu-tc', root).value, categoria: $('#cu-cat', root).value, partes: partes });
        if (!r.ok) return errorEn(root, '#cu-err', r.error);
        cerrarHoja(); aviso('Cuotas guardadas'); render();
      });
    }
    abrirHoja('Compra en cuotas', html, montar);
  }
  function abrirCuota(id) {
    var c = C.buscar(S.data.cuotas, id); if (!c) return;
    var e = C.estadoCuota(c, hoy()), m = medioDe(c.tarjeta), partes = C.partesCuota(c);
    var html = '<div class="cifra"><span class="eyebrow">' + esc(c.categoria) + '</span><span class="cifra-valor num">' + Q(c.total) + '</span>' +
      '<span class="etiquetas"><span class="etiqueta">' + muestra(m.color) + esc(m.nombre) + '</span><span class="etiqueta">' + e.cargadas + ' de ' + c.numCuotas + ' cargadas</span></span></div>' +
      (partes.length > 1 || partes[0].p !== 'yo' ? '<div><span class="eyebrow">Reparto del total</span><ul class="lista">' + partes.map(function (x) {
        var alMes = e.calendario[0].partes.filter(function (y) { return y.p === x.p; })[0].m;
        return '<li class="item"><span></span><span class="item-txt"><span class="item-nombre">' + esc(personaTxt(x.p)) + '</span><span class="item-meta">' + Q(alMes) + ' al mes</span></span><span class="item-monto num">' + Q(x.m) + '</span></li>';
      }).join('') + '</ul></div>' : '') +
      '<ul class="lista">' + e.calendario.map(function (x) {
        return '<li class="item"><span class="insignia" style="margin:0">' + x.n + '/' + x.de + '</span><span class="item-txt"><span class="item-nombre">' + esc(C.fechaCorta(x.fecha)) + '</span>' +
          '<span class="item-meta">' + (x.fecha <= hoy() ? 'Cargada a la tarjeta' : 'Pendiente') + '</span></span><span class="item-monto num">' + Q(x.monto) + '</span></li>';
      }).join('') + '</ul><button type="button" class="btn btn-peligro" id="cu-borrar">Borrar esta compra en cuotas</button>';
    abrirHoja(c.nombre, html, function (root) {
      dobleToque($('#cu-borrar', root), 'Toca otra vez para borrar', function () { ejecutar({ tipo: 'borrarCuota', id: id }); cerrarHoja(); aviso('Cuotas borradas'); render(); });
    });
  }

  /* =====================================================================
     PERSONAS
     ===================================================================== */
  function renderPersonas() {
    var d = S.data, ym = mesActual(), r = C.recuento(d, ym), lista = activos(d.personas);
    $('#personas-cuerpo').innerHTML = '<form class="form" id="f-persona" novalidate><h2 class="titulo-bloque">Agregar persona</h2>' +
      '<label class="campo"><span>Nombre</span><input id="pe-n" placeholder="Ej.: Esther"></label>' +
      '<div class="dos"><label class="campo"><span>Duración</span><select id="pe-t"><option value="permanente">Permanente</option><option value="mes">Solo un mes</option></select></label>' +
      '<label class="campo"><span>Mes</span><input id="pe-m" type="month" value="' + ym + '" disabled></label></div>' +
      '<p class="error" id="pe-err" hidden></p><button class="btn btn-principal" type="submit">Agregar persona</button></form>' +
      '<div><div class="cab-bloque"><h2 class="titulo-bloque">Tus personas</h2><span class="sub">' + esc(C.nombreMes(ym)) + '</span></div><ul class="lista">' + (lista.length ? lista.map(function (p) {
        var x = r.personas.filter(function (y) { return y.id === p.id; })[0];
        return '<li><button type="button" class="item" data-persona="' + esc(p.id) + '"><span></span><span class="item-txt"><span class="item-nombre">' + esc(p.nombre) + '</span>' +
          '<span class="item-meta">' + (p.tipo === 'mes' ? 'Solo ' + esc(C.nombreMes(p.mes)) : 'Permanente') + '</span></span>' +
          '<span class="item-monto num">' + Q(x ? x.total : 0) + '<small>te debe</small></span></button></li>';
      }).join('') : '<li class="vacio">Agrega a las personas con quienes compartes gastos o cuotas.</li>') + '</ul></div>';
    $('#pe-t').addEventListener('change', function () { $('#pe-m').disabled = this.value !== 'mes'; });
    $('#f-persona').addEventListener('submit', function (e) {
      e.preventDefault();
      var res = ejecutar({ tipo: 'agregarPersona', nombre: $('#pe-n').value, clase: $('#pe-t').value, mes: $('#pe-m').value });
      if (!res.ok) { $('#pe-err').textContent = res.error; $('#pe-err').hidden = false; return; }
      aviso('Persona agregada'); render();
    });
  }
  function abrirPersona(id) {
    var d = S.data, p = C.buscar(d.personas, id); if (!p) return;
    var ym = p.tipo === 'mes' ? p.mes : mesActual(), r = C.recuento(d, ym);
    var x = r.personas.filter(function (y) { return y.id === id; })[0] || { gastos: 0, cuotas: 0, total: 0 };
    var gastos = r.gastos.filter(function (g) { return g.partes.some(function (q) { return q.p === id; }); });
    var cuotas = r.cuotas.filter(function (c) { return c.partes.some(function (q) { return q.p === id; }); });
    var parte = function (partes) { return partes.filter(function (y) { return y.p === id; })[0].m; };
    var html = '<div class="cifra"><span class="eyebrow">' + esc(C.nombreMes(ym)) + ' · te debe</span><span class="cifra-valor num">' + Q(x.total) + '</span>' +
      '<span class="sub">Gastos ' + Q(x.gastos) + ' · Cuotas ' + Q(x.cuotas) + '</span></div><ul class="lista">' +
      gastos.map(function (g) { return '<li class="item">' + muestra(medioDe(g.medio).color) + '<span class="item-txt"><span class="item-nombre">' + esc(g.nombre) + '</span><span class="item-meta">' + esc(fechaTxt(g.fecha)) + '</span></span><span class="item-monto num">' + Q(parte(g.partes)) + '</span></li>'; }).join('') +
      cuotas.map(function (c) { return '<li class="item">' + muestra(medioDe(c.tarjeta).color) + '<span class="item-txt"><span class="item-nombre">' + esc(c.nombre) + '<span class="insignia">' + c.n + '/' + c.de + '</span></span><span class="item-meta">Cuota · ' + esc(C.fechaCorta(c.fecha)) + '</span></span><span class="item-monto num">' + Q(parte(c.partes)) + '</span></li>'; }).join('') +
      '</ul><button type="button" class="btn btn-peligro" id="pe-quitar">Quitar persona</button>';
    abrirHoja(p.nombre, html, function (root) {
      dobleToque($('#pe-quitar', root), 'Toca otra vez para quitar', function () {
        var res = ejecutar({ tipo: 'borrarPersona', id: id });
        if (!res.ok) return aviso(res.error);
        cerrarHoja(); aviso(res.info.archivada ? p.nombre + ' ya no aparece para elegir; su historial se conserva.' : 'Persona quitada'); render();
      });
    });
  }

  /* =====================================================================
     AJUSTES (botón de engrane)
     ===================================================================== */
  function abrirAjustes() {
    var d = S.data, ej = 0;
    C.NOMBRES_TABLAS.forEach(function (t) { (d[t] || []).forEach(function (r) { if (r.ejemplo) ej++; }); });
    var aprendidas = d.reglas.filter(function (r) { return r.origen === 'usuario'; });
    var h = '<div><span class="eyebrow">Conexión</span>' + (esLocal()
      ? '<p class="nota">Modo de prueba: los datos viven solo en este teléfono.</p>'
      : '<div class="form" style="margin-top:8px"><div class="copiable"><code>' + esc(S.cfg.url) + '</code><button type="button" class="btn btn-chico" data-copiar="url">Copiar</button></div>' +
        '<div class="copiable"><code>' + esc(S.cfg.clave) + '</code><button type="button" class="btn btn-chico" data-copiar="clave">Copiar</button></div></div>') +
      '<div class="fila-btns" style="margin-top:10px"><button type="button" class="btn" id="aj-conexion">Cambiar conexión</button>' +
      (esLocal() ? '' : '<button type="button" class="btn" id="aj-sync">Actualizar ahora</button>') + '</div></div>';
    h += '<div><span class="eyebrow">Palabras aprendidas</span>' + (aprendidas.length ? '<ul class="lista">' + aprendidas.map(function (r) {
      return '<li class="item"><span></span><span class="item-txt"><span class="item-nombre">' + esc(r.palabra) + '</span><span class="item-meta">' + esc(r.tipo) + '</span></span><span class="sub">' + esc(r.categoria) + '</span></li>';
    }).join('') + '</ul>' : '<p class="nota">Cuando cambies la categoría de un gasto, la regla aparecerá aquí.</p>') + '</div>';
    if (ej) h += '<div><span class="eyebrow">Datos de ejemplo</span><p class="nota">Hay ' + ej + ' registros de ejemplo.</p><button type="button" class="btn btn-peligro" id="aj-borrar">Borrar datos de ejemplo</button></div>';
    abrirHoja('Ajustes', h, function (root) {
      $('#aj-conexion', root).addEventListener('click', function () { cerrarHoja(); mostrarBienvenida(); });
      var s = $('#aj-sync', root); if (s) s.addEventListener('click', function () { cerrarHoja(); cargar(); });
      var b = $('#aj-borrar', root);
      if (b) dobleToque(b, 'Toca otra vez para borrar', function () { var r = ejecutar({ tipo: 'borrarEjemplos' }); cerrarHoja(); aviso('Se borraron ' + r.info.borrados + ' registros de ejemplo'); render(); });
      root.onclick = function (e) {
        var t = e.target.closest('[data-copiar]'); if (!t) return;
        var v = S.cfg[t.dataset.copiar];
        Promise.resolve().then(function () { return navigator.clipboard.writeText(v); }).then(function () { aviso('Copiado'); }, function () { aviso(v); });
      };
    });
  }

  /* =====================================================================
     Navegación y eventos
     ===================================================================== */
  function render() {
    if (!S.data) return;
    ({ anotar: renderAnotar, mes: renderMes, bancos: renderBancos, cuotas: renderCuotas, personas: renderPersonas })[S.tab]();
    ponerEstado(esLocal() ? 'local' : (S.outbox.length ? 'pendiente' : S.sync));
  }
  function irA(tab) {
    S.tab = tab;
    $$('.tabs button').forEach(function (b) { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $$('.vista').forEach(function (v) { v.hidden = v.dataset.vista !== tab; });
    window.scrollTo(0, 0);
    render();
  }
  $$('.tabs button').forEach(function (b) { b.addEventListener('click', function () { irA(b.dataset.tab); }); });
  $$('[data-mes]').forEach(function (b) { b.addEventListener('click', function () { S.mes = C.sumarMeses(mesActual(), +b.dataset.mes); S.mesElegido = true; render(); }); });
  $('#ajustes').addEventListener('click', function () { if (S.data) abrirAjustes(); });

  $('#f-gasto').addEventListener('submit', registrar);
  $('#g-nombre').addEventListener('input', pista);
  $('#g-monto').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#g-nombre').focus(); } });
  $('#g-medio').addEventListener('change', function () { S.medio = this.value; $('#g-medio-color').style.setProperty('--c', medioDe(S.medio).color); });
  $('#g-fecha').addEventListener('change', function () {
    S.fecha = this.value && this.value !== hoy() ? this.value : null;
    $('#g-fecha-txt').textContent = fechaTxt(S.fecha || hoy());
  });
  $('#g-para').addEventListener('click', function () {
    abrirReparto({ estado: S.reparto, total: function () { return C.parseMonto($('#g-monto').value); },
      personas: function () { return C.personasDelMes(S.data, mesDelGasto()); },
      alCerrar: function () { $('#g-para-txt').textContent = textoPara(S.reparto); } });
  });

  // Clics en listas (delegados); lo que está dentro de la hoja lo maneja cada hoja.
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-gasto],[data-cuota],[data-cat],[data-tarjeta],[data-cuenta],[data-persona],[data-pagar],#b-pagar,#b-ingreso,#b-retiro,#b-nueva-t,#b-nueva-c,#cu-nueva');
    if (!t || t.closest('#hoja')) return;
    if (t.dataset.gasto) abrirGasto(t.dataset.gasto);
    else if (t.dataset.cuota) abrirCuota(t.dataset.cuota);
    else if (t.dataset.cat && t.classList.contains('pres')) abrirLimite(t.dataset.cat);
    else if (t.dataset.tarjeta) abrirTarjeta(t.dataset.tarjeta);
    else if (t.dataset.cuenta) abrirCuenta(t.dataset.cuenta);
    else if (t.dataset.persona) abrirPersona(t.dataset.persona);
    else if (t.dataset.pagar) abrirPago(t.dataset.pagar);
    else if (t.id === 'b-pagar') abrirPago();
    else if (t.id === 'b-ingreso') abrirMovCuenta('ingreso');
    else if (t.id === 'b-retiro') abrirMovCuenta('retiro');
    else if (t.id === 'b-nueva-t') abrirBanco('tarjetas');
    else if (t.id === 'b-nueva-c') abrirBanco('cuentas');
    else if (t.id === 'cu-nueva') abrirNuevaCuota();
  });
  $('#estado').addEventListener('click', function () { if (!esLocal()) cargar(); });

  /* ---------- Bienvenida / conexión ---------- */
  function mostrarBienvenida(error) {
    $('#bienvenida').hidden = false;
    $('#cx-url').value = S.cfg && S.cfg.url || '';
    $('#cx-clave').value = S.cfg && S.cfg.clave || '';
    var e = $('#cx-error'); e.hidden = !error; e.textContent = error || '';
  }
  $('#f-conexion').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var url = $('#cx-url').value.trim(), clave = $('#cx-clave').value.trim(), e = $('#cx-error');
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { e.textContent = 'La dirección tiene que empezar con https://script.google.com/'; e.hidden = false; return; }
    if (!clave) { e.textContent = 'Escribe la clave secreta.'; e.hidden = false; return; }
    var btn = $('#cx-enviar'); btn.disabled = true; btn.textContent = 'Conectando…';
    var previo = S.cfg; S.cfg = { modo: 'remoto', url: url, clave: clave };
    api({ accion: 'cargar' }).then(function (r) {
      btn.disabled = false; btn.textContent = 'Conectar';
      if (!r.ok) { S.cfg = previo; e.textContent = r.error; e.hidden = false; return; }
      LS.set('cfg', S.cfg); S.data = asegurarDatos(r.data); guardarCache();
      $('#bienvenida').hidden = true; irA('anotar');
    }).catch(function () {
      S.cfg = previo; btn.disabled = false; btn.textContent = 'Conectar';
      e.textContent = 'No pude conectarme. Revisa la dirección y que el script esté publicado para "Cualquier persona".'; e.hidden = false;
    });
  });
  $('#cx-local').addEventListener('click', function () {
    S.cfg = { modo: 'local' }; LS.set('cfg', S.cfg);
    S.data = asegurarDatos(LS.get('local', null)) || datosLocalesNuevos();
    $('#bienvenida').hidden = true; irA('anotar');
  });

  /* ---------- Arranque ---------- */
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && S.cfg && !esLocal()) cargar(true); });
  window.addEventListener('online', function () { vaciarCola(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});

  if (!S.cfg) mostrarBienvenida();
  else if (esLocal()) { S.data = asegurarDatos(LS.get('local', null)) || datosLocalesNuevos(); irA('anotar'); }
  else { S.data = asegurarDatos(LS.get('cache', null)); if (S.data) irA('anotar'); cargar(!!S.data).then(function () { irA(S.tab); }); }
})();

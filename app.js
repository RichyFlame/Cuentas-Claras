/* Cuentas Claras — web app (sin frameworks). Reglas de negocio en core.js */
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
  var S = {
    cfg: LS.get('cfg', null), data: null, mes: null, tab: 'anotar', seg: 'cuotas',
    medio: null, fecha: null, reparto: null, outbox: LS.get('outbox', []), sync: 'ok', cargando: false
  };
  function repartoInicial() { return { modo: 'mio', persona: null, sel: ['yo'], dividir: 'iguales', montos: {} }; }
  S.reparto = repartoInicial();

  function hoy() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nuevoId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function ctx() { return { hoy: hoy(), ahora: new Date().toISOString(), id: nuevoId }; }
  S.mes = C.mesDe(hoy());

  /* ---------- Conexión con Apps Script ---------- */
  function api(body) {
    var payload = JSON.stringify(Object.assign({ clave: S.cfg.clave }, body));
    // Sin encabezado Content-Type: el navegador manda text/plain y Apps Script no exige preflight (CORS).
    return fetch(S.cfg.url, { method: 'POST', body: payload, redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function esLocal() { return S.cfg && S.cfg.modo === 'local'; }
  function guardarCache() { LS.set(esLocal() ? 'local' : 'cache', S.data); }

  // Ejecuta una acción: la valida y aplica al instante en el teléfono (registro < 5 s)
  // y la manda al servidor en segundo plano. Si no hay señal queda en cola.
  function ejecutar(accion) {
    var c = ctx();
    var res = C.aplicar(S.data, accion, c);
    if (!res.ok) return res;
    var add = res.ops[0] && res.ops[0].op === 'add' ? res.ops[0].row : null;
    if (add) { // fija lo calculado aquí para que el servidor guarde exactamente lo mismo
      if (add.id) accion.id = add.id;
      if (add.fecha) accion.fecha = add.fecha;
      if (accion.tipo === 'agregarGasto') { accion.medio = add.medio; accion.categoria = add.categoria; accion.tipoGasto = add.tipo; accion.partes = add.partes; }
    }
    C.aplicarOps(S.data, res.ops);
    guardarCache();
    if (!esLocal() && res.ops.length) {
      S.outbox.push(JSON.parse(JSON.stringify(accion))); LS.set('outbox', S.outbox); vaciarCola();
    }
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
      var a = S.outbox[0];
      return api({ accion: 'aplicar', datos: a }).then(function (r) {
        S.outbox.shift(); LS.set('outbox', S.outbox);
        if (!r.ok) { recargar = true; aviso('No se guardó en la hoja: ' + r.error); }
        return siguiente();
      }, function () { enviando = false; ponerEstado('pendiente'); });
    }
    return siguiente();
  }
  function cargar(silencioso) {
    if (esLocal()) { S.data = LS.get('local', null) || datosLocalesNuevos(); render(); return Promise.resolve(); }
    if (S.cargando) return Promise.resolve();
    S.cargando = true; if (!silencioso) ponerEstado('cargando');
    return vaciarCola().then(function () {
      return api({ accion: 'cargar' });
    }).then(function (r) {
      S.cargando = false;
      if (!r.ok) { ponerEstado('error'); if (/clave/i.test(r.error)) mostrarBienvenida(r.error); else aviso(r.error); return; }
      S.data = r.data;
      S.outbox.forEach(function (a) { var x = C.aplicar(S.data, a, ctx()); if (x.ok) C.aplicarOps(S.data, x.ops); });
      guardarCache(); ponerEstado(S.outbox.length ? 'pendiente' : 'ok'); render();
    }).catch(function () {
      S.cargando = false; ponerEstado(S.outbox.length ? 'pendiente' : 'error');
      if (!S.data) { S.data = LS.get('cache', null); if (S.data) render(); }
    });
  }
  function datosLocalesNuevos() {
    var d = C.datosBase(); C.sembrarEjemplos(d, ctx()); LS.set('local', d); return d;
  }

  function ponerEstado(e) {
    S.sync = e;
    var el = $('#estado');
    var txt = { ok: 'Guardado', pendiente: S.outbox.length + ' sin enviar', error: 'Sin conexión', cargando: 'Actualizando…', local: 'Modo de prueba' };
    if (esLocal()) e = 'local';
    el.dataset.estado = e === 'cargando' ? 'pendiente' : e;
    el.textContent = txt[e] || '';
  }

  /* ---------- Avisos ---------- */
  var tAviso;
  function aviso(msg) {
    var el = $('#aviso'); el.textContent = msg; el.hidden = false;
    clearTimeout(tAviso); tAviso = setTimeout(function () { el.hidden = true; }, 3200);
  }

  /* ---------- Hoja inferior ---------- */
  var alCerrar = null;
  function abrirHoja(titulo, html, montar, cerrar) {
    $('#hoja-titulo').textContent = titulo;
    $('#hoja-cuerpo').innerHTML = html;
    $('#hoja').hidden = false; $('#velo').hidden = false;
    alCerrar = cerrar || null;
    if (montar) montar($('#hoja-cuerpo'));
  }
  function cerrarHoja() {
    $('#hoja').hidden = true; $('#velo').hidden = true;
    var f = alCerrar; alCerrar = null; if (f) f();
  }
  $('#hoja-cerrar').addEventListener('click', cerrarHoja);
  $('#velo').addEventListener('click', cerrarHoja);

  // Botón que pide un segundo toque antes de algo que no se puede deshacer.
  function dobleToque(btn, texto, fn) {
    var armado = false, t;
    btn.addEventListener('click', function () {
      if (armado) { clearTimeout(t); fn(); return; }
      armado = true; var orig = btn.textContent; btn.textContent = texto; btn.classList.add('confirmar');
      t = setTimeout(function () { armado = false; btn.textContent = orig; btn.classList.remove('confirmar'); }, 4000);
    });
  }

  /* ---------- Ayudas de presentación ---------- */
  function medioDe(id) { var m = C.medio(S.data, id); return m ? m.obj : { nombre: id || '—', color: '#8F9C95', banco: '' }; }
  function muestra(color, grande) { return '<span class="muestra' + (grande ? ' grande' : '') + '" style="--c:' + esc(color) + '"></span>'; }
  function fechaTxt(f) { return f === hoy() ? 'Hoy' : C.fechaCorta(f); }
  function personaTxt(id) { return C.nombrePersona(S.data, id); }
  function describirPartes(g) {
    if (g.partes.length === 1 && g.partes[0].p === 'yo') return '';
    if (g.partes.length === 1) return 'De ' + personaTxt(g.partes[0].p);
    return 'Dividido entre ' + g.partes.length;
  }
  function opcionesSelect(lista, sel, etiqueta) {
    return lista.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(etiqueta(x)) + '</option>'; }).join('');
  }

  /* =====================================================================
     ANOTAR
     ===================================================================== */
  function renderAnotar() {
    var d = S.data, sel = S.medio && C.medio(d, S.medio) ? S.medio : C.ultimoMedio(d);
    S.medio = sel;
    $('#g-medios').innerHTML = d.tarjetas.concat(d.cuentas).map(function (m) {
      return '<button type="button" class="chip" role="radio" data-medio="' + esc(m.id) + '" aria-checked="' + (m.id === sel) + '">' + muestra(m.color) + esc(m.nombre) + '</button>';
    }).join('');
    $('#g-fecha').value = S.fecha || hoy();
    $('#g-fecha-txt').textContent = fechaTxt(S.fecha || hoy());
    $('#g-para-txt').textContent = textoPara();
    pista();

    var ult = d.gastos.slice().sort(function (a, b) { return (b.creado || '').localeCompare(a.creado || ''); }).slice(0, 6);
    $('#g-ultimos').innerHTML = ult.length ? ult.map(itemGasto).join('') : '<li class="vacio">Todavía no hay gastos. Escribe el monto y en qué fue.</li>';
    renderBannerAtajo();
  }
  function itemGasto(g) {
    var m = medioDe(g.medio), extra = describirPartes(g), mio = C.miParte(g);
    return '<li><button type="button" class="item" data-gasto="' + esc(g.id) + '">' + muestra(m.color) +
      '<span class="item-txt"><span class="item-nombre">' + esc(g.nombre) + '</span>' +
      '<span class="item-meta">' + esc(g.categoria) + ' · ' + esc(fechaTxt(g.fecha)) + (extra ? ' · ' + esc(extra) : '') + '</span></span>' +
      '<span class="item-monto num">' + Q(g.monto) + (mio !== g.monto ? '<small>tuyo ' + Q(mio) + '</small>' : '') + '</span></button></li>';
  }
  function textoPara() {
    var r = S.reparto;
    if (r.modo === 'otra') return r.persona ? 'De ' + personaTxt(r.persona) : 'Elige persona';
    if (r.modo === 'dividir') return 'Dividido · ' + r.sel.length;
    return 'Solo mío';
  }
  function pista() {
    if (!S.data) return;
    var n = $('#g-nombre').value.trim(), el = $('#g-pista');
    if (!n) { el.innerHTML = '&nbsp;'; return; }
    var c = C.clasificar(n, S.data.reglas);
    el.innerHTML = 'Irá a <b>' + esc(c.categoria) + '</b> · ' + esc(c.tipo);
  }

  function partesDeReparto(total) {
    var r = S.reparto;
    if (r.modo === 'mio') return { partes: [{ p: 'yo', m: total }] };
    if (r.modo === 'otra') return r.persona ? { partes: [{ p: r.persona, m: total }] } : { error: 'Elige de quién es el gasto (toca "Para").' };
    var sel = ['yo'].concat(r.sel.filter(function (p) { return p !== 'yo'; })).filter(function (p) { return r.sel.indexOf(p) >= 0; });
    if (sel.length < 2) return { error: 'Para dividir elige al menos dos personas.' };
    if (r.dividir === 'iguales') return { partes: C.dividirIguales(total, sel) };
    var partes = sel.map(function (p) { var m = C.parseMonto(r.montos[p] || '0'); return { p: p, m: m }; });
    if (partes.some(function (x) { return x.m === null || x.m < 0; })) return { error: 'Revisa los montos del reparto.' };
    return { partes: partes };
  }

  function registrar(ev) {
    ev.preventDefault();
    var err = $('#g-error'); err.hidden = true;
    var montoTxt = $('#g-monto').value, nombre = $('#g-nombre').value;
    var total = C.parseMonto(montoTxt);
    var accion = { tipo: 'agregarGasto', nombre: nombre, monto: montoTxt, medio: S.medio, fecha: S.fecha || hoy() };
    if (total !== null && total > 0) {
      var pr = partesDeReparto(total);
      if (pr.error) { err.textContent = pr.error; err.hidden = false; return; }
      accion.partes = pr.partes;
    }
    var antes = C.presupuestoMes(S.data, C.mesDe(accion.fecha));
    var res = ejecutar(accion);
    if (!res.ok) { err.textContent = res.error; err.hidden = false; return; }
    var g = res.info.gasto;
    $('#g-monto').value = ''; $('#g-nombre').value = '';
    S.reparto = repartoInicial(); S.fecha = null;
    $('#g-monto').blur(); $('#g-nombre').blur();
    mostrarResultado(g, antes);
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
    var m = medioDe(g.medio), mio = C.miParte(g), extra = describirPartes(g);
    $('#g-resultado').innerHTML = '<div class="resultado">' +
      '<div class="resultado-cab"><span class="resultado-monto num">' + Q(g.monto) + '</span><span class="sub">' + esc(g.nombre) + '</span></div>' +
      '<div class="etiquetas"><span class="etiqueta">' + esc(g.categoria) + '</span>' +
      '<span class="etiqueta ' + (g.tipo === 'Necesario' ? 'necesario' : 'prescindible') + '">' + esc(g.tipo) + '</span>' +
      '<span class="etiqueta">' + muestra(m.color) + esc(m.nombre) + '</span>' +
      (extra ? '<span class="etiqueta">' + esc(extra) + (mio ? ' · tuyo ' + Q(mio) : '') + '</span>' : '') + '</div>' +
      alertaPresupuesto(g.categoria, C.mesDe(g.fecha), antes) +
      '<div class="fila-btns"><button type="button" class="btn btn-chico" data-gasto="' + esc(g.id) + '">Cambiar clasificación</button></div></div>';
  }

  /* ----- Banner de gastos que llegaron por el atajo ----- */
  function renderBannerAtajo() {
    var el = $('#atajo-banner');
    var pend = S.data.gastos.filter(function (g) { return g.origen === 'atajo' && !g.revisado; });
    if (!pend.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<div class="atajo"><div class="cab-bloque"><span class="eyebrow">Desde el atajo · ' + pend.length + '</span>' +
      '<button type="button" class="btn-texto btn" id="atajo-ok">Todo bien</button></div>' +
      '<ul class="lista">' + pend.map(itemGasto).join('') + '</ul>' +
      '<p class="nota">Toca un gasto si quieres cambiar su clasificación.</p></div>';
    $('#atajo-ok').addEventListener('click', function () {
      ejecutar({ tipo: 'marcarRevisado', ids: pend.map(function (g) { return g.id; }) });
      renderAnotar();
    });
  }

  /* ----- Hoja: para quién es el gasto ----- */
  function abrirReparto() {
    var mesG = C.mesDe(S.fecha || hoy());
    function html() {
      var r = S.reparto, per = C.personasDelMes(S.data, mesG), total = C.parseMonto($('#g-monto').value) || 0;
      var h = '<div class="segmentos" id="rp-modo">' +
        [['mio', 'Solo mío'], ['otra', 'Otra persona'], ['dividir', 'Dividido']].map(function (o) {
          return '<button type="button" data-modo="' + o[0] + '" aria-pressed="' + (r.modo === o[0]) + '">' + o[1] + '</button>';
        }).join('') + '</div>';
      if (r.modo === 'mio') h += '<p class="nota">Todo el gasto cuenta como tuyo.</p>';
      if (r.modo === 'otra') {
        h += '<p class="nota">Tú lo pagas y esa persona te lo debe. No cuenta como gasto tuyo.</p>';
        h += per.length ? per.map(function (p) {
          return '<label class="check"><input type="radio" name="rp-p" value="' + esc(p.id) + '"' + (r.persona === p.id ? ' checked' : '') + '><span class="grow">' + esc(p.nombre) + '</span></label>';
        }).join('') : '<p class="vacio">No hay personas para ' + esc(C.nombreMes(mesG)) + '. Agrega una abajo.</p>';
      }
      if (r.modo === 'dividir') {
        h += '<div class="segmentos" id="rp-div"><button type="button" data-div="iguales" aria-pressed="' + (r.dividir === 'iguales') + '">Partes iguales</button>' +
          '<button type="button" data-div="montos" aria-pressed="' + (r.dividir === 'montos') + '">Montos a mano</button></div>';
        var sel = ['yo'].concat(r.sel.filter(function (p) { return p !== 'yo'; }));
        var iguales = total && r.sel.length ? C.dividirIguales(total, sel.filter(function (p) { return r.sel.indexOf(p) >= 0; })) : [];
        var cuanto = function (p) { var x = iguales.filter(function (y) { return y.p === p; })[0]; return x ? Q(x.m) : ''; };
        h += [{ id: 'yo', nombre: 'Yo' }].concat(per).map(function (p) {
          var on = r.sel.indexOf(p.id) >= 0;
          return '<label class="check"><input type="checkbox" value="' + esc(p.id) + '"' + (on ? ' checked' : '') + '><span class="grow">' + esc(p.nombre) + '</span>' +
            (r.dividir === 'montos' ? (on ? '<input class="campo-monto" inputmode="decimal" data-monto="' + esc(p.id) + '" value="' + esc(r.montos[p.id] || '') + '" placeholder="0.00" aria-label="Monto de ' + esc(p.nombre) + '">' : '')
              : '<span class="num sub">' + (on ? cuanto(p.id) : '') + '</span>') + '</label>';
        }).join('');
        h += '<p class="resto" id="rp-resto"></p>';
      }
      h += '<form class="dos" id="rp-nueva" novalidate><label class="campo"><span>Agregar persona</span><input id="rp-nombre" placeholder="Nombre"></label>' +
        '<label class="campo"><span>Duración</span><select id="rp-clase"><option value="permanente">Permanente</option><option value="mes">Solo ' + esc(C.nombreMes(mesG)) + '</option></select></label></form>' +
        '<button type="button" class="btn" id="rp-agregar">Agregar persona</button>' +
        '<button type="button" class="btn btn-principal" id="rp-listo">Listo</button>';
      return h;
    }
    function resto() {
      var el = $('#rp-resto'); if (!el) return;
      var total = C.parseMonto($('#g-monto').value) || 0;
      if (S.reparto.dividir !== 'montos') { el.textContent = total ? 'Si sobran centavos, se asignan a la primera persona.' : 'Escribe primero el monto para ver cuánto le toca a cada quien.'; el.className = 'resto'; return; }
      var suma = S.reparto.sel.reduce(function (a, p) { return a + (C.parseMonto(S.reparto.montos[p] || '0') || 0); }, 0);
      var falta = total - suma;
      el.textContent = falta === 0 ? 'Cuadra con ' + Q(total) : (falta > 0 ? 'Falta asignar ' + Q(falta) : 'Te pasaste por ' + Q(-falta));
      el.className = 'resto' + (falta === 0 ? '' : ' mal');
    }
    function montar(root) {
      root.innerHTML = html(); resto();
      root.onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.modo) { S.reparto.modo = b.dataset.modo; montar(root); }
        else if (b.dataset.div) { S.reparto.dividir = b.dataset.div; montar(root); }
        else if (b.id === 'rp-listo') cerrarHoja();
        else if (b.id === 'rp-agregar') {
          var res = ejecutar({ tipo: 'agregarPersona', nombre: $('#rp-nombre').value, clase: $('#rp-clase').value, mes: mesG });
          if (!res.ok) return aviso(res.error);
          var id = res.ops[0].row.id;
          if (S.reparto.modo === 'otra') S.reparto.persona = id;
          else { if (S.reparto.modo === 'mio') S.reparto.modo = 'dividir'; if (S.reparto.sel.indexOf(id) < 0) S.reparto.sel.push(id); }
          montar(root);
        }
      };
      root.onchange = function (e) {
        var t = e.target;
        if (t.name === 'rp-p') S.reparto.persona = t.value;
        else if (t.type === 'checkbox') {
          var i = S.reparto.sel.indexOf(t.value);
          if (t.checked && i < 0) S.reparto.sel.push(t.value); else if (!t.checked && i >= 0) S.reparto.sel.splice(i, 1);
          montar(root);
        }
      };
      root.oninput = function (e) { if (e.target.dataset.monto) { S.reparto.montos[e.target.dataset.monto] = e.target.value; resto(); } };
    }
    abrirHoja('¿Para quién es?', '', montar, function () { $('#g-para-txt').textContent = textoPara(); });
  }

  /* ----- Hoja: ver / reclasificar / borrar un gasto ----- */
  function abrirGasto(id) {
    var g = C.buscar(S.data.gastos, id); if (!g) return;
    var m = medioDe(g.medio), cat = g.categoria, tipo = g.tipo;
    var partes = g.partes.map(function (x) { return '<li class="item"><span></span><span class="item-txt">' + esc(personaTxt(x.p)) + '</span><span class="item-monto num">' + Q(x.m) + '</span></li>'; }).join('');
    var html = '<div class="cifra"><span class="eyebrow">' + esc(fechaTxt(g.fecha)) + (g.origen === 'atajo' ? ' · desde el atajo' : '') + '</span>' +
      '<span class="cifra-valor num">' + Q(g.monto) + '</span><span class="etiquetas"><span class="etiqueta">' + muestra(m.color) + esc(m.nombre) + '</span></span></div>' +
      (g.partes.length > 1 || g.partes[0].p !== 'yo' ? '<div><span class="eyebrow">Reparto</span><ul class="lista">' + partes + '</ul></div>' : '') +
      '<div><span class="eyebrow">Categoría</span><div class="cats" id="eg-cats" style="margin-top:8px">' +
      C.CATEGORIAS.map(function (c) { return '<button type="button" class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (c === cat) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>' +
      '<div><span class="eyebrow">Tipo</span><div class="segmentos" id="eg-tipo" style="margin-top:8px">' +
      C.TIPOS.map(function (t) { return '<button type="button" data-tipo="' + t + '" aria-pressed="' + (t === tipo) + '">' + t + '</button>'; }).join('') + '</div></div>' +
      '<p class="nota">Al guardar, la próxima vez que escribas “' + esc(C.palabraParaRegla(g.nombre)) + '” se clasificará igual.</p>' +
      '<button type="button" class="btn btn-principal" id="eg-guardar">Guardar clasificación</button>' +
      '<button type="button" class="btn btn-peligro" id="eg-borrar">Borrar gasto</button>';
    abrirHoja(g.nombre, html, function (root) {
      root.onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.cat) { cat = b.dataset.cat; tipo = C.TIPO_POR_CATEGORIA[cat]; $$('#eg-cats .chip', root).forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.cat === cat); }); $$('#eg-tipo button', root).forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.tipo === tipo); }); }
        if (b.dataset.tipo) { tipo = b.dataset.tipo; $$('#eg-tipo button', root).forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.tipo === tipo); }); }
        if (b.id === 'eg-guardar') {
          var r = ejecutar({ tipo: 'reclasificar', id: g.id, categoria: cat, tipoGasto: tipo });
          if (!r.ok) return aviso(r.error);
          cerrarHoja(); aviso('Guardado. Aprendí la regla para “' + (r.info.palabra || g.nombre) + '”.');
          var res = $('#g-resultado .resultado'); if (res && res.querySelector('[data-gasto="' + g.id + '"]')) mostrarResultado(C.buscar(S.data.gastos, g.id));
          render();
        }
      };
      dobleToque($('#eg-borrar', root), 'Toca otra vez para borrar', function () {
        ejecutar({ tipo: 'borrarGasto', id: g.id }); cerrarHoja(); aviso('Gasto borrado');
        var res = $('#g-resultado'); if (res.querySelector('[data-gasto="' + g.id + '"]')) res.innerHTML = '';
        render();
      });
    });
  }

  /* =====================================================================
     MES
     ===================================================================== */
  function renderMesNav() { $$('[data-mes-txt]').forEach(function (el) { el.textContent = C.nombreMes(S.mes); }); }
  function renderMes() {
    var r = C.recuento(S.data, S.mes), d = S.data;
    var pctMio = r.total ? Math.round(r.mio * 100 / r.total) : 0;
    var h = '<div class="cifra"><span class="eyebrow">Total del mes</span><span class="cifra-valor num">' + Q(r.total) + '</span></div>';
    if (r.total) {
      h += '<div style="display:grid;gap:8px"><div class="reparto-barra" aria-hidden="true"><span style="--c:var(--acento);width:' + pctMio + '%"></span><span style="--c:var(--tenue);width:' + (100 - pctMio) + '%"></span></div>' +
        '<div class="leyenda"><span>Tuyo <b class="num">' + Q(r.mio) + '</b></span><span>De otras personas <b class="num">' + Q(r.deOtros) + '</b></span></div></div>';
    }
    // Recuento por persona
    h += '<div><h2 class="titulo-bloque">Recuento</h2><div class="tabla-scroll"><table class="tabla"><thead><tr><th>Persona</th><th>Gastos</th><th>Cuotas</th><th>Total</th></tr></thead><tbody>' +
      r.personas.map(function (p) {
        var per = C.buscar(d.personas, p.id);
        var sub = p.id === 'yo' ? '' : (p.total ? '<span class="debe">te debe ' + Q(p.total) + '</span>' : (per && per.tipo === 'mes' ? '<span class="sub">solo este mes</span>' : ''));
        return '<tr><td>' + esc(p.nombre) + sub + '</td><td class="num">' + Q(p.gastos) + '</td><td class="num">' + Q(p.cuotas) + '</td><td class="num"><b>' + Q(p.total) + '</b></td></tr>';
      }).join('') + '</tbody><tfoot><tr><td>Total</td><td class="num">' + Q(r.personas.reduce(function (a, p) { return a + p.gastos; }, 0)) + '</td><td class="num">' +
      Q(r.personas.reduce(function (a, p) { return a + p.cuotas; }, 0)) + '</td><td class="num">' + Q(r.total) + '</td></tr></tfoot></table></div>' +
      '<p class="cuadre' + (r.cuadra ? '' : ' mal') + '">' + (r.cuadra ? '✓ Personas, tarjetas y categorías suman el total del mes.' : '⚠ Las sumas no cuadran. Revisa los repartos.') + '</p></div>';
    // Por tarjeta o cuenta
    var medios = Object.keys(r.porMedio);
    if (medios.length) {
      h += '<div><h2 class="titulo-bloque">Por tarjeta o cuenta</h2><ul class="lista">' + medios.sort(function (a, b) { return r.porMedio[b] - r.porMedio[a]; }).map(function (id) {
        var m = medioDe(id);
        return '<li class="item">' + muestra(m.color) + '<span class="item-txt"><span class="item-nombre">' + esc(m.nombre) + '</span><span class="item-meta">' + esc(m.banco) + '</span></span><span class="item-monto num">' + Q(r.porMedio[id]) + '</span></li>';
      }).join('') + '</ul></div>';
    }
    // Movimientos
    var movs = r.gastos.map(function (g) { return { f: g.fecha, k: g.creado || '', g: g }; })
      .concat(r.cuotas.map(function (c) { return { f: c.fecha, k: '', c: c }; }))
      .sort(function (a, b) { return a.f === b.f ? b.k.localeCompare(a.k) : b.f.localeCompare(a.f); });
    h += '<div><h2 class="titulo-bloque">Movimientos</h2>';
    if (!movs.length) h += '<p class="vacio">No hay gastos ni cuotas en ' + esc(C.nombreMes(S.mes)) + '.</p>';
    var dia = null, abierto = false;
    movs.forEach(function (x) {
      if (x.f !== dia) { if (abierto) h += '</ul>'; dia = x.f; h += '<div class="dia">' + esc(fechaTxt(dia)) + '</div><ul class="lista">'; abierto = true; }
      if (x.g) h += itemGasto(x.g);
      else {
        var c = x.c, m = medioDe(c.tarjeta);
        h += '<li><button type="button" class="item" data-cuota="' + esc(c.cuotaId) + '">' + muestra(m.color) + '<span class="item-txt"><span class="item-nombre">' + esc(c.nombre) +
          '<span class="insignia">' + c.n + '/' + c.de + '</span></span><span class="item-meta">Cuota · ' + esc(c.categoria) + (c.dueno !== 'yo' ? ' · de ' + esc(personaTxt(c.dueno)) : '') + '</span></span>' +
          '<span class="item-monto num">' + Q(c.monto) + '</span></button></li>';
      }
    });
    if (abierto) h += '</ul>';
    h += '</div>';
    $('#mes-cuerpo').innerHTML = h;
  }

  /* =====================================================================
     PRESUPUESTO
     ===================================================================== */
  function renderPresupuesto() {
    var lista = C.presupuestoMes(S.data, S.mes), r = C.recuento(S.data, S.mes);
    var conLim = lista.filter(function (x) { return x.limite > 0; }).sort(function (a, b) { return (b.gastado / b.limite) - (a.gastado / a.limite); });
    var sinLim = lista.filter(function (x) { return !x.limite; }).sort(function (a, b) { return b.gastado - a.gastado; });
    var lim = conLim.reduce(function (a, x) { return a + x.limite; }, 0), gas = conLim.reduce(function (a, x) { return a + x.gastado; }, 0);
    var h = '<div class="cifra"><span class="eyebrow">Tu gasto del mes</span><span class="cifra-valor num">' + Q(r.mio) + '</span>' +
      '<span class="sub">' + (lim ? 'En categorías con límite llevas ' + Q(gas) + ' de ' + Q(lim) + '.' : 'Toca una categoría para ponerle un límite mensual.') + ' Solo cuenta tu parte.</span></div>';
    var alertas = conLim.filter(function (x) { return x.estado !== 'bien'; });
    if (alertas.length) h += '<div style="display:grid;gap:8px">' + alertas.map(function (x) {
      return x.estado === 'pasado' ? '<div class="alerta pasado">Te pasaste en ' + esc(x.categoria) + ' por ' + Q(x.gastado - x.limite) + '.</div>'
        : '<div class="alerta">' + esc(x.categoria) + ' va en ' + x.pct + '%. Quedan ' + Q(x.limite - x.gastado) + '.</div>';
    }).join('') + '</div>';
    function fila(x) {
      var pct = x.limite ? Math.min(100, Math.round(x.gastado * 100 / x.limite)) : 0;
      var est = { bien: 'Vas bien', cerca: 'Cerca del límite', pasado: 'Pasado', sin: 'Sin límite' }[x.estado];
      return '<button type="button" class="pres" data-estado="' + x.estado + '" data-cat="' + esc(x.categoria) + '">' +
        '<span class="pres-cab"><span class="pres-cat">' + esc(x.categoria) + '</span><span class="pres-num num"><b>' + Q(x.gastado) + '</b>' + (x.limite ? ' de ' + Q(x.limite) : '') + '</span></span>' +
        (x.limite ? '<span class="barra"><span style="width:' + pct + '%"></span></span>' : '') +
        '<span class="pres-estado">' + est + (x.limite ? ' · ' + x.pct + '%' : '') + '</span></button>';
    }
    if (conLim.length) h += '<div><h2 class="titulo-bloque">Con límite</h2>' + conLim.map(fila).join('') + '</div>';
    h += '<div><h2 class="titulo-bloque">Sin límite</h2>' + sinLim.map(fila).join('') + '</div>';
    $('#pres-cuerpo').innerHTML = h;
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
        if (!r.ok) { $('#lim-err', root).textContent = r.error; $('#lim-err', root).hidden = false; return; }
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
    var d = S.data, h = hoy();
    var deudas = d.tarjetas.map(function (t) { return C.deudaTarjeta(d, t.id, h); });
    var saldos = d.cuentas.map(function (c) { return C.saldoCuenta(d, c.id); });
    var html = '<div><div class="cab-bloque"><h2 class="titulo-bloque">Tarjetas</h2><span class="sub num">Debes ' + Q(deudas.reduce(function (a, b) { return a + b; }, 0)) + '</span></div>' +
      d.tarjetas.map(function (t, i) {
        return '<button type="button" class="banco" data-tarjeta="' + esc(t.id) + '">' + muestra(t.color, true) + '<span class="item-txt"><span class="item-nombre">' + esc(t.nombre) + '</span><span class="item-meta">' + esc(t.banco) + '</span></span>' +
          '<span class="banco-valor num">' + Q(deudas[i]) + '<small>deuda</small></span></button>';
      }).join('') + '<div class="fila-btns" style="margin-top:12px"><button type="button" class="btn" id="b-pagar">Pagar tarjeta</button></div></div>';
    html += '<div><div class="cab-bloque"><h2 class="titulo-bloque">Cuentas</h2><span class="sub num">Tienes ' + Q(saldos.reduce(function (a, b) { return a + b; }, 0)) + '</span></div>' +
      d.cuentas.map(function (c, i) {
        return '<button type="button" class="banco" data-cuenta="' + esc(c.id) + '">' + muestra(c.color, true) + '<span class="item-txt"><span class="item-nombre">' + esc(c.nombre) + '</span><span class="item-meta">' + esc(c.banco) + '</span></span>' +
          '<span class="banco-valor num">' + Q(saldos[i]) + '<small>saldo</small></span></button>';
      }).join('') + '<div class="fila-btns" style="margin-top:12px"><button type="button" class="btn" id="b-ingreso">Registrar ingreso</button></div></div>';
    var movs = d.pagos.map(function (p) { return { f: p.fecha, p: p }; }).concat(d.ingresos.map(function (i) { return { f: i.fecha, i: i }; }))
      .sort(function (a, b) { return b.f.localeCompare(a.f); }).slice(0, 12);
    html += '<div><h2 class="titulo-bloque">Pagos e ingresos</h2><ul class="lista">' + (movs.length ? movs.map(function (x) {
      if (x.p) {
        var t = medioDe(x.p.tarjeta), c = medioDe(x.p.cuenta);
        return '<li class="item">' + muestra(t.color) + '<span class="item-txt"><span class="item-nombre">Pago a ' + esc(t.nombre) + '</span><span class="item-meta">Desde ' + esc(c.nombre) + ' · ' + esc(fechaTxt(x.f)) + '</span></span><span class="item-monto num">' + Q(x.p.monto) + '</span></li>';
      }
      var cu = medioDe(x.i.cuenta);
      return '<li class="item">' + muestra(cu.color) + '<span class="item-txt"><span class="item-nombre">' + esc(x.i.descripcion) + '</span><span class="item-meta">' + esc(cu.nombre) + ' · ' + esc(fechaTxt(x.f)) + '</span></span><span class="item-monto num">+' + Q(x.i.monto) + '</span></li>';
    }).join('') : '<li class="vacio">Sin pagos ni ingresos todavía.</li>') + '</ul></div>';
    $('#bancos-cuerpo').innerHTML = html;
  }

  function abrirPago(tid) {
    var d = S.data, h = hoy();
    tid = tid || (d.tarjetas.filter(function (t) { return C.deudaTarjeta(d, t.id, h) > 0; })[0] || d.tarjetas[0] || {}).id;
    var html = '<form class="form" id="f-pago" novalidate>' +
      '<label class="campo"><span>Tarjeta</span><select id="pg-t">' + opcionesSelect(d.tarjetas, tid, function (t) { return t.nombre + ' · debe ' + Q(C.deudaTarjeta(d, t.id, h)); }) + '</select></label>' +
      '<label class="campo"><span>Desde la cuenta</span><select id="pg-c">' + opcionesSelect(d.cuentas, null, function (c) { return c.nombre + ' · ' + Q(C.saldoCuenta(d, c.id)); }) + '</select></label>' +
      '<div class="dos"><label class="campo"><span>Monto</span><input id="pg-m" inputmode="decimal" placeholder="0.00"></label>' +
      '<label class="campo"><span>Fecha</span><input id="pg-f" type="date" value="' + h + '"></label></div>' +
      '<button type="button" class="btn btn-texto" id="pg-todo"></button>' +
      '<p class="nota">El pago baja la deuda de la tarjeta y el saldo de la cuenta por el mismo monto. No cuenta como gasto.</p>' +
      '<p class="error" id="pg-err" hidden></p><button class="btn btn-principal" type="submit">Registrar pago</button></form>';
    abrirHoja('Pagar tarjeta', html, function (root) {
      function todo() { $('#pg-todo', root).textContent = 'Pagar todo: ' + Q(C.deudaTarjeta(d, $('#pg-t', root).value, h)); }
      todo(); $('#pg-t', root).addEventListener('change', todo);
      $('#pg-todo', root).addEventListener('click', function () { $('#pg-m', root).value = C.decimal(C.deudaTarjeta(d, $('#pg-t', root).value, h)); });
      $('#f-pago', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var r = ejecutar({ tipo: 'pagarTarjeta', tarjeta: $('#pg-t', root).value, cuenta: $('#pg-c', root).value, monto: $('#pg-m', root).value, fecha: $('#pg-f', root).value });
        if (!r.ok) { $('#pg-err', root).textContent = r.error; $('#pg-err', root).hidden = false; return; }
        cerrarHoja(); aviso('Pago registrado'); render();
      });
    });
  }
  function abrirIngreso(cid) {
    var d = S.data;
    var html = '<form class="form" id="f-ing" novalidate>' +
      '<label class="campo"><span>Cuenta</span><select id="in-c">' + opcionesSelect(d.cuentas, cid, function (c) { return c.nombre; }) + '</select></label>' +
      '<label class="campo"><span>Descripción</span><input id="in-d" placeholder="Salario, bono 14, venta…"></label>' +
      '<div class="dos"><label class="campo"><span>Monto</span><input id="in-m" inputmode="decimal" placeholder="0.00"></label>' +
      '<label class="campo"><span>Fecha</span><input id="in-f" type="date" value="' + hoy() + '"></label></div>' +
      '<p class="error" id="in-err" hidden></p><button class="btn btn-principal" type="submit">Registrar ingreso</button></form>';
    abrirHoja('Registrar ingreso', html, function (root) {
      $('#f-ing', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var r = ejecutar({ tipo: 'agregarIngreso', cuenta: $('#in-c', root).value, descripcion: $('#in-d', root).value, monto: $('#in-m', root).value, fecha: $('#in-f', root).value });
        if (!r.ok) { $('#in-err', root).textContent = r.error; $('#in-err', root).hidden = false; return; }
        cerrarHoja(); aviso('Ingreso registrado'); render();
      });
    });
  }
  function abrirTarjeta(id) {
    var d = S.data, t = C.buscar(d.tarjetas, id), h = hoy();
    var prox = [];
    d.cuotas.forEach(function (c) { if (c.tarjeta === id) { var e = C.estadoCuota(c, h); if (e.proxima) prox.push(e.proxima); } });
    prox.sort(function (a, b) { return a.fecha.localeCompare(b.fecha); });
    var html = '<div class="cifra"><span class="eyebrow">Deuda actual</span><span class="cifra-valor num">' + Q(C.deudaTarjeta(d, id, h)) + '</span><span class="sub">' + esc(t.banco) + '</span></div>' +
      '<div><span class="eyebrow">Próximas cuotas</span><ul class="lista">' + (prox.length ? prox.map(function (x) {
        return '<li class="item"><span></span><span class="item-txt"><span class="item-nombre">' + esc(x.nombre) + '<span class="insignia">' + x.n + '/' + x.de + '</span></span><span class="item-meta">' + esc(C.fechaCorta(x.fecha)) + '</span></span><span class="item-monto num">' + Q(x.monto) + '</span></li>';
      }).join('') : '<li class="vacio">Sin cuotas pendientes en esta tarjeta.</li>') + '</ul></div>' +
      '<div class="fila-btns"><button type="button" class="btn btn-principal" id="t-pagar">Pagar</button><button type="button" class="btn" id="t-editar">Editar</button></div>';
    abrirHoja(t.nombre, html, function (root) {
      $('#t-pagar', root).addEventListener('click', function () { abrirPago(id); });
      $('#t-editar', root).addEventListener('click', function () { abrirBanco('tarjetas', id); });
    });
  }
  function abrirCuenta(id) {
    var d = S.data, c = C.buscar(d.cuentas, id);
    var html = '<div class="cifra"><span class="eyebrow">Saldo</span><span class="cifra-valor num">' + Q(C.saldoCuenta(d, id)) + '</span><span class="sub">' + esc(c.banco) + '</span></div>' +
      '<div class="fila-btns"><button type="button" class="btn btn-principal" id="c-ing">Registrar ingreso</button><button type="button" class="btn" id="c-editar">Editar</button></div>';
    abrirHoja(c.nombre, html, function (root) {
      $('#c-ing', root).addEventListener('click', function () { abrirIngreso(id); });
      $('#c-editar', root).addEventListener('click', function () { abrirBanco('cuentas', id); });
    });
  }
  function abrirBanco(tabla, id) {
    var x = C.buscar(S.data[tabla], id), esT = tabla === 'tarjetas';
    var html = '<form class="form" id="f-banco" novalidate>' +
      '<label class="campo"><span>Nombre</span><input id="bk-n" value="' + esc(x.nombre) + '"></label>' +
      '<div class="dos"><label class="campo"><span>Banco</span><input id="bk-b" value="' + esc(x.banco) + '"></label>' +
      '<label class="campo"><span>Color del banco</span><input id="bk-c" type="color" value="' + esc(x.color) + '"></label></div>' +
      '<label class="campo"><span>' + (esT ? 'Deuda al empezar a usar la app' : 'Saldo al empezar a usar la app') + '</span><input id="bk-i" inputmode="decimal" value="' + C.decimal(x.inicial || 0) + '"></label>' +
      '<p class="error" id="bk-err" hidden></p><button class="btn btn-principal" type="submit">Guardar</button></form>';
    abrirHoja(esT ? 'Editar tarjeta' : 'Editar cuenta', html, function (root) {
      $('#f-banco', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var r = ejecutar({ tipo: 'editarBanco', tabla: tabla, id: id, nombre: $('#bk-n', root).value, banco: $('#bk-b', root).value, color: $('#bk-c', root).value, inicial: $('#bk-i', root).value });
        if (!r.ok) { $('#bk-err', root).textContent = r.error; $('#bk-err', root).hidden = false; return; }
        cerrarHoja(); aviso('Guardado'); render();
      });
    });
  }

  /* =====================================================================
     MÁS: cuotas, personas, ajustes
     ===================================================================== */
  function renderMas() {
    $$('#mas-seg button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.seg === S.seg); });
    ({ cuotas: renderCuotas, personas: renderPersonas, ajustes: renderAjustes })[S.seg]();
  }
  function renderCuotas() {
    var d = S.data, h = hoy();
    var lista = d.cuotas.map(function (c) { return { c: c, e: C.estadoCuota(c, h) }; })
      .sort(function (a, b) { return a.e.final.localeCompare(b.e.final); });
    var activas = lista.filter(function (x) { return x.e.cargadas < x.c.numCuotas; }), fin = lista.filter(function (x) { return x.e.cargadas >= x.c.numCuotas; });
    function fila(x) {
      var c = x.c, m = medioDe(c.tarjeta);
      return '<li><button type="button" class="item" data-cuota="' + esc(c.id) + '">' + muestra(m.color) +
        '<span class="item-txt"><span class="item-nombre">' + esc(c.nombre) + '<span class="insignia">' + x.e.cargadas + '/' + c.numCuotas + '</span></span>' +
        '<span class="item-meta">' + esc(personaTxt(c.dueno)) + ' · termina ' + esc(C.fechaCorta(x.e.final)) + '</span></span>' +
        '<span class="item-monto num">' + Q(x.e.montoCuota) + '<small>al mes</small></span></button></li>';
    }
    $('#mas-cuerpo').innerHTML = '<button type="button" class="btn btn-principal" id="cu-nueva">Nueva compra en cuotas</button>' +
      '<div><h2 class="titulo-bloque">Activas</h2><ul class="lista">' + (activas.length ? activas.map(fila).join('') : '<li class="vacio">No hay cuotas activas.</li>') + '</ul></div>' +
      (fin.length ? '<div><h2 class="titulo-bloque">Terminadas</h2><ul class="lista">' + fin.map(fila).join('') + '</ul></div>' : '');
  }
  function abrirNuevaCuota() {
    var d = S.data;
    var duenos = [{ id: 'yo', nombre: 'Yo' }].concat(d.personas.filter(function (p) { return p.tipo === 'permanente'; }));
    var html = '<form class="form" id="f-cuota" novalidate>' +
      '<label class="campo"><span>¿Qué compraste?</span><input id="cu-n" placeholder="Ej.: refrigeradora"></label>' +
      '<div class="dos"><label class="campo"><span>Monto total</span><input id="cu-t" inputmode="decimal" placeholder="0.00"></label>' +
      '<label class="campo"><span>Número de cuotas</span><input id="cu-k" inputmode="numeric" placeholder="12"></label></div>' +
      '<label class="campo"><span>Fecha de la primera cuota</span><input id="cu-f" type="date" value="' + hoy() + '"></label>' +
      '<div class="dos"><label class="campo"><span>Dueño</span><select id="cu-d">' + opcionesSelect(duenos, 'yo', function (p) { return p.nombre; }) + '</select></label>' +
      '<label class="campo"><span>Tarjeta</span><select id="cu-tc">' + opcionesSelect(d.tarjetas, C.medio(d, S.medio) && C.medio(d, S.medio).tipo === 'tarjeta' ? S.medio : null, function (t) { return t.nombre; }) + '</select></label></div>' +
      '<p class="nota" id="cu-prev">Solo pueden tener cuotas tú y las personas permanentes.</p>' +
      '<p class="error" id="cu-err" hidden></p><button class="btn btn-principal" type="submit">Guardar cuotas</button></form>';
    abrirHoja('Compra en cuotas', html, function (root) {
      function prev() {
        var t = C.parseMonto($('#cu-t', root).value), k = parseInt($('#cu-k', root).value, 10), f = $('#cu-f', root).value;
        if (!(t > 0 && k >= 1 && k <= 120 && t >= k && C.fechaValida(f))) return;
        var cal = C.calendarioCuota({ id: 'x', nombre: '', fechaInicio: f, total: t, numCuotas: k });
        var ult = cal[cal.length - 1];
        $('#cu-prev', root).textContent = k + (k === 1 ? ' cuota' : ' cuotas') + ' de ' + Q(cal[0].monto) +
          (ult.monto !== cal[0].monto ? ' (la última de ' + Q(ult.monto) + ')' : '') + '. Última cuota: ' + C.fechaCorta(ult.fecha) + '.';
      }
      root.oninput = prev; root.onchange = prev;
      $('#f-cuota', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var r = ejecutar({ tipo: 'agregarCuota', nombre: $('#cu-n', root).value, total: $('#cu-t', root).value, numCuotas: $('#cu-k', root).value,
          fechaInicio: $('#cu-f', root).value, dueno: $('#cu-d', root).value, tarjeta: $('#cu-tc', root).value });
        if (!r.ok) { $('#cu-err', root).textContent = r.error; $('#cu-err', root).hidden = false; return; }
        cerrarHoja(); aviso('Cuotas guardadas'); render();
      });
    });
  }
  function abrirCuota(id) {
    var c = C.buscar(S.data.cuotas, id); if (!c) return;
    var e = C.estadoCuota(c, hoy()), m = medioDe(c.tarjeta);
    var html = '<div class="cifra"><span class="eyebrow">' + esc(personaTxt(c.dueno)) + ' · ' + esc(c.categoria) + '</span><span class="cifra-valor num">' + Q(c.total) + '</span>' +
      '<span class="etiquetas"><span class="etiqueta">' + muestra(m.color) + esc(m.nombre) + '</span><span class="etiqueta">' + e.cargadas + ' de ' + c.numCuotas + ' cargadas</span></span></div>' +
      '<ul class="lista">' + e.calendario.map(function (x) {
        return '<li class="item"><span class="insignia" style="margin:0">' + x.n + '/' + x.de + '</span><span class="item-txt"><span class="item-nombre">' + esc(C.fechaCorta(x.fecha)) + '</span>' +
          '<span class="item-meta">' + (x.fecha <= hoy() ? 'Cargada a la tarjeta' : 'Pendiente') + '</span></span><span class="item-monto num">' + Q(x.monto) + '</span></li>';
      }).join('') + '</ul><button type="button" class="btn btn-peligro" id="cu-borrar">Borrar esta compra en cuotas</button>';
    abrirHoja(c.nombre, html, function (root) {
      dobleToque($('#cu-borrar', root), 'Toca otra vez para borrar', function () { ejecutar({ tipo: 'borrarCuota', id: id }); cerrarHoja(); aviso('Cuotas borradas'); render(); });
    });
  }
  function renderPersonas() {
    var d = S.data, ym = C.mesDe(hoy());
    $('#mas-cuerpo').innerHTML = '<form class="form" id="f-persona" novalidate><label class="campo"><span>Nombre</span><input id="pe-n" placeholder="Ej.: Ana"></label>' +
      '<div class="dos"><label class="campo"><span>Duración</span><select id="pe-t"><option value="permanente">Permanente</option><option value="mes">Solo un mes</option></select></label>' +
      '<label class="campo"><span>Mes</span><input id="pe-m" type="month" value="' + ym + '" disabled></label></div>' +
      '<p class="error" id="pe-err" hidden></p><button class="btn btn-principal" type="submit">Agregar persona</button></form>' +
      '<div><h2 class="titulo-bloque">Personas</h2><ul class="lista">' + (d.personas.length ? d.personas.map(function (p) {
        var r = C.recuento(d, p.tipo === 'mes' ? p.mes : S.mes).personas.filter(function (x) { return x.id === p.id; })[0];
        return '<li><button type="button" class="item" data-persona="' + esc(p.id) + '"><span></span><span class="item-txt"><span class="item-nombre">' + esc(p.nombre) + '</span>' +
          '<span class="item-meta">' + (p.tipo === 'mes' ? 'Solo ' + esc(C.nombreMes(p.mes)) : 'Permanente') + '</span></span>' +
          '<span class="item-monto num">' + Q(r ? r.total : 0) + '<small>' + esc(C.nombreMes(p.tipo === 'mes' ? p.mes : S.mes)) + '</small></span></button></li>';
      }).join('') : '<li class="vacio">Agrega a las personas con quienes compartes gastos.</li>') + '</ul></div>';
    $('#pe-t').addEventListener('change', function () { $('#pe-m').disabled = this.value !== 'mes'; });
    $('#f-persona').addEventListener('submit', function (e) {
      e.preventDefault();
      var r = ejecutar({ tipo: 'agregarPersona', nombre: $('#pe-n').value, clase: $('#pe-t').value, mes: $('#pe-m').value });
      if (!r.ok) { $('#pe-err').textContent = r.error; $('#pe-err').hidden = false; return; }
      aviso('Persona agregada'); renderMas();
    });
  }
  function abrirPersona(id) {
    var d = S.data, p = C.buscar(d.personas, id); if (!p) return;
    var ym = p.tipo === 'mes' ? p.mes : S.mes, r = C.recuento(d, ym);
    var x = r.personas.filter(function (y) { return y.id === id; })[0] || { gastos: 0, cuotas: 0, total: 0 };
    var gastos = r.gastos.filter(function (g) { return g.partes.some(function (q) { return q.p === id; }); });
    var cuotas = r.cuotas.filter(function (c) { return c.dueno === id; });
    var html = '<div class="cifra"><span class="eyebrow">' + esc(C.nombreMes(ym)) + ' · te debe</span><span class="cifra-valor num">' + Q(x.total) + '</span>' +
      '<span class="sub">Gastos ' + Q(x.gastos) + ' · Cuotas ' + Q(x.cuotas) + '</span></div><ul class="lista">' +
      gastos.map(function (g) { var q = g.partes.filter(function (y) { return y.p === id; })[0]; return '<li class="item"><span></span><span class="item-txt"><span class="item-nombre">' + esc(g.nombre) + '</span><span class="item-meta">' + esc(fechaTxt(g.fecha)) + '</span></span><span class="item-monto num">' + Q(q.m) + '</span></li>'; }).join('') +
      cuotas.map(function (c) { return '<li class="item"><span></span><span class="item-txt"><span class="item-nombre">' + esc(c.nombre) + '<span class="insignia">' + c.n + '/' + c.de + '</span></span><span class="item-meta">Cuota · ' + esc(C.fechaCorta(c.fecha)) + '</span></span><span class="item-monto num">' + Q(c.monto) + '</span></li>'; }).join('') +
      '</ul><button type="button" class="btn btn-peligro" id="pe-borrar">Borrar persona</button>';
    abrirHoja(p.nombre, html, function (root) {
      dobleToque($('#pe-borrar', root), 'Toca otra vez para borrar', function () {
        var res = ejecutar({ tipo: 'borrarPersona', id: id });
        if (!res.ok) return aviso(res.error);
        cerrarHoja(); aviso('Persona borrada'); render();
      });
    });
  }
  function renderAjustes() {
    var d = S.data, ej = 0;
    C.NOMBRES_TABLAS.forEach(function (t) { (d[t] || []).forEach(function (r) { if (r.ejemplo) ej++; }); });
    var aprendidas = d.reglas.filter(function (r) { return r.origen === 'usuario'; });
    var h = '<div><h2 class="titulo-bloque">Conexión</h2>' + (esLocal()
      ? '<p class="nota">Estás en modo de prueba: los datos viven solo en este teléfono y no se guardan en Google Sheets.</p>'
      : '<p class="nota">Conectado a tu hoja de Google Sheets. Estos datos también los usa el atajo del iPhone.</p>' +
        '<div class="form" style="margin-top:10px"><div class="copiable"><code>' + esc(S.cfg.url) + '</code><button type="button" class="btn btn-chico" data-copiar="url">Copiar</button></div>' +
        '<div class="copiable"><code>' + esc(S.cfg.clave) + '</code><button type="button" class="btn btn-chico" data-copiar="clave">Copiar</button></div></div>') +
      '<div class="fila-btns" style="margin-top:10px"><button type="button" class="btn" id="aj-conexion">Cambiar conexión</button>' +
      (esLocal() ? '' : '<button type="button" class="btn" id="aj-sync">Actualizar ahora</button>') + '</div></div>';
    h += '<div><h2 class="titulo-bloque">Tarjetas y cuentas</h2><ul class="lista">' +
      d.tarjetas.map(function (t) { return '<li><button type="button" class="item" data-editar="tarjetas" data-id="' + esc(t.id) + '">' + muestra(t.color) + '<span class="item-txt"><span class="item-nombre">' + esc(t.nombre) + '</span><span class="item-meta">Tarjeta · ' + esc(t.banco) + '</span></span><span class="sub">Editar</span></button></li>'; }).join('') +
      d.cuentas.map(function (c) { return '<li><button type="button" class="item" data-editar="cuentas" data-id="' + esc(c.id) + '">' + muestra(c.color) + '<span class="item-txt"><span class="item-nombre">' + esc(c.nombre) + '</span><span class="item-meta">Cuenta · ' + esc(c.banco) + '</span></span><span class="sub">Editar</span></button></li>'; }).join('') + '</ul></div>';
    h += '<div><h2 class="titulo-bloque">Palabras aprendidas</h2>' + (aprendidas.length ? '<ul class="lista">' + aprendidas.map(function (r) {
      return '<li class="item"><span></span><span class="item-txt"><span class="item-nombre">' + esc(r.palabra) + '</span><span class="item-meta">' + esc(r.tipo) + '</span></span><span class="sub">' + esc(r.categoria) + '</span></li>';
    }).join('') + '</ul>' : '<p class="nota">Cuando cambies la categoría de un gasto, la app recordará la regla y aparecerá aquí.</p>') + '</div>';
    h += '<div><h2 class="titulo-bloque">Datos de ejemplo</h2><p class="nota">' + (ej ? 'Hay ' + ej + ' registros de ejemplo (personas, gastos, cuotas, pagos, ingresos y límites).' : 'No quedan datos de ejemplo.') + '</p>' +
      (ej ? '<div class="fila-btns" style="margin-top:10px"><button type="button" class="btn btn-peligro" id="aj-borrar">Borrar datos de ejemplo</button></div>' : '') + '</div>';
    $('#mas-cuerpo').innerHTML = h;
    $('#aj-conexion').addEventListener('click', function () { mostrarBienvenida(); });
    var s = $('#aj-sync'); if (s) s.addEventListener('click', function () { cargar(); });
    var b = $('#aj-borrar');
    if (b) dobleToque(b, 'Toca otra vez para borrar', function () { var r = ejecutar({ tipo: 'borrarEjemplos' }); aviso('Se borraron ' + r.info.borrados + ' registros de ejemplo'); render(); });
  }

  /* =====================================================================
     Navegación y eventos
     ===================================================================== */
  function render() {
    if (!S.data) return;
    renderMesNav();
    ({ anotar: renderAnotar, mes: renderMes, presupuesto: renderPresupuesto, bancos: renderBancos, mas: renderMas })[S.tab]();
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
  $$('[data-mes]').forEach(function (b) { b.addEventListener('click', function () { S.mes = C.sumarMeses(S.mes, +b.dataset.mes); render(); }); });
  $$('#mas-seg button').forEach(function (b) { b.addEventListener('click', function () { S.seg = b.dataset.seg; renderMas(); }); });

  $('#f-gasto').addEventListener('submit', registrar);
  $('#g-nombre').addEventListener('input', pista);
  $('#g-monto').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#g-nombre').focus(); } });
  $('#g-medios').addEventListener('click', function (e) {
    var b = e.target.closest('[data-medio]'); if (!b) return;
    S.medio = b.dataset.medio;
    $$('#g-medios .chip').forEach(function (x) { x.setAttribute('aria-checked', x === b); });
  });
  $('#g-fecha').addEventListener('change', function () {
    S.fecha = this.value && this.value !== hoy() ? this.value : null;
    $('#g-fecha-txt').textContent = fechaTxt(S.fecha || hoy());
  });
  $('#g-para').addEventListener('click', abrirReparto);

  // Clics en listas (delegados)
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-gasto],[data-cuota],[data-cat],[data-tarjeta],[data-cuenta],[data-persona],[data-editar],[data-copiar],#b-pagar,#b-ingreso,#cu-nueva');
    if (!t || t.closest('#hoja')) return;
    if (t.dataset.gasto) abrirGasto(t.dataset.gasto);
    else if (t.dataset.cuota) abrirCuota(t.dataset.cuota);
    else if (t.dataset.cat && t.classList.contains('pres')) abrirLimite(t.dataset.cat);
    else if (t.dataset.tarjeta) abrirTarjeta(t.dataset.tarjeta);
    else if (t.dataset.cuenta) abrirCuenta(t.dataset.cuenta);
    else if (t.dataset.persona) abrirPersona(t.dataset.persona);
    else if (t.dataset.editar) abrirBanco(t.dataset.editar, t.dataset.id);
    else if (t.dataset.copiar) {
      var v = S.cfg[t.dataset.copiar];
      Promise.resolve().then(function () { return navigator.clipboard.writeText(v); }).then(function () { aviso('Copiado'); }, function () { aviso(v); });
    }
    else if (t.id === 'b-pagar') abrirPago();
    else if (t.id === 'b-ingreso') abrirIngreso();
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
      LS.set('cfg', S.cfg); S.data = r.data; guardarCache();
      $('#bienvenida').hidden = true; irA('anotar');
    }).catch(function () {
      S.cfg = previo; btn.disabled = false; btn.textContent = 'Conectar';
      e.textContent = 'No pude conectarme. Revisa la dirección y que el script esté publicado para "Cualquier persona".'; e.hidden = false;
    });
  });
  $('#cx-local').addEventListener('click', function () {
    S.cfg = { modo: 'local' }; LS.set('cfg', S.cfg);
    S.data = LS.get('local', null) || datosLocalesNuevos();
    $('#bienvenida').hidden = true; irA('anotar');
  });

  /* ---------- Arranque ---------- */
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && S.cfg && !esLocal()) cargar(true); });
  window.addEventListener('online', function () { vaciarCola(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});

  if (!S.cfg) { mostrarBienvenida(); }
  else if (esLocal()) { S.data = LS.get('local', null) || datosLocalesNuevos(); irA('anotar'); }
  else { S.data = LS.get('cache', null); if (S.data) irA('anotar'); cargar(!!S.data).then(function () { if (S.tab) irA(S.tab); }); }
})();

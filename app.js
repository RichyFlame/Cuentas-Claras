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
    medio: null, fecha: null, filtroCuotas: 'todas', reparto: repartoInicial(), outbox: LS.get('outbox', []), sync: 'ok', cargando: false
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
  // Primero intenta con fetch (POST). Algunos navegadores (por ejemplo Safari en Mac con ciertas
  // opciones de privacidad o bloqueadores) cortan esa respuesta; entonces usa JSONP (GET con <script>),
  // que no depende de CORS. Si JSONP funciona, lo recuerda para las próximas veces.
  function api(body) {
    var payload = JSON.stringify(Object.assign({ clave: S.cfg.clave }, body));
    if (S.cfg.via === 'jsonp') return jsonp(payload);
    return fetch(S.cfg.url, { method: 'POST', body: payload, redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function (e) {
        return jsonp(payload).then(function (res) {
          S.cfg.via = 'jsonp'; if (S.cfg.modo === 'remoto' && LS.get('cfg', null)) LS.set('cfg', S.cfg);
          return res;
        }, function () { throw e; });
      });
  }
  function jsonp(payload) {
    return new Promise(function (ok, mal) {
      var cb = 'ccRespuesta' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      var s = document.createElement('script'), listo = false;
      var t = setTimeout(function () { fin(new Error('tiempo agotado')); }, 25000);
      function fin(err, val) {
        if (listo) return; listo = true; clearTimeout(t);
        try { delete window[cb]; } catch (x) { window[cb] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
        if (err) mal(err); else ok(val);
      }
      window[cb] = function (v) { fin(null, v); };
      s.onerror = function () { fin(new Error('no cargó')); };
      s.src = S.cfg.url + (S.cfg.url.indexOf('?') < 0 ? '?' : '&') + 'callback=' + cb + '&q=' + encodeURIComponent(payload);
      document.head.appendChild(s);
    });
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

  /* ---------- Fechas en formato dd/mm/aaaa y calendario propio ---------- */
  function isoADmy(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : (iso || ''); }
  function dmyAIso(t) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(t || '').trim()); if (!m) return null;
    var iso = m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    return C.fechaValida(iso) ? iso : null;
  }
  // Devuelve AAAA-MM-DD; '' si está vacío (se usa hoy); 'invalida' si no se entiende (la validación avisa).
  function leerFecha(el) { var v = (el.value || '').trim(); if (!v) return ''; return dmyAIso(v) || 'invalida'; }
  var ICONO_CAL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>';
  function campoFecha(id, valor, etiqueta) {
    return '<label class="campo"><span>' + esc(etiqueta || 'Fecha') + '</span><span class="fecha-campo">' +
      '<input id="' + id + '" class="fecha-txt" inputmode="numeric" autocomplete="off" placeholder="dd/mm/aaaa" maxlength="10" value="' + esc(isoADmy(valor)) + '">' +
      '<button type="button" class="fecha-btn" data-calendario="' + id + '" aria-label="Elegir en el calendario">' + ICONO_CAL + '</button></span></label>';
  }
  // Al escribir, pone las diagonales solas: 01102026 → 01/10/2026.
  document.addEventListener('input', function (e) {
    var el = e.target; if (!el.classList || !el.classList.contains('fecha-txt')) return;
    var d = el.value.replace(/\D/g, '').slice(0, 8);
    el.value = d.length > 4 ? d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4) : (d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d);
  }, true);

  var MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var cal = { el: null, velo: null, ver: null, sel: null, modo: 'dias', alElegir: null };
  function abrirCalendario(iso, alElegir) {
    if (!cal.el) {
      cal.velo = document.createElement('div'); cal.velo.className = 'cal-velo'; cal.velo.hidden = true;
      cal.el = document.createElement('div'); cal.el.className = 'cal'; cal.el.hidden = true;
      cal.el.setAttribute('role', 'dialog'); cal.el.setAttribute('aria-label', 'Calendario');
      document.body.appendChild(cal.velo); document.body.appendChild(cal.el);
      cal.velo.addEventListener('click', cerrarCalendario);
      cal.el.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.calMes) { cal.ver = C.sumarMeses(cal.ver, cal.modo === 'meses' ? 12 * +b.dataset.calMes : +b.dataset.calMes); pintarCalendario(); }
        else if (b.dataset.calModo !== undefined) { cal.modo = cal.modo === 'dias' ? 'meses' : 'dias'; pintarCalendario(); }
        else if (b.dataset.calElegirMes) { cal.ver = b.dataset.calElegirMes; cal.modo = 'dias'; pintarCalendario(); }
        else if (b.dataset.dia) elegir(b.dataset.dia);
        else if (b.dataset.calRapido) elegir(b.dataset.calRapido === 'hoy' ? hoy() : C.sumarDias(hoy(), -1));
        else if (b.dataset.calCerrar !== undefined) cerrarCalendario();
      });
    }
    cal.sel = C.fechaValida(iso) ? iso : hoy(); cal.ver = C.mesDe(cal.sel); cal.modo = 'dias'; cal.alElegir = alElegir;
    pintarCalendario();
    cal.velo.hidden = false; cal.el.hidden = false;
  }
  function elegir(iso) { var f = cal.alElegir; cerrarCalendario(); if (f) f(iso); }
  function cerrarCalendario() { if (cal.el) { cal.el.hidden = true; cal.velo.hidden = true; } }
  function pintarCalendario() {
    var ym = cal.ver, y = +ym.slice(0, 4), m = +ym.slice(5, 7), h = hoy(), cuerpo;
    var titulo = cal.modo === 'dias' ? C.nombreMes(ym) : String(y);
    if (cal.modo === 'dias') {
      var primero = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = domingo
      var vacios = (primero + 6) % 7, dias = C.diasDelMes(y, m), celdas = '';
      for (var i = 0; i < vacios; i++) celdas += '<span></span>';
      for (var dd = 1; dd <= dias; dd++) {
        var iso = ym + '-' + pad(dd);
        celdas += '<button type="button" class="cal-dia' + (iso === h ? ' hoy' : '') + (iso === cal.sel ? ' sel' : '') + '" data-dia="' + iso + '" aria-label="' + C.fechaCorta(iso) + '"' + (iso === cal.sel ? ' aria-pressed="true"' : '') + '>' + dd + '</button>';
      }
      cuerpo = '<div class="cal-semana"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div><div class="cal-grid">' + celdas + '</div>';
    } else {
      cuerpo = '<div class="cal-meses">' + MESES_CORTOS.map(function (n, i) {
        var v = y + '-' + pad(i + 1);
        return '<button type="button" class="cal-mes' + (v === C.mesDe(cal.sel) ? ' sel' : '') + (v === C.mesDe(h) ? ' hoy' : '') + '" data-cal-elegir-mes="' + v + '">' + n + '</button>';
      }).join('') + '</div>';
    }
    cal.el.innerHTML = '<div class="cal-cab"><button type="button" class="cal-nav" data-cal-mes="-1" aria-label="Anterior">‹</button>' +
      '<button type="button" class="cal-titulo" data-cal-modo aria-label="Cambiar mes o año">' + titulo + '</button>' +
      '<button type="button" class="cal-nav" data-cal-mes="1" aria-label="Siguiente">›</button></div>' + cuerpo +
      '<div class="cal-pie"><button type="button" class="btn btn-chico" data-cal-rapido="hoy">Hoy</button><button type="button" class="btn btn-chico" data-cal-rapido="ayer">Ayer</button>' +
      '<button type="button" class="btn btn-chico btn-texto" data-cal-cerrar>Cancelar</button></div>';
  }
  // Botón de calendario junto a cada campo de fecha.
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-calendario]'); if (!b) return;
    e.preventDefault();
    var input = document.getElementById(b.dataset.calendario);
    abrirCalendario(dmyAIso(input.value), function (iso) {
      input.value = isoADmy(iso);
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

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
      '<div class="fila-btns"><button type="button" class="btn btn-chico" data-gasto="' + esc(g.id) + '">Editar gasto</button></div></div>';
  }

  /* ----- Hoja: editar / borrar un gasto ----- */
  // Editar todo un gasto: monto, descripción, fecha, tarjeta o cuenta, para quién es, categoría y tipo.
  function abrirGasto(id) {
    var g = C.buscar(S.data.gastos, id); if (!g) return;
    var d = S.data, enGasto = g.partes.map(function (x) { return x.p; });
    var est = { monto: C.decimal(g.monto), nombre: g.nombre, fecha: isoADmy(g.fecha), medio: g.medio, cat: g.categoria, tipo: g.tipo, reparto: repartoDesdePartes(g.partes, g.monto) };
    var titulo = 'Editar gasto';
    function listaMedios() {
      var t = d.tarjetas.filter(function (x) { return C.activo(x) || x.id === g.medio; }), c = d.cuentas.filter(function (x) { return C.activo(x) || x.id === g.medio; });
      return (t.length ? '<optgroup label="Tarjetas">' + opciones(t, est.medio, function (x) { return x.nombre; }) + '</optgroup>' : '') +
        (c.length ? '<optgroup label="Cuentas">' + opciones(c, est.medio, function (x) { return x.nombre; }) + '</optgroup>' : '');
    }
    function html() {
      return '<form class="form" id="f-eg" novalidate>' +
        '<div class="dos"><label class="campo"><span>Monto</span><input id="eg-m" inputmode="decimal" value="' + esc(est.monto) + '"></label>' +
        campoFecha('eg-f', est.fecha) + '</div>' +
        '<label class="campo"><span>¿En qué fue?</span><input id="eg-n" value="' + esc(est.nombre) + '"></label>' +
        '<label class="campo"><span>Tarjeta o cuenta</span><select id="eg-medio">' + listaMedios() + '</select></label>' +
        '<button type="button" class="opcion" id="eg-para"><span class="opcion-lbl">Para</span><span>' + esc(textoPara(est.reparto)) + '</span></button>' +
        '<div><span class="eyebrow">Categoría</span><div class="cats" id="eg-cats">' +
        C.CATEGORIAS.map(function (c) { return '<button type="button" class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (c === est.cat) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>' +
        '<div><span class="eyebrow">Tipo</span><div class="segmentos" id="eg-tipo">' +
        C.TIPOS.map(function (t) { return '<button type="button" data-tipo="' + t + '" aria-pressed="' + (t === est.tipo) + '">' + t + '</button>'; }).join('') + '</div></div>' +
        '<p class="nota">Si cambias la categoría, la próxima vez que escribas lo mismo se clasificará igual.' + (g.origen === 'atajo' ? ' Este gasto llegó desde el atajo.' : '') + '</p>' +
        '<p class="error" id="eg-err" hidden></p>' +
        '<button type="submit" class="btn btn-principal" id="eg-guardar">Guardar cambios</button>' +
        '<button type="button" class="btn btn-peligro" id="eg-borrar">Borrar gasto</button></form>';
    }
    function leer(root) {
      est.monto = $('#eg-m', root).value; est.fecha = $('#eg-f', root).value; est.nombre = $('#eg-n', root).value; est.medio = $('#eg-medio', root).value;
    }
    function montar(root) {
      function marcar() {
        $$('#eg-cats .chip', root).forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.cat === est.cat); });
        $$('#eg-tipo button', root).forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.tipo === est.tipo); });
      }
      root.onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.cat) { est.cat = b.dataset.cat; est.tipo = C.TIPO_POR_CATEGORIA[est.cat]; marcar(); }
        if (b.dataset.tipo) { est.tipo = b.dataset.tipo; marcar(); }
        if (b.id === 'eg-para') {
          leer(root);
          abrirReparto({ estado: est.reparto, total: function () { return C.parseMonto(est.monto); },
            personas: function () {
              var lista = C.personasDelMes(d, C.mesContable(d, est.medio, dmyAIso(est.fecha) || g.fecha));
              return lista.concat(d.personas.filter(function (p) { return enGasto.indexOf(p.id) >= 0 && lista.indexOf(p) < 0; }));
            },
            alCerrar: function () { setTimeout(function () { abrirHoja(titulo, html(), montar); }, 0); } });
        }
      };
      $('#f-eg', root).addEventListener('submit', function (e) {
        e.preventDefault(); leer(root);
        var total = C.parseMonto(est.monto), partes;
        if (total !== null && total > 0) { var pr = partesDe(est.reparto, total); if (pr.error) return errorEn(root, '#eg-err', pr.error); partes = pr.partes; }
        var r = ejecutar({ tipo: 'editarGasto', id: g.id, nombre: est.nombre, monto: est.monto, fecha: leerFecha($('#eg-f', root)), medio: est.medio, categoria: est.cat, tipoGasto: est.tipo, partes: partes });
        if (!r.ok) return errorEn(root, '#eg-err', r.error);
        cerrarHoja(); aviso('Gasto actualizado');
        if ($('#g-resultado [data-gasto="' + g.id + '"]')) mostrarResultado(C.buscar(S.data.gastos, g.id));
        render();
      });
      dobleToque($('#eg-borrar', root), 'Toca otra vez para borrar', function () {
        ejecutar({ tipo: 'borrarGasto', id: g.id }); cerrarHoja(); aviso('Gasto borrado');
        if ($('#g-resultado [data-gasto="' + g.id + '"]')) $('#g-resultado').innerHTML = '';
        render();
      });
    }
    abrirHoja(titulo, html(), montar);
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
      clicsLista(root);
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
  // Un renglón de pago, ingreso, retiro o transferencia. Al tocarlo se edita.
  // `cuentaRef`: si se ve desde una cuenta, el signo dice si el dinero entró (+) o salió (−).
  function itemMov(tabla, x, cuentaRef) {
    var abre = '<li><button type="button" class="item" data-mov="' + tabla + ':' + esc(x.id) + '">', nombre, meta, signo = '', color;
    if (tabla === 'pagos') {
      var t = medioDe(x.tarjeta), c = medioDe(x.cuenta); color = t.color;
      nombre = 'Pago a ' + t.nombre; meta = 'Desde ' + c.nombre; signo = '−';
    } else if (tabla === 'transferencias') {
      var o = medioDe(x.origen), de = medioDe(x.destino); color = (cuentaRef === x.destino ? de : o).color;
      nombre = x.descripcion || 'Transferencia'; meta = o.nombre + ' → ' + de.nombre;
      signo = cuentaRef === x.origen ? '−' : (cuentaRef === x.destino ? '+' : '');
    } else {
      var cu = medioDe(x.cuenta); color = cu.color;
      nombre = x.descripcion; meta = (tabla === 'retiros' ? 'Retiro · ' : 'Ingreso · ') + cu.nombre; signo = tabla === 'ingresos' ? '+' : '−';
    }
    return abre + muestra(color) + '<span class="item-txt"><span class="item-nombre">' + esc(nombre) + '</span><span class="item-meta">' + esc(meta) + ' · ' + esc(fechaTxt(x.fecha)) + '</span></span>' +
      '<span class="item-monto num">' + signo + Q(x.monto) + '</span></button></li>';
  }
  function movimientosBanco(filtro) {
    var d = S.data, out = [];
    ['pagos', 'ingresos', 'retiros', 'transferencias'].forEach(function (t) {
      (d[t] || []).forEach(function (x) { if (!filtro || filtro(t, x)) out.push({ t: t, x: x, f: x.fecha }); });
    });
    return out.sort(function (a, b) { return b.f.localeCompare(a.f); });
  }
  function abrirMov(tabla, id) {
    if (tabla === 'pagos') abrirPago(null, id);
    else if (tabla === 'ingresos') abrirMovCuenta('ingreso', null, id);
    else if (tabla === 'retiros') abrirMovCuenta('retiro', null, id);
    else if (tabla === 'transferencias') abrirTransferencia(null, id);
  }
  // Clics dentro de una hoja que muestra listas (gastos, cuotas y movimientos se pueden abrir para editar).
  function clicsLista(root) {
    root.onclick = function (e) {
      var b = e.target.closest('[data-gasto],[data-cuota],[data-mov]'); if (!b) return;
      if (b.dataset.gasto) abrirGasto(b.dataset.gasto);
      else if (b.dataset.cuota) abrirCuota(b.dataset.cuota);
      else { var p = b.dataset.mov.split(':'); abrirMov(p[0], p.slice(1).join(':')); }
    };
  }
  function renderBancos() {
    var d = S.data, h = hoy(), tarjetas = activos(d.tarjetas), cuentas = activos(d.cuentas);
    var recs = C.recordatorios(d, h);
    var html = recs.length ? '<div class="avisos">' + recs.map(function (r) {
      return '<button type="button" class="alerta' + (r.dias <= 1 ? ' pasado' : '') + '" data-pagar="' + esc(r.tarjeta) + '">' + esc(C.textoRecordatorio(r)) + '</button>';
    }).join('') + '</div>' : '';
    var deudas = tarjetas.map(function (t) { return C.estadoTarjeta(d, t.id, h); });
    html += '<div><div class="cab-bloque"><h2 class="titulo-bloque">Tarjetas</h2><span class="sub num">Por pagar ' + Q(deudas.reduce(function (a, e) { return a + e.porPagar; }, 0)) + '</span></div>' +
      '<p class="nota">Solo lo de este mes: compras del ciclo y la cuota de este mes de cada compra en cuotas. Lo que falta de las cuotas está en Cuotas.</p>' +
      (tarjetas.length ? tarjetas.map(function (t, i) {
        var e = deudas[i], c = e.ciclo;
        var meta = (c.ciclo.pago ? 'Pagas el ' + C.diaMes(c.ciclo.pago) : 'Falta día de corte') + ' · compras ' + Q(c.compras) + ' · cuotas ' + Q(c.cuotas) +
          (c.pagado ? ' · pagado ' + Q(c.pagado) : '') + (e.anteriores ? ' · atrasado ' + Q(e.anteriores) : '');
        var valor = e.porPagar > 0 ? Q(e.porPagar) + '<small>por pagar</small>' : (e.aFavor > 0 ? Q(e.aFavor) + '<small>a tu favor</small>' : Q(0) + '<small>' + (c.total ? 'pagado' : 'por pagar') + '</small>');
        return '<button type="button" class="banco" data-tarjeta="' + esc(t.id) + '">' + muestra(t.color, true) + '<span class="item-txt"><span class="item-nombre">' + esc(t.nombre) + '</span>' +
          '<span class="item-meta envuelve">' + esc(meta) + '</span></span><span class="banco-valor num">' + valor + '</span></button>';
      }).join('') : '<p class="vacio">Todavía no tienes tarjetas. Agrega la primera.</p>') +
      '<div class="fila-btns"><button type="button" class="btn" id="b-pagar"' + (tarjetas.length ? '' : ' disabled') + '>Pagar tarjeta</button><button type="button" class="btn" id="b-nueva-t">Agregar tarjeta</button></div></div>';
    var saldos = cuentas.map(function (c) { return C.saldoCuenta(d, c.id); });
    html += '<div><div class="cab-bloque"><h2 class="titulo-bloque">Cuentas</h2><span class="sub num">Tienes ' + Q(saldos.reduce(function (a, b) { return a + b; }, 0)) + '</span></div>' +
      (cuentas.length ? cuentas.map(function (c, i) {
        return '<button type="button" class="banco" data-cuenta="' + esc(c.id) + '">' + muestra(c.color, true) + '<span class="item-txt"><span class="item-nombre">' + esc(c.nombre) + '</span><span class="item-meta">' + esc(c.banco) + '</span></span>' +
          '<span class="banco-valor num' + (saldos[i] < 0 ? ' negativo' : '') + '">' + Q(saldos[i]) + '<small>saldo</small></span></button>';
      }).join('') : '<p class="vacio">Todavía no tienes cuentas. Agrega la primera.</p>') +
      '<div class="fila-btns"><button type="button" class="btn" id="b-ingreso"' + (cuentas.length ? '' : ' disabled') + '>Ingreso</button><button type="button" class="btn" id="b-retiro"' + (cuentas.length ? '' : ' disabled') + '>Retiro</button></div>' +
      '<div class="fila-btns"><button type="button" class="btn" id="b-transferir"' + (cuentas.length > 1 ? '' : ' disabled') + '>Transferencia</button><button type="button" class="btn" id="b-nueva-c">Agregar cuenta</button></div></div>';
    var movs = movimientosBanco().slice(0, 20);
    html += '<div><h2 class="titulo-bloque">Pagos, ingresos, retiros y transferencias</h2><p class="nota">Toca uno para editarlo o borrarlo.</p><ul class="lista">' +
      (movs.length ? movs.map(function (m) { return itemMov(m.t, m.x); }).join('') : '<li class="vacio">Sin movimientos todavía.</li>') + '</ul></div>';
    $('#bancos-cuerpo').innerHTML = html;
  }

  function infoContado(e) {
    var c = e.ciclo, cic = c.ciclo;
    var t = (cic.pago ? 'Ciclo del ' + C.diaMes(cic.desde) + ' al ' + C.diaMes(cic.hasta) + ', pagas el ' + C.diaMes(cic.pago) : 'Mes calendario (la tarjeta no tiene día de corte)') +
      ': compras ' + Q(c.compras) + ' + cuotas del mes ' + Q(c.cuotas) + ' = ' + Q(c.total) + '.';
    if (c.pagado) t += ' Ya pagaste ' + Q(c.pagado) + '.';
    if (e.anteriores) t += ' De ciclos anteriores quedan ' + Q(e.anteriores) + '.';
    t += e.porPagar > 0 ? ' Pago de contado: ' + Q(e.porPagar) + '.' : ' No tienes nada pendiente este mes.';
    return t;
  }
  function abrirPago(tid, editId) {
    var d = S.data, h = hoy(), pg = editId ? C.buscar(d.pagos, editId) : null;
    if (pg) tid = pg.tarjeta;
    var tarjetas = d.tarjetas.filter(function (t) { return C.activo(t) || C.deudaTarjeta(d, t.id, h) > 0 || t.id === tid; });
    if (!tid) { var rec = C.recordatorios(d, h)[0]; tid = rec ? rec.tarjeta : ((tarjetas.filter(function (t) { return C.estadoTarjeta(d, t.id, h).porPagar > 0; })[0] || tarjetas[0] || {}).id); }
    var cuentas = d.cuentas.filter(function (c) { return C.activo(c) || (pg && c.id === pg.cuenta); });
    var html = '<form class="form" id="f-pago" novalidate>' +
      '<label class="campo"><span>Tarjeta</span><select id="pg-t">' + opciones(tarjetas, tid, function (t) { return t.nombre; }) + '</select></label>' +
      '<p class="alerta suave" id="pg-info"></p>' +
      '<label class="campo"><span>Desde la cuenta</span><select id="pg-c">' + opciones(cuentas, pg ? pg.cuenta : null, function (c) { return c.nombre + ' · ' + Q(C.saldoCuenta(d, c.id)); }) + '</select></label>' +
      '<div class="dos"><label class="campo"><span>Monto</span><input id="pg-m" inputmode="decimal" placeholder="0.00"' + (pg ? ' value="' + C.decimal(pg.monto) + '"' : '') + '></label>' +
      campoFecha('pg-f', pg ? pg.fecha : h) + '</div>' +
      '<div class="fila-btns"><button type="button" class="btn btn-chico" id="pg-contado"></button></div>' +
      '<p class="nota">El pago baja la deuda de la tarjeta y el saldo de la cuenta por el mismo monto. No cuenta como gasto.</p>' +
      '<p class="error" id="pg-err" hidden></p><button class="btn btn-principal" type="submit">' + (pg ? 'Guardar cambios' : 'Registrar pago') + '</button>' +
      (pg ? '<button class="btn btn-peligro" type="button" id="pg-borrar">Borrar pago</button>' : '') + '</form>';
    abrirHoja(pg ? 'Editar pago' : 'Pagar tarjeta', html, function (root) {
      var primera = true;
      function actualizar() {
        var e = C.estadoTarjeta(d, $('#pg-t', root).value, h);
        var contado = e.porPagar + (pg && pg.tarjeta === $('#pg-t', root).value ? pg.monto : 0); // el pago que editas no cuenta
        $('#pg-info', root).textContent = infoContado(e);
        if (!(pg && primera)) $('#pg-m', root).value = contado > 0 ? C.decimal(contado) : '';
        primera = false;
        $('#pg-contado', root).textContent = 'Contado del mes ' + Q(contado);
        $('#pg-contado', root).onclick = function () { $('#pg-m', root).value = C.decimal(contado); };
      }
      actualizar(); $('#pg-t', root).addEventListener('change', actualizar);
      $('#f-pago', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var a = { tipo: pg ? 'editarPago' : 'pagarTarjeta', tarjeta: $('#pg-t', root).value, cuenta: $('#pg-c', root).value, monto: $('#pg-m', root).value, fecha: leerFecha($('#pg-f', root)) };
        if (pg) a.id = pg.id;
        var r = ejecutar(a);
        if (!r.ok) return errorEn(root, '#pg-err', r.error);
        cerrarHoja(); aviso(pg ? 'Pago actualizado' : 'Pago registrado'); render();
      });
      var b = $('#pg-borrar', root);
      if (b) dobleToque(b, 'Toca otra vez para borrar', function () { ejecutar({ tipo: 'borrarPago', id: pg.id }); cerrarHoja(); aviso('Pago borrado'); render(); });
    });
  }
  // Ingreso o retiro: nuevo (sin editId) o editar uno existente.
  function abrirMovCuenta(tipo, cid, editId) {
    var d = S.data, esR = tipo === 'retiro', tabla = esR ? 'retiros' : 'ingresos', mv = editId ? C.buscar(d[tabla], editId) : null;
    if (mv) cid = mv.cuenta;
    var cuentas = d.cuentas.filter(function (c) { return C.activo(c) || c.id === cid; });
    var html = '<form class="form" id="f-mov" novalidate>' +
      '<label class="campo"><span>Cuenta</span><select id="mv-c">' + opciones(cuentas, cid, function (c) { return c.nombre + ' · ' + Q(C.saldoCuenta(d, c.id)); }) + '</select></label>' +
      '<label class="campo"><span>Descripción</span><input id="mv-d" value="' + esc(mv ? mv.descripcion : '') + '" placeholder="' + (esR ? 'Cajero, efectivo…' : 'Salario, bono 14, venta…') + '"></label>' +
      '<div class="dos"><label class="campo"><span>Monto</span><input id="mv-m" inputmode="decimal" placeholder="0.00" value="' + (mv ? C.decimal(mv.monto) : '') + '"></label>' +
      campoFecha('mv-f', mv ? mv.fecha : hoy()) + '</div>' +
      (esR ? '<p class="nota">Un retiro baja el saldo de la cuenta y puede dejarla en negativo. No cuenta como gasto: anota aparte en qué usas el efectivo.</p>' : '') +
      '<p class="error" id="mv-err" hidden></p><button class="btn btn-principal" type="submit">' + (mv ? 'Guardar cambios' : 'Registrar ' + (esR ? 'retiro' : 'ingreso')) + '</button>' +
      (mv ? '<button class="btn btn-peligro" type="button" id="mv-borrar">Borrar ' + (esR ? 'retiro' : 'ingreso') + '</button>' : '') + '</form>';
    abrirHoja((mv ? 'Editar ' : 'Registrar ') + (esR ? 'retiro' : 'ingreso'), html, function (root) {
      $('#f-mov', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var a = { tipo: (mv ? 'editar' : 'agregar') + (esR ? 'Retiro' : 'Ingreso'), cuenta: $('#mv-c', root).value, descripcion: $('#mv-d', root).value, monto: $('#mv-m', root).value, fecha: leerFecha($('#mv-f', root)) };
        if (mv) a.id = mv.id;
        var r = ejecutar(a);
        if (!r.ok) return errorEn(root, '#mv-err', r.error);
        cerrarHoja(); aviso(mv ? 'Cambios guardados' : (esR ? 'Retiro registrado' : 'Ingreso registrado')); render();
      });
      var b = $('#mv-borrar', root);
      if (b) dobleToque(b, 'Toca otra vez para borrar', function () { ejecutar({ tipo: esR ? 'borrarRetiro' : 'borrarIngreso', id: mv.id }); cerrarHoja(); aviso('Borrado'); render(); });
    });
  }
  // Transferencia entre tus cuentas: nueva o editar una existente.
  function abrirTransferencia(origen, editId) {
    var d = S.data, tr = editId ? C.buscar(d.transferencias, editId) : null;
    var o = tr ? tr.origen : (origen || (activos(d.cuentas)[0] || {}).id);
    var de = tr ? tr.destino : (activos(d.cuentas).filter(function (c) { return c.id !== o; })[0] || {}).id;
    var cuentas = d.cuentas.filter(function (c) { return C.activo(c) || (tr && (c.id === tr.origen || c.id === tr.destino)); });
    var etiqueta = function (c) { return c.nombre + ' · ' + Q(C.saldoCuenta(d, c.id)); };
    var html = '<form class="form" id="f-tr" novalidate>' +
      '<label class="campo"><span>Desde</span><select id="tr-o">' + opciones(cuentas, o, etiqueta) + '</select></label>' +
      '<label class="campo"><span>Hacia</span><select id="tr-d">' + opciones(cuentas, de, etiqueta) + '</select></label>' +
      '<label class="campo"><span>Descripción</span><input id="tr-n" value="' + esc(tr ? tr.descripcion : '') + '" placeholder="Ej.: Ahorro del mes"></label>' +
      '<div class="dos"><label class="campo"><span>Monto</span><input id="tr-m" inputmode="decimal" placeholder="0.00" value="' + (tr ? C.decimal(tr.monto) : '') + '"></label>' +
      campoFecha('tr-f', tr ? tr.fecha : hoy()) + '</div>' +
      '<p class="nota">Baja el saldo de una cuenta y sube el de la otra por el mismo monto. No cuenta como gasto ni como ingreso. La cuenta de origen puede quedar en negativo.</p>' +
      '<p class="error" id="tr-err" hidden></p><button class="btn btn-principal" type="submit">' + (tr ? 'Guardar cambios' : 'Transferir') + '</button>' +
      (tr ? '<button class="btn btn-peligro" type="button" id="tr-borrar">Borrar transferencia</button>' : '') + '</form>';
    abrirHoja(tr ? 'Editar transferencia' : 'Transferencia', html, function (root) {
      $('#f-tr', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var a = { tipo: tr ? 'editarTransferencia' : 'agregarTransferencia', origen: $('#tr-o', root).value, destino: $('#tr-d', root).value,
          descripcion: $('#tr-n', root).value, monto: $('#tr-m', root).value, fecha: leerFecha($('#tr-f', root)) };
        if (tr) a.id = tr.id;
        var r = ejecutar(a);
        if (!r.ok) return errorEn(root, '#tr-err', r.error);
        cerrarHoja(); aviso(tr ? 'Transferencia actualizada' : 'Transferencia registrada'); render();
      });
      var b = $('#tr-borrar', root);
      if (b) dobleToque(b, 'Toca otra vez para borrar', function () { ejecutar({ tipo: 'borrarTransferencia', id: tr.id }); cerrarHoja(); aviso('Transferencia borrada'); render(); });
    });
  }
  function abrirTarjeta(id) {
    var d = S.data, t = C.buscar(d.tarjetas, id), h = hoy(), e = C.estadoTarjeta(d, id, h);
    var prox = [];
    d.cuotas.forEach(function (c) { if (c.tarjeta === id) { var x = C.estadoCuota(c, h); if (x.proxima) prox.push(x.proxima); } });
    prox.sort(function (a, b) { return a.fecha.localeCompare(b.fecha); });
    var c = e.ciclo;
    var html = '<div class="cifra"><span class="eyebrow">' + (e.porPagar > 0 ? 'Por pagar este mes' : (e.aFavor > 0 ? 'Saldo a tu favor' : 'Este mes')) + (t.banco ? ' · ' + esc(t.banco) : '') + '</span>' +
      '<span class="cifra-valor num">' + Q(e.porPagar > 0 ? e.porPagar : e.aFavor) + '</span>' +
      '<span class="sub">' + (e.conCorte ? 'Corte el ' + t.corte + ' · pago el ' + t.pago + ' de cada mes' : 'Sin día de corte') + '</span></div>' +
      '<table class="tabla"><tbody>' +
      '<tr><td>Compras del ciclo</td><td class="num">' + Q(c.compras) + '</td></tr>' +
      '<tr><td>Cuotas de este mes</td><td class="num">' + Q(c.cuotas) + '</td></tr>' +
      (c.pagado ? '<tr><td>Pagado</td><td class="num">−' + Q(c.pagado) + '</td></tr>' : '') +
      (e.anteriores ? '<tr><td>De ciclos anteriores</td><td class="num">' + Q(e.anteriores) + '</td></tr>' : '') +
      '</tbody><tfoot><tr><td>Por pagar</td><td class="num">' + Q(e.porPagar) + '</td></tr></tfoot></table>' +
      '<p class="nota">' + esc(c.ciclo.pago ? 'Ciclo del ' + C.diaMes(c.ciclo.desde) + ' al ' + C.diaMes(c.ciclo.hasta) + ' · pagas el ' + C.diaMes(c.ciclo.pago) + '.' : 'Agrega el día de corte en Editar para contar por ciclo.') + '</p>' +
      '<div><span class="eyebrow">Próxima cuota de cada compra</span><ul class="lista">' + (prox.length ? prox.map(function (x) {
        return '<li><button type="button" class="item" data-cuota="' + esc(x.cuotaId) + '"><span></span><span class="item-txt"><span class="item-nombre">' + esc(x.nombre) + '<span class="insignia">' + x.n + '/' + x.de + '</span></span><span class="item-meta">' + esc(C.fechaCorta(x.fecha)) + '</span></span><span class="item-monto num">' + Q(x.monto) + '</span></button></li>';
      }).join('') : '<li class="vacio">Sin cuotas pendientes en esta tarjeta.</li>') + '</ul>' +
      (prox.length ? '<button type="button" class="btn btn-texto" id="t-cuotas">Ver las cuotas de esta tarjeta</button>' : '') + '</div>' +
      (function () {
        var pagos = movimientosBanco(function (tb, x) { return tb === 'pagos' && x.tarjeta === id; }).slice(0, 10);
        return pagos.length ? '<div><span class="eyebrow">Pagos</span><ul class="lista">' + pagos.map(function (m) { return itemMov(m.t, m.x); }).join('') + '</ul></div>' : '';
      })() +
      '<div class="fila-btns"><button type="button" class="btn btn-principal" id="t-pagar">Pagar</button><button type="button" class="btn" id="t-editar">Editar o quitar</button></div>';
    abrirHoja(t.nombre, html, function (root) {
      clicsLista(root);
      $('#t-pagar', root).addEventListener('click', function () { abrirPago(id); });
      var vc = $('#t-cuotas', root); if (vc) vc.addEventListener('click', function () { S.filtroCuotas = id; cerrarHoja(); irA('cuotas'); });
      $('#t-editar', root).addEventListener('click', function () { abrirBanco('tarjetas', id); });
    });
  }
  function abrirCuenta(id) {
    var d = S.data, c = C.buscar(d.cuentas, id), saldo = C.saldoCuenta(d, id);
    var movs = movimientosBanco(function (t, x) { return x.cuenta === id || x.origen === id || x.destino === id; })
      .concat(d.gastos.filter(function (g) { return g.medio === id; }).map(function (g) { return { t: 'gastos', x: g, f: g.fecha }; }))
      .sort(function (a, b) { return b.f.localeCompare(a.f); }).slice(0, 30);
    var html = '<div class="cifra"><span class="eyebrow">Saldo' + (c.banco ? ' · ' + esc(c.banco) : '') + '</span><span class="cifra-valor num' + (saldo < 0 ? ' negativo' : '') + '">' + Q(saldo) + '</span></div>' +
      '<div class="fila-btns"><button type="button" class="btn btn-principal" id="c-ing">Ingreso</button><button type="button" class="btn btn-principal" id="c-ret">Retiro</button></div>' +
      '<div class="fila-btns"><button type="button" class="btn" id="c-tr"' + (activos(d.cuentas).length > 1 ? '' : ' disabled') + '>Transferir</button><button type="button" class="btn" id="c-editar">Editar o quitar</button></div>' +
      '<div><span class="eyebrow">Movimientos · toca uno para editarlo</span><ul class="lista">' + (movs.length ? movs.map(function (m) {
        return m.t === 'gastos' ? itemGasto(m.x) : itemMov(m.t, m.x, id);
      }).join('') : '<li class="vacio">Sin movimientos todavía.</li>') + '</ul></div>';
    abrirHoja(c.nombre, html, function (root) {
      clicsLista(root);
      $('#c-ing', root).addEventListener('click', function () { abrirMovCuenta('ingreso', id); });
      $('#c-ret', root).addEventListener('click', function () { abrirMovCuenta('retiro', id); });
      $('#c-tr', root).addEventListener('click', function () { abrirTransferencia(id); });
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
    // Solo aparecen las tarjetas que tienen cuotas.
    var conCuotas = d.tarjetas.filter(function (t) { return lista.some(function (x) { return x.c.tarjeta === t.id; }); });
    if (S.filtroCuotas !== 'todas' && !conCuotas.some(function (t) { return t.id === S.filtroCuotas; })) S.filtroCuotas = 'todas';
    var visibles = lista.filter(function (x) { return S.filtroCuotas === 'todas' || x.c.tarjeta === S.filtroCuotas; });
    var activas = visibles.filter(function (x) { return x.e.cargadas < x.c.numCuotas; }), fin = visibles.filter(function (x) { return x.e.cargadas >= x.c.numCuotas; });
    var restante = function (x) { return x.e.calendario.reduce(function (a, q) { return a + (q.fecha > h ? q.monto : 0); }, 0); };
    var mensual = activas.reduce(function (a, x) { return a + (x.e.proxima ? x.e.proxima.monto : 0); }, 0);
    var mio = activas.reduce(function (a, x) { return a + (x.e.proxima ? C.sumaPartes(x.e.proxima.partes, 'yo') : 0); }, 0);
    var falta = activas.reduce(function (a, x) { return a + restante(x); }, 0);
    function fila(x) {
      var c = x.c, partes = C.partesCuota(c), r = restante(x);
      return '<li><button type="button" class="item" data-cuota="' + esc(c.id) + '"><span></span>' +
        '<span class="item-txt"><span class="item-nombre">' + esc(c.nombre) + '<span class="insignia">' + x.e.cargadas + '/' + c.numCuotas + '</span></span>' +
        '<span class="item-meta envuelve">' + esc(C.describirDueno(d, partes)) + ' · termina ' + esc(C.fechaCorta(x.e.final)) + (r ? ' · faltan ' + Q(r) : '') + '</span></span>' +
        '<span class="item-monto num">' + Q(x.e.montoCuota) + '<small>al mes</small></span></button></li>';
    }
    function porTarjeta(items, titulo) {
      if (!items.length) return '';
      return '<div><h2 class="titulo-bloque">' + titulo + '</h2>' + conCuotas.map(function (t) {
        var suyas = items.filter(function (x) { return x.c.tarjeta === t.id; }); if (!suyas.length) return '';
        var mes = suyas.reduce(function (a, x) { return a + (x.e.proxima ? x.e.proxima.monto : 0); }, 0);
        return '<div class="grupo-tarjeta"><div class="grupo-cab">' + muestra(t.color) + '<span class="grupo-nombre">' + esc(t.nombre) + '</span>' +
          (mes ? '<span class="sub num">' + Q(mes) + ' al mes</span>' : '') + '</div><ul class="lista">' + suyas.map(fila).join('') + '</ul></div>';
      }).join('') + '</div>';
    }
    var chips = conCuotas.length ? '<div class="chips" id="cu-filtro" role="radiogroup" aria-label="Filtrar por tarjeta">' +
      '<button type="button" class="chip" role="radio" data-filtro="todas" aria-checked="' + (S.filtroCuotas === 'todas') + '">Todas</button>' +
      conCuotas.map(function (t) { return '<button type="button" class="chip" role="radio" data-filtro="' + esc(t.id) + '" aria-checked="' + (S.filtroCuotas === t.id) + '">' + muestra(t.color) + esc(t.nombre) + '</button>'; }).join('') + '</div>' : '';
    $('#cuotas-cuerpo').innerHTML = (activas.length ? '<div class="cifra"><span class="eyebrow">Próximas cuotas' + (S.filtroCuotas !== 'todas' ? ' · ' + esc(medioDe(S.filtroCuotas).nombre) : '') + '</span><span class="cifra-valor num">' + Q(mensual) + '</span>' +
        '<span class="sub">Tuyo ' + Q(mio) + ' · de otros ' + Q(mensual - mio) + ' · faltan ' + Q(falta) + ' en total</span></div>' : '') +
      chips +
      '<button type="button" class="btn btn-principal" id="cu-nueva">Nueva compra en cuotas</button>' +
      (activas.length ? porTarjeta(activas, 'Activas') : '<div><h2 class="titulo-bloque">Activas</h2><p class="vacio">No hay cuotas activas.</p></div>') +
      porTarjeta(fin, 'Terminadas');
    var f = $('#cu-filtro');
    if (f) f.addEventListener('click', function (e) { var b = e.target.closest('[data-filtro]'); if (b) { S.filtroCuotas = b.dataset.filtro; renderCuotas(); } });
  }
  // Sin id: compra nueva. Con id: edita todo de una compra en cuotas existente.
  function repartoDesdePartes(partes, total) {
    var r = repartoInicial();
    if (partes.length === 1 && partes[0].p === 'yo') return r;
    if (partes.length === 1) { r.modo = 'otra'; r.persona = partes[0].p; return r; }
    r.modo = 'dividir';
    r.sel = ['yo'].concat(partes.map(function (x) { return x.p; }).filter(function (p) { return p !== 'yo'; })).filter(function (p) { return partes.some(function (x) { return x.p === p; }); });
    var ig = C.dividirIguales(total, r.sel);
    var iguales = ig.every(function (y) { return partes.some(function (x) { return x.p === y.p && x.m === y.m; }); });
    r.dividir = iguales ? 'iguales' : 'montos';
    partes.forEach(function (x) { r.montos[x.p] = C.decimal(x.m); });
    return r;
  }
  function abrirNuevaCuota(editId) {
    var d = S.data, c = editId ? C.buscar(d.cuotas, editId) : null;
    var reparto = c ? repartoDesdePartes(C.partesCuota(c), c.total) : repartoInicial();
    var tarjetas = activos(d.tarjetas).concat(c ? d.tarjetas.filter(function (t) { return t.id === c.tarjeta && !C.activo(t); }) : []);
    if (!tarjetas.length) return aviso('Primero agrega una tarjeta en Bancos.');
    var enCuota = c ? C.partesCuota(c).map(function (x) { return x.p; }) : [];
    var titulo = c ? 'Editar cuotas' : 'Compra en cuotas';
    var html = '<form class="form" id="f-cuota" novalidate>' +
      '<label class="campo"><span>¿Qué compraste?</span><input id="cu-n" placeholder="Ej.: Intelaf El Naranjo"></label>' +
      '<div class="dos"><label class="campo"><span>Monto total</span><input id="cu-t" inputmode="decimal" placeholder="0.00"></label>' +
      '<label class="campo"><span>Número de cuotas</span><input id="cu-k" inputmode="numeric" placeholder="12"></label></div>' +
      '<div class="dos">' + campoFecha('cu-f', hoy(), 'Primera cuota') +
      '<label class="campo"><span>Tarjeta</span><select id="cu-tc">' + opciones(tarjetas, C.medio(d, S.medio) && C.medio(d, S.medio).tipo === 'tarjeta' ? S.medio : null, function (t) { return t.nombre; }) + '</select></label></div>' +
      '<label class="campo"><span>Categoría</span><select id="cu-cat">' + C.CATEGORIAS.map(function (c) { return '<option' + (c === 'Deudas y tarjetas' ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<button type="button" class="opcion" id="cu-para"><span class="opcion-lbl">Para</span><span id="cu-para-txt">Solo mío</span></button>' +
      '<p class="nota" id="cu-prev">Escribe el monto y el número de cuotas para ver el calendario.</p>' +
      (c ? '<p class="nota">Al guardar se recalcula todo el calendario con los datos nuevos: montos, fechas, tarjeta y lo que le toca a cada persona.</p>' : '') +
      '<p class="error" id="cu-err" hidden></p><button class="btn btn-principal" type="submit">' + (c ? 'Guardar cambios' : 'Guardar cuotas') + '</button></form>';
    var guardado = c ? { 'cu-n': c.nombre, 'cu-t': C.decimal(c.total), 'cu-k': String(c.numCuotas), 'cu-f': isoADmy(c.fechaInicio), 'cu-tc': c.tarjeta, 'cu-cat': c.categoria } : null;
    function montar(root) {
      if (guardado) Object.keys(guardado).forEach(function (k) { $('#' + k, root).value = guardado[k]; });
      $('#cu-para-txt', root).textContent = textoPara(reparto);
      function prev() {
        var t = C.parseMonto($('#cu-t', root).value), k = parseInt($('#cu-k', root).value, 10), f = leerFecha($('#cu-f', root));
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
          personas: function () { return d.personas.filter(function (p) { return (C.activo(p) && p.tipo === 'permanente') || enCuota.indexOf(p.id) >= 0; }); },
          alCerrar: function () { setTimeout(function () { abrirHoja(titulo, html, montar); }, 0); } });
      });
      $('#f-cuota', root).addEventListener('submit', function (e) {
        e.preventDefault();
        var t = C.parseMonto($('#cu-t', root).value), partes;
        if (t > 0) { var pr = partesDe(reparto, t); if (pr.error) return errorEn(root, '#cu-err', pr.error); partes = pr.partes; }
        var a = { tipo: c ? 'editarCuota' : 'agregarCuota', nombre: $('#cu-n', root).value, total: $('#cu-t', root).value, numCuotas: $('#cu-k', root).value,
          fechaInicio: leerFecha($('#cu-f', root)), tarjeta: $('#cu-tc', root).value, categoria: $('#cu-cat', root).value, partes: partes };
        if (c) a.id = c.id;
        var r = ejecutar(a);
        if (!r.ok) return errorEn(root, '#cu-err', r.error);
        cerrarHoja(); aviso(c ? 'Cambios guardados' : 'Cuotas guardadas'); render();
      });
    }
    abrirHoja(titulo, html, montar);
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
      }).join('') + '</ul><button type="button" class="btn btn-principal" id="cu-editar">Editar</button>' +
      '<button type="button" class="btn btn-peligro" id="cu-borrar">Borrar esta compra en cuotas</button>';
    abrirHoja(c.nombre, html, function (root) {
      $('#cu-editar', root).addEventListener('click', function () { abrirNuevaCuota(id); });
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
      '<label class="campo"><span>Mes</span><select id="pe-m" disabled>' + (function () {
        var out = '', base = C.mesDe(hoy());
        for (var k = -3; k <= 12; k++) { var v = C.sumarMeses(base, k); out += '<option value="' + v + '"' + (v === ym ? ' selected' : '') + '>' + C.nombreMes(v) + '</option>'; }
        return out;
      })() + '</select></label></div>' +
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
      gastos.map(function (g) { return '<li><button type="button" class="item" data-gasto="' + esc(g.id) + '">' + muestra(medioDe(g.medio).color) + '<span class="item-txt"><span class="item-nombre">' + esc(g.nombre) + '</span><span class="item-meta">' + esc(fechaTxt(g.fecha)) + '</span></span><span class="item-monto num">' + Q(parte(g.partes)) + '</span></button></li>'; }).join('') +
      cuotas.map(function (c) { return '<li><button type="button" class="item" data-cuota="' + esc(c.cuotaId) + '">' + muestra(medioDe(c.tarjeta).color) + '<span class="item-txt"><span class="item-nombre">' + esc(c.nombre) + '<span class="insignia">' + c.n + '/' + c.de + '</span></span><span class="item-meta">Cuota · ' + esc(C.fechaCorta(c.fecha)) + '</span></span><span class="item-monto num">' + Q(parte(c.partes)) + '</span></button></li>'; }).join('') +
      '</ul><button type="button" class="btn btn-peligro" id="pe-quitar">Quitar persona</button>';
    abrirHoja(p.nombre, html, function (root) {
      clicsLista(root);
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
  $('#g-fecha-btn').addEventListener('click', function () {
    abrirCalendario(S.fecha || hoy(), function (iso) {
      S.fecha = iso !== hoy() ? iso : null;
      $('#g-fecha-txt').textContent = fechaTxt(S.fecha || hoy());
    });
  });
  $('#g-para').addEventListener('click', function () {
    abrirReparto({ estado: S.reparto, total: function () { return C.parseMonto($('#g-monto').value); },
      personas: function () { return C.personasDelMes(S.data, mesDelGasto()); },
      alCerrar: function () { $('#g-para-txt').textContent = textoPara(S.reparto); } });
  });

  // Clics en listas (delegados); lo que está dentro de la hoja lo maneja cada hoja.
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-gasto],[data-cuota],[data-mov],[data-cat],[data-tarjeta],[data-cuenta],[data-persona],[data-pagar],#b-pagar,#b-ingreso,#b-retiro,#b-transferir,#b-nueva-t,#b-nueva-c,#cu-nueva');
    if (!t || t.closest('#hoja')) return;
    if (t.dataset.gasto) abrirGasto(t.dataset.gasto);
    else if (t.dataset.cuota) abrirCuota(t.dataset.cuota);
    else if (t.dataset.mov) { var pm = t.dataset.mov.split(':'); abrirMov(pm[0], pm.slice(1).join(':')); }
    else if (t.dataset.cat && t.classList.contains('pres')) abrirLimite(t.dataset.cat);
    else if (t.dataset.tarjeta) abrirTarjeta(t.dataset.tarjeta);
    else if (t.dataset.cuenta) abrirCuenta(t.dataset.cuenta);
    else if (t.dataset.persona) abrirPersona(t.dataset.persona);
    else if (t.dataset.pagar) abrirPago(t.dataset.pagar);
    else if (t.id === 'b-pagar') abrirPago();
    else if (t.id === 'b-ingreso') abrirMovCuenta('ingreso');
    else if (t.id === 'b-retiro') abrirMovCuenta('retiro');
    else if (t.id === 'b-transferir') abrirTransferencia();
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
    var url = $('#cx-url').value.replace(/\s+/g, ''), clave = $('#cx-clave').value.replace(/\s+/g, ''), e = $('#cx-error');
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { e.textContent = 'La dirección tiene que empezar con https://script.google.com/'; e.hidden = false; return; }
    if (/\/dev(\?|$)/.test(url)) { e.textContent = 'Esa es la dirección de prueba (termina en /dev) y solo funciona con tu sesión de Google. Usa la que termina en /exec.'; e.hidden = false; return; }
    if (!/\/exec(\?|$)/.test(url)) { e.textContent = 'La dirección tiene que terminar en /exec. Cópiala desde el teléfono: engrane → Copiar.'; e.hidden = false; return; }
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
      e.textContent = 'No pude conectarme con esa dirección. Revisa que sea exactamente la misma del teléfono (engrane → Copiar) y que el script esté publicado para "Cualquier persona". Si usas un bloqueador de anuncios, desactívalo para esta página.'; e.hidden = false;
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

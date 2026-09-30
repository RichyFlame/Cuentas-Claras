/* =====================================================================
   Cuentas Claras — núcleo compartido
   Este MISMO archivo se usa en la web app (core.js) y en Apps Script
   (pégalo como Core.gs). Todas las reglas de negocio viven aquí para
   que la app y el servidor calculen exactamente lo mismo.
   Todos los montos se manejan en CENTAVOS ENTEROS (Q1.00 = 100).
   ===================================================================== */
var Core = (function () {
  'use strict';

  /* ---------- Catálogos ---------- */
  var CATEGORIAS = [
    'Vivienda', 'Servicios', 'Alimentación – supermercado', 'Alimentación – comidas fuera',
    'Transporte', 'Salud', 'Educación', 'Deudas y tarjetas', 'Suscripciones',
    'Entretenimiento', 'Ropa y cuidado personal', 'Familia y regalos', 'Ahorro', 'Otros'
  ];
  var TIPOS = ['Necesario', 'Prescindible'];
  var TIPO_POR_CATEGORIA = {
    'Vivienda': 'Necesario', 'Servicios': 'Necesario', 'Alimentación – supermercado': 'Necesario',
    'Alimentación – comidas fuera': 'Prescindible', 'Transporte': 'Necesario', 'Salud': 'Necesario',
    'Educación': 'Necesario', 'Deudas y tarjetas': 'Necesario', 'Suscripciones': 'Prescindible',
    'Entretenimiento': 'Prescindible', 'Ropa y cuidado personal': 'Prescindible',
    'Familia y regalos': 'Prescindible', 'Ahorro': 'Necesario', 'Otros': 'Prescindible'
  };
  var ALERTA_PCT = 80; // a partir de este % del presupuesto se avisa "cerca"

  /* ---------- Estructura de las hojas ----------
     [clave interna, encabezado en la hoja, tipo]
     tipos: text | date | money | int | bool | reparto | derived */
  var TABLAS = {
    gastos: { hoja: 'Gastos', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['fecha', 'Fecha', 'date'], ['nombre', 'Descripción', 'text'],
      ['monto', 'Monto (Q)', 'money'], ['categoria', 'Categoría', 'text'], ['tipo', 'Tipo', 'text'],
      ['medio', 'Tarjeta o cuenta', 'text'], ['partes', 'Reparto', 'reparto'],
      ['miParte', 'Mi parte (Q)', 'derived'], ['origen', 'Origen', 'text'],
      ['revisado', 'Revisado', 'bool'], ['creado', 'Creado', 'text'], ['ejemplo', 'Ejemplo', 'bool']] },
    cuotas: { hoja: 'Cuotas', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['nombre', 'Descripción', 'text'], ['fechaInicio', 'Primera cuota', 'date'],
      ['total', 'Monto total (Q)', 'money'], ['numCuotas', 'Número de cuotas', 'int'],
      ['dueno', 'Dueño', 'text'], ['tarjeta', 'Tarjeta', 'text'], ['categoria', 'Categoría', 'text'],
      ['tipo', 'Tipo', 'text'], ['montoCuota', 'Cuota mensual (Q)', 'derived'],
      ['fechaFinal', 'Última cuota', 'derived'], ['ejemplo', 'Ejemplo', 'bool']] },
    tarjetas: { hoja: 'Tarjetas', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['nombre', 'Nombre', 'text'], ['banco', 'Banco', 'text'],
      ['color', 'Color', 'text'], ['inicial', 'Deuda inicial (Q)', 'money']] },
    cuentas: { hoja: 'Cuentas', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['nombre', 'Nombre', 'text'], ['banco', 'Banco', 'text'],
      ['color', 'Color', 'text'], ['inicial', 'Saldo inicial (Q)', 'money']] },
    pagos: { hoja: 'Pagos', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['fecha', 'Fecha', 'date'], ['tarjeta', 'Tarjeta', 'text'],
      ['cuenta', 'Desde cuenta', 'text'], ['monto', 'Monto (Q)', 'money'], ['ejemplo', 'Ejemplo', 'bool']] },
    ingresos: { hoja: 'Ingresos', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['fecha', 'Fecha', 'date'], ['cuenta', 'Cuenta', 'text'],
      ['descripcion', 'Descripción', 'text'], ['monto', 'Monto (Q)', 'money'], ['ejemplo', 'Ejemplo', 'bool']] },
    personas: { hoja: 'Personas', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['nombre', 'Nombre', 'text'], ['tipo', 'Tipo', 'text'],
      ['mes', 'Mes (si es de un mes)', 'text'], ['ejemplo', 'Ejemplo', 'bool']] },
    reglas: { hoja: 'Reglas', clave: 'palabra', cols: [
      ['palabra', 'Palabra clave', 'text'], ['categoria', 'Categoría', 'text'],
      ['tipo', 'Tipo', 'text'], ['origen', 'Origen', 'text']] },
    presupuesto: { hoja: 'Presupuesto', clave: 'categoria', cols: [
      ['categoria', 'Categoría', 'text'], ['monto', 'Límite mensual (Q)', 'money'], ['ejemplo', 'Ejemplo', 'bool']] }
  };
  var NOMBRES_TABLAS = Object.keys(TABLAS);

  /* ---------- Montos ---------- */
  // Devuelve centavos (entero, puede ser negativo) o null si no se entiende.
  function parseMonto(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : null;
    var s = String(v).trim().replace(/^q\.?\s*/i, '').replace(/\s+/g, '');
    if (!s) return null;
    var neg = false;
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    s = s.replace(/^q\.?/i, '');
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');   // 1,250.50
    else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');            // 45,50
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
    var p = s.split('.');
    var ent = parseInt(p[0] || '0', 10);
    var dec = (p[1] || '');
    var cent;
    if (dec.length <= 2) cent = parseInt((dec + '00').slice(0, 2), 10);
    else cent = Math.round(parseFloat('0.' + dec) * 100); // más de 2 decimales: redondea
    var total = ent * 100 + cent;
    return neg ? -total : total;
  }
  function decimal(c) { // "1250.00" (para guardar texto)
    var neg = c < 0; c = Math.abs(c);
    return (neg ? '-' : '') + Math.floor(c / 100) + '.' + ('0' + (c % 100)).slice(-2);
  }
  function fmtQ(c) { // "Q1,250.00"
    c = Math.round(c || 0);
    var neg = c < 0; c = Math.abs(c);
    var ent = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + 'Q' + ent + '.' + ('0' + (c % 100)).slice(-2);
  }
  function montoValido(c) { return typeof c === 'number' && c > 0 && c <= 10000000000; }

  /* ---------- Fechas (texto AAAA-MM-DD, sin zonas horarias) ---------- */
  function fechaValida(f) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f || ''))) return false;
    var y = +f.slice(0, 4), m = +f.slice(5, 7), d = +f.slice(8, 10);
    return m >= 1 && m <= 12 && d >= 1 && d <= diasDelMes(y, m);
  }
  function diasDelMes(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function mesDe(f) { return String(f).slice(0, 7); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function sumarMeses(ym, k) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  }
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function nombreMes(ym) { return MESES[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
  function fechaCorta(f) { return +f.slice(8, 10) + ' ' + MESES[+f.slice(5, 7) - 1].slice(0, 3) + ' ' + f.slice(0, 4); }

  /* ---------- Texto y clasificación ---------- */
  function normalizar(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function singular(n) { // "almuerzos tacos" -> "almuerzo taco"
    return n.split(' ').map(function (t) { return t.length > 3 && /s$/.test(t) ? t.slice(0, -1) : t; }).join(' ');
  }
  function clasificar(nombre, reglas) {
    var n = normalizar(nombre);
    var textos = [' ' + n + ' ', ' ' + singular(n) + ' '];
    var mejor = null, mejorPts = -1;
    (reglas || []).forEach(function (r) {
      var kw = normalizar(r.palabra);
      if (!kw || CATEGORIAS.indexOf(r.categoria) < 0) return;
      var hit = textos[0].indexOf(' ' + kw + ' ') >= 0 || textos[1].indexOf(' ' + kw + ' ') >= 0;
      if (!hit) return;
      var pts = (r.origen === 'usuario' ? 1000 : 0) + kw.length;
      if (pts > mejorPts) { mejor = r; mejorPts = pts; }
    });
    var cat = mejor ? mejor.categoria : 'Otros';
    var tipo = mejor && TIPOS.indexOf(mejor.tipo) >= 0 ? mejor.tipo : TIPO_POR_CATEGORIA[cat];
    return { categoria: cat, tipo: tipo, regla: mejor ? mejor.palabra : null };
  }
  function palabraParaRegla(nombre) {
    return normalizar(nombre).split(' ').filter(function (t) { return t && !/^\d+$/.test(t); }).join(' ');
  }

  var REGLAS_BASE = (function () {
    var m = {
      'Vivienda': 'alquiler,renta,casa,condominio,mantenimiento,cuota condominio,apartamento',
      'Servicios': 'luz,eegsa,energuate,agua,empagua,internet,claro,tigo,telefono,celular plan,cable,gas propano,tropigas,zeta gas,recarga',
      'Alimentación – supermercado': 'super,supermercado,la torre,paiz,walmart,despensa,maxi despensa,pricesmart,econosuper,mercado,verdura,fruta,tortilla,carniceria,panaderia,abarrotes',
      'Alimentación – comidas fuera': 'almuerzo,desayuno,cena,refaccion,cafe,cafeteria,starbucks,barista,campero,pollo campero,mcdonalds,burger king,pizza,taco,shuco,restaurante,comida,pedidos ya,hugo,uber eats,helado,antojito,pupusa,sushi',
      'Transporte': 'gasolina,diesel,uber,indriver,taxi,bus,transmetro,parqueo,peaje,llanta,mecanico,taller,lavado carro,repuesto,tarjeta de circulacion',
      'Salud': 'farmacia,cruz verde,galeno,medicina,medicamento,doctor,consulta,dentista,laboratorio,hospital,seguro medico,optica,vitamina',
      'Educación': 'colegiatura,colegio,universidad,curso,libro,utiles,inscripcion,diplomado,clase',
      'Deudas y tarjetas': 'prestamo,cuota prestamo,pago tarjeta,abono,intereses,deuda',
      'Suscripciones': 'netflix,spotify,disney,hbo,youtube premium,icloud,amazon prime,prime video,chatgpt,apple music,game pass,suscripcion,membresia',
      'Entretenimiento': 'cine,cinepolis,cinemark,concierto,bar,cerveza,fiesta,juego,videojuego,steam,boliche,paseo,entrada,karaoke',
      'Ropa y cuidado personal': 'ropa,zapato,tenis,camisa,pantalon,vestido,corte de pelo,barberia,salon,perfume,cosmetico,siman,zara,shampoo',
      'Familia y regalos': 'regalo,cumpleanos,mama,papa,donacion,ofrenda,diezmo,iglesia,boda,baby shower',
      'Ahorro': 'ahorro,fondo de emergencia,deposito ahorro'
    };
    var out = [];
    Object.keys(m).forEach(function (cat) {
      m[cat].split(',').forEach(function (p) { out.push({ palabra: p, categoria: cat, tipo: '', origen: 'base' }); });
    });
    out.push({ palabra: 'gimnasio', categoria: 'Salud', tipo: 'Prescindible', origen: 'base' });
    out.push({ palabra: 'gym', categoria: 'Salud', tipo: 'Prescindible', origen: 'base' });
    return out;
  })();

  /* ---------- Reparto entre personas ---------- */
  // El resto de centavos se asigna a UNA sola persona: la primera de la lista.
  function dividirIguales(total, ids) {
    var n = ids.length; if (!n) return [];
    var base = Math.floor(total / n), resto = total - base * n;
    return ids.map(function (p, i) { return { p: p, m: base + (i === 0 ? resto : 0) }; });
  }
  function codificarReparto(partes) {
    return (partes || []).map(function (x) { return x.p + '=' + decimal(x.m); }).join('; ');
  }
  function decodificarReparto(s) {
    if (Array.isArray(s)) return s;
    s = String(s || '').trim(); if (!s) return [];
    return s.split(';').map(function (t) {
      var kv = t.split('='); return { p: kv[0].trim(), m: parseMonto(kv[1]) || 0 };
    }).filter(function (x) { return x.p; });
  }
  function miParte(g) {
    return (g.partes || []).reduce(function (a, x) { return a + (x.p === 'yo' ? x.m : 0); }, 0);
  }

  /* ---------- Cuotas ---------- */
  // Genera el calendario completo. Día 31 en mes corto -> último día del mes.
  // La última cuota absorbe la diferencia si el total no divide exacto.
  function calendarioCuota(c) {
    var n = c.numCuotas, y = +c.fechaInicio.slice(0, 4), m = +c.fechaInicio.slice(5, 7), dia = +c.fechaInicio.slice(8, 10);
    var base = Math.floor(c.total / n), out = [];
    for (var i = 0; i < n; i++) {
      var ym = sumarMeses(y + '-' + pad(m), i);
      var yy = +ym.slice(0, 4), mm = +ym.slice(5, 7);
      var d = Math.min(dia, diasDelMes(yy, mm));
      out.push({
        cuotaId: c.id, nombre: c.nombre, n: i + 1, de: n, fecha: ym + '-' + pad(d),
        monto: i === n - 1 ? c.total - base * (n - 1) : base,
        dueno: c.dueno, tarjeta: c.tarjeta, categoria: c.categoria, tipo: c.tipo
      });
    }
    return out;
  }
  function cuotasDelMes(data, ym) {
    var out = [];
    (data.cuotas || []).forEach(function (c) {
      calendarioCuota(c).forEach(function (x) { if (mesDe(x.fecha) === ym) out.push(x); });
    });
    return out;
  }
  function estadoCuota(c, hoy) { // cuántas ya se cargaron y la próxima
    var cal = calendarioCuota(c), hechas = 0, prox = null;
    cal.forEach(function (x) { if (x.fecha <= hoy) hechas++; else if (!prox) prox = x; });
    return { calendario: cal, cargadas: hechas, proxima: prox, final: cal[cal.length - 1].fecha, montoCuota: cal[0].monto };
  }

  /* ---------- Saldos ---------- */
  function buscar(lista, id, clave) { clave = clave || 'id'; for (var i = 0; i < (lista || []).length; i++) if (lista[i][clave] === id) return lista[i]; return null; }
  function medio(data, id) {
    var t = buscar(data.tarjetas, id); if (t) return { tipo: 'tarjeta', obj: t };
    var c = buscar(data.cuentas, id); if (c) return { tipo: 'cuenta', obj: c };
    return null;
  }
  function deudaTarjeta(data, id, hoy) {
    var t = buscar(data.tarjetas, id); if (!t) return 0;
    var d = t.inicial || 0;
    data.gastos.forEach(function (g) { if (g.medio === id) d += g.monto; });
    data.cuotas.forEach(function (c) {
      if (c.tarjeta !== id) return;
      calendarioCuota(c).forEach(function (x) { if (x.fecha <= hoy) d += x.monto; });
    });
    data.pagos.forEach(function (p) { if (p.tarjeta === id) d -= p.monto; });
    return d;
  }
  function saldoCuenta(data, id) {
    var c = buscar(data.cuentas, id); if (!c) return 0;
    var s = c.inicial || 0;
    data.ingresos.forEach(function (i) { if (i.cuenta === id) s += i.monto; });
    data.pagos.forEach(function (p) { if (p.cuenta === id) s -= p.monto; });
    data.gastos.forEach(function (g) { if (g.medio === id) s -= g.monto; });
    return s;
  }
  function ultimoMedio(data) {
    var ult = null;
    data.gastos.forEach(function (g) {
      if (!medio(data, g.medio)) return;
      if (!ult || (g.creado || '') >= (ult.creado || '')) ult = g;
    });
    if (ult) return ult.medio;
    return data.tarjetas.length ? data.tarjetas[0].id : (data.cuentas.length ? data.cuentas[0].id : null);
  }

  /* ---------- Personas ---------- */
  function personasDelMes(data, ym) {
    return data.personas.filter(function (p) { return p.tipo === 'permanente' || p.mes === ym; });
  }
  function nombrePersona(data, id) {
    if (id === 'yo') return 'Yo'; var p = buscar(data.personas, id); return p ? p.nombre : id;
  }

  /* ---------- Recuento del mes ---------- */
  function recuento(data, ym) {
    var gastos = data.gastos.filter(function (g) { return mesDe(g.fecha) === ym; });
    var cuotas = cuotasDelMes(data, ym);
    var per = {}, orden = ['yo'];
    per.yo = { id: 'yo', nombre: 'Yo', gastos: 0, cuotas: 0 };
    personasDelMes(data, ym).forEach(function (p) { per[p.id] = { id: p.id, nombre: p.nombre, gastos: 0, cuotas: 0 }; orden.push(p.id); });
    function asegura(id) { if (!per[id]) { per[id] = { id: id, nombre: nombrePersona(data, id), gastos: 0, cuotas: 0 }; orden.push(id); } }
    var total = 0, porMedio = {}, porCatMia = {}, porCatTodo = {};
    gastos.forEach(function (g) {
      total += g.monto;
      porMedio[g.medio] = (porMedio[g.medio] || 0) + g.monto;
      porCatTodo[g.categoria] = (porCatTodo[g.categoria] || 0) + g.monto;
      g.partes.forEach(function (x) {
        asegura(x.p); per[x.p].gastos += x.m;
        if (x.p === 'yo') porCatMia[g.categoria] = (porCatMia[g.categoria] || 0) + x.m;
      });
    });
    cuotas.forEach(function (x) {
      total += x.monto;
      porMedio[x.tarjeta] = (porMedio[x.tarjeta] || 0) + x.monto;
      porCatTodo[x.categoria] = (porCatTodo[x.categoria] || 0) + x.monto;
      asegura(x.dueno); per[x.dueno].cuotas += x.monto;
      if (x.dueno === 'yo') porCatMia[x.categoria] = (porCatMia[x.categoria] || 0) + x.monto;
    });
    var personas = orden.map(function (id) { var o = per[id]; o.total = o.gastos + o.cuotas; return o; });
    var suma = function (obj) { return Object.keys(obj).reduce(function (a, k) { return a + obj[k]; }, 0); };
    var sumPer = personas.reduce(function (a, p) { return a + p.total; }, 0);
    var mio = per.yo.total;
    return {
      mes: ym, total: total, mio: mio, deOtros: total - mio, personas: personas,
      porMedio: porMedio, porCategoriaMia: porCatMia, porCategoria: porCatTodo,
      gastos: gastos, cuotas: cuotas,
      cuadra: sumPer === total && suma(porMedio) === total && suma(porCatTodo) === total && suma(porCatMia) === mio
    };
  }
  function presupuestoMes(data, ym) {
    var r = recuento(data, ym);
    return CATEGORIAS.map(function (cat) {
      var lim = (buscar(data.presupuesto, cat, 'categoria') || {}).monto || 0;
      var gastado = r.porCategoriaMia[cat] || 0;
      var pct = lim > 0 ? Math.floor(gastado * 100 / lim) : null;
      var estado = lim <= 0 ? 'sin' : (gastado > lim ? 'pasado' : (gastado * 100 >= lim * ALERTA_PCT ? 'cerca' : 'bien'));
      return { categoria: cat, limite: lim, gastado: gastado, pct: pct, estado: estado };
    });
  }
  function mesesConActividad(data) {
    var s = {};
    data.gastos.forEach(function (g) { s[mesDe(g.fecha)] = 1; });
    data.cuotas.forEach(function (c) { calendarioCuota(c).forEach(function (x) { s[mesDe(x.fecha)] = 1; }); });
    return Object.keys(s).sort();
  }

  /* ---------- Acciones -> operaciones ----------
     aplicar(data, accion, ctx) valida y devuelve {ok, ops, info} o {ok:false, error}.
     accion.tipo = nombre de la acción; Necesario/Prescindible viaja en accion.tipoGasto.
     ctx = { hoy:'AAAA-MM-DD', ahora:'ISO', id:function(){} , ejemplo:bool } */
  function err(msg) { return { ok: false, error: msg }; }
  function okOps(ops, info) { return { ok: true, ops: ops, info: info || {} }; }
  function nuevoId(ctx, pref) { return ctx && ctx.id ? ctx.id(pref) : pref + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function slug(s) { return normalizar(s).replace(/ /g, '-').slice(0, 20) || 'persona'; }

  function validarMonto(v, que) {
    var c = parseMonto(v);
    if (v === '' || v === null || v === undefined || c === null) return { error: 'Escribe ' + (que || 'el monto') + '. Ejemplo: 45 o 45.50' };
    if (c <= 0) return { error: (que ? que.charAt(0).toUpperCase() + que.slice(1) : 'El monto') + ' tiene que ser mayor que cero.' };
    if (!montoValido(c)) return { error: 'Ese monto es demasiado grande.' };
    return { c: c };
  }

  function validarPartes(data, partes, total, fecha) {
    var vistos = {}, suma = 0, ym = mesDe(fecha);
    if (!partes.length) return 'Elige al menos una persona para el gasto.';
    for (var i = 0; i < partes.length; i++) {
      var x = partes[i];
      if (vistos[x.p]) return 'Una persona aparece dos veces en el reparto.';
      vistos[x.p] = 1;
      if (x.p !== 'yo') {
        var per = buscar(data.personas, x.p);
        if (!per) return 'No encuentro a la persona "' + x.p + '".';
        if (per.tipo === 'mes' && per.mes !== ym) return per.nombre + ' solo está registrada para ' + nombreMes(per.mes) + '.';
      }
      if (typeof x.m !== 'number' || x.m < 0 || Math.round(x.m) !== x.m) return 'Revisa los montos del reparto.';
      suma += x.m;
    }
    if (suma !== total) return 'El reparto suma ' + fmtQ(suma) + ' y el gasto es de ' + fmtQ(total) + '. Ajusta los montos.';
    return null;
  }

  var acciones = {
    agregarGasto: function (data, a, ctx) {
      var nombre = String(a.nombre || '').trim();
      if (!nombre) return err('Escribe en qué fue el gasto. Ejemplo: almuerzo');
      var v = validarMonto(a.monto); if (v.error) return err(v.error);
      var fecha = a.fecha || ctx.hoy; if (!fechaValida(fecha)) return err('La fecha no es válida.');
      var id = a.id || nuevoId(ctx, 'g');
      if (buscar(data.gastos, id)) return { ok: true, ops: [], info: { duplicado: true } };
      var med = a.medio || ultimoMedio(data);
      if (!med || !medio(data, med)) return err('Elige una tarjeta o cuenta.');
      var cl = clasificar(nombre, data.reglas);
      var cat = CATEGORIAS.indexOf(a.categoria) >= 0 ? a.categoria : cl.categoria;
      var tipo = TIPOS.indexOf(a.tipoGasto) >= 0 ? a.tipoGasto : (a.categoria ? TIPO_POR_CATEGORIA[cat] : cl.tipo);
      var partes = a.partes && a.partes.length ? a.partes.map(function (x) { return { p: x.p, m: typeof x.m === 'number' ? x.m : parseMonto(x.m) }; }) : [{ p: 'yo', m: v.c }];
      var e = validarPartes(data, partes, v.c, fecha); if (e) return err(e);
      var row = {
        id: id, fecha: fecha, nombre: nombre, monto: v.c, categoria: cat, tipo: tipo, medio: med,
        partes: partes, origen: a.origen || 'app', revisado: a.origen === 'atajo' ? false : true,
        creado: ctx.ahora || new Date().toISOString(), ejemplo: !!ctx.ejemplo
      };
      return okOps([{ op: 'add', tabla: 'gastos', row: row }], { gasto: row, regla: cl.regla });
    },
    reclasificar: function (data, a) {
      var g = buscar(data.gastos, a.id); if (!g) return err('No encuentro ese gasto.');
      if (CATEGORIAS.indexOf(a.categoria) < 0) return err('Elige una categoría de la lista.');
      var tipo = TIPOS.indexOf(a.tipoGasto) >= 0 ? a.tipoGasto : TIPO_POR_CATEGORIA[a.categoria];
      var ops = [{ op: 'update', tabla: 'gastos', id: g.id, cambios: { categoria: a.categoria, tipo: tipo, revisado: true } }];
      var palabra = palabraParaRegla(g.nombre);
      if (a.aprender !== false && palabra) {
        var r = buscar(data.reglas, palabra, 'palabra');
        var nueva = { palabra: palabra, categoria: a.categoria, tipo: tipo, origen: 'usuario' };
        ops.push(r ? { op: 'update', tabla: 'reglas', id: palabra, cambios: nueva } : { op: 'add', tabla: 'reglas', row: nueva });
      }
      return okOps(ops, { palabra: palabra });
    },
    marcarRevisado: function (data, a) {
      var ops = (a.ids || []).filter(function (id) { return buscar(data.gastos, id); })
        .map(function (id) { return { op: 'update', tabla: 'gastos', id: id, cambios: { revisado: true } }; });
      return okOps(ops);
    },
    borrarGasto: function (data, a) {
      if (!buscar(data.gastos, a.id)) return okOps([]);
      return okOps([{ op: 'delete', tabla: 'gastos', id: a.id }]);
    },
    agregarCuota: function (data, a, ctx) {
      var nombre = String(a.nombre || '').trim(); if (!nombre) return err('Escribe qué compraste en cuotas.');
      if (!fechaValida(a.fechaInicio)) return err('Elige la fecha de la primera cuota.');
      var v = validarMonto(a.total, 'el monto total'); if (v.error) return err(v.error);
      var n = parseInt(a.numCuotas, 10);
      if (!(n >= 1 && n <= 120) || String(n) !== String(a.numCuotas).trim()) return err('El número de cuotas tiene que ser un número entero entre 1 y 120.');
      if (v.c < n) return err('El monto total es muy pequeño para ' + n + ' cuotas.');
      var dueno = a.dueno || 'yo';
      if (dueno !== 'yo') {
        var p = buscar(data.personas, dueno); if (!p) return err('No encuentro a esa persona.');
        if (p.tipo !== 'permanente') return err('Las cuotas duran varios meses: ' + p.nombre + ' tiene que ser una persona permanente.');
      }
      if (!buscar(data.tarjetas, a.tarjeta)) return err('Elige la tarjeta de la cuota.');
      var id = a.id || nuevoId(ctx, 'c');
      if (buscar(data.cuotas, id)) return { ok: true, ops: [], info: { duplicado: true } };
      var cl = clasificar(nombre, data.reglas);
      var cat = CATEGORIAS.indexOf(a.categoria) >= 0 ? a.categoria : cl.categoria;
      var row = { id: id, nombre: nombre, fechaInicio: a.fechaInicio, total: v.c, numCuotas: n, dueno: dueno,
        tarjeta: a.tarjeta, categoria: cat, tipo: TIPOS.indexOf(a.tipoGasto) >= 0 ? a.tipoGasto : (a.categoria ? TIPO_POR_CATEGORIA[cat] : cl.tipo),
        ejemplo: !!ctx.ejemplo };
      var cal = calendarioCuota(row);
      row.montoCuota = cal[0].monto; row.fechaFinal = cal[cal.length - 1].fecha;
      return okOps([{ op: 'add', tabla: 'cuotas', row: row }], { calendario: cal });
    },
    borrarCuota: function (data, a) {
      if (!buscar(data.cuotas, a.id)) return okOps([]);
      return okOps([{ op: 'delete', tabla: 'cuotas', id: a.id }]);
    },
    pagarTarjeta: function (data, a, ctx) {
      var t = buscar(data.tarjetas, a.tarjeta); if (!t) return err('Elige la tarjeta que vas a pagar.');
      var c = buscar(data.cuentas, a.cuenta); if (!c) return err('Elige la cuenta desde donde pagas.');
      var v = validarMonto(a.monto, 'el monto del pago'); if (v.error) return err(v.error);
      var fecha = a.fecha || ctx.hoy; if (!fechaValida(fecha)) return err('La fecha no es válida.');
      var id = a.id || nuevoId(ctx, 'p');
      if (buscar(data.pagos, id)) return { ok: true, ops: [], info: { duplicado: true } };
      var deuda = deudaTarjeta(data, t.id, ctx.hoy);
      if (deuda <= 0) return err(t.nombre + ' no tiene deuda pendiente.');
      if (v.c > deuda) return err('El pago (' + fmtQ(v.c) + ') es mayor que la deuda de ' + t.nombre + ' (' + fmtQ(deuda) + '). Puedes pagar como máximo ' + fmtQ(deuda) + '.');
      var saldo = saldoCuenta(data, c.id);
      if (v.c > saldo) return err(c.nombre + ' tiene ' + fmtQ(saldo) + '. No alcanza para pagar ' + fmtQ(v.c) + '.');
      return okOps([{ op: 'add', tabla: 'pagos', row: { id: id, fecha: fecha, tarjeta: t.id, cuenta: c.id, monto: v.c, ejemplo: !!ctx.ejemplo } }]);
    },
    agregarIngreso: function (data, a, ctx) {
      var c = buscar(data.cuentas, a.cuenta); if (!c) return err('Elige la cuenta donde entró el dinero.');
      var v = validarMonto(a.monto, 'el monto del ingreso'); if (v.error) return err(v.error);
      var fecha = a.fecha || ctx.hoy; if (!fechaValida(fecha)) return err('La fecha no es válida.');
      var id = a.id || nuevoId(ctx, 'i');
      if (buscar(data.ingresos, id)) return { ok: true, ops: [], info: { duplicado: true } };
      return okOps([{ op: 'add', tabla: 'ingresos', row: { id: id, fecha: fecha, cuenta: c.id,
        descripcion: String(a.descripcion || 'Ingreso').trim() || 'Ingreso', monto: v.c, ejemplo: !!ctx.ejemplo } }]);
    },
    agregarPersona: function (data, a, ctx) {
      var nombre = String(a.nombre || '').trim(); if (!nombre) return err('Escribe el nombre de la persona.');
      var tipo = a.clase === 'mes' ? 'mes' : 'permanente';
      var mes = tipo === 'mes' ? (a.mes || mesDe(ctx.hoy)) : '';
      if (tipo === 'mes' && !/^\d{4}-\d{2}$/.test(mes)) return err('Elige el mes de esta persona.');
      var id = a.id || slug(nombre), base = id, k = 2;
      if (a.id && buscar(data.personas, a.id)) return { ok: true, ops: [], info: { duplicado: true } };
      while (id === 'yo' || buscar(data.personas, id)) id = base + '-' + (k++);
      return okOps([{ op: 'add', tabla: 'personas', row: { id: id, nombre: nombre, tipo: tipo, mes: mes, ejemplo: !!ctx.ejemplo } }], { id: id });
    },
    borrarPersona: function (data, a) {
      var p = buscar(data.personas, a.id); if (!p) return okOps([]);
      var usada = data.gastos.some(function (g) { return g.partes.some(function (x) { return x.p === p.id; }); }) ||
        data.cuotas.some(function (c) { return c.dueno === p.id; });
      if (usada) return err(p.nombre + ' tiene gastos o cuotas registrados. Bórralos primero.');
      return okOps([{ op: 'delete', tabla: 'personas', id: p.id }]);
    },
    guardarPresupuesto: function (data, a) {
      if (CATEGORIAS.indexOf(a.categoria) < 0) return err('Categoría no válida.');
      var c = a.monto === '' || a.monto === null || a.monto === undefined ? 0 : parseMonto(a.monto);
      if (c === null || c < 0) return err('Escribe un límite válido, o 0 para quitarlo.');
      var ex = buscar(data.presupuesto, a.categoria, 'categoria');
      if (c === 0) return okOps(ex ? [{ op: 'delete', tabla: 'presupuesto', id: a.categoria }] : []);
      return okOps([ex ? { op: 'update', tabla: 'presupuesto', id: a.categoria, cambios: { monto: c, ejemplo: false } }
        : { op: 'add', tabla: 'presupuesto', row: { categoria: a.categoria, monto: c, ejemplo: false } }]);
    },
    editarBanco: function (data, a) { // tarjeta o cuenta
      var tabla = a.tabla === 'cuentas' ? 'cuentas' : 'tarjetas';
      var x = buscar(data[tabla], a.id); if (!x) return err('No encuentro esa ' + (tabla === 'cuentas' ? 'cuenta' : 'tarjeta') + '.');
      var nombre = String(a.nombre || '').trim(); if (!nombre) return err('Escribe un nombre.');
      var ini = a.inicial === '' || a.inicial === undefined ? 0 : parseMonto(a.inicial);
      if (ini === null || ini < 0) return err('El monto inicial no es válido.');
      if (!/^#[0-9a-fA-F]{6}$/.test(a.color || '')) return err('Elige un color.');
      return okOps([{ op: 'update', tabla: tabla, id: x.id, cambios: { nombre: nombre, banco: String(a.banco || '').trim(), color: a.color, inicial: ini } }]);
    },
    borrarEjemplos: function (data) {
      var ops = [];
      NOMBRES_TABLAS.forEach(function (t) {
        var k = TABLAS[t].clave;
        (data[t] || []).forEach(function (r) { if (r.ejemplo) ops.push({ op: 'delete', tabla: t, id: r[k] }); });
      });
      return okOps(ops, { borrados: ops.length });
    }
  };

  function aplicar(data, accion, ctx) {
    ctx = ctx || {};
    var f = acciones[accion && accion.tipo];
    if (!f) return err('Acción desconocida.');
    try { return f(data, accion, ctx); } catch (e) { return err('Error: ' + (e && e.message || e)); }
  }

  // Aplica las operaciones sobre los datos en memoria (la app y las pruebas).
  function aplicarOps(data, ops) {
    ops.forEach(function (o) {
      var t = TABLAS[o.tabla], lista = data[o.tabla], k = t.clave;
      if (o.op === 'add') lista.push(JSON.parse(JSON.stringify(o.row)));
      else {
        for (var i = 0; i < lista.length; i++) if (lista[i][k] === o.id) {
          if (o.op === 'delete') lista.splice(i, 1);
          else Object.keys(o.cambios).forEach(function (c) { lista[i][c] = o.cambios[c]; });
          break;
        }
      }
    });
    return data;
  }

  // Atajo de iPhone: nombre, monto y tarjeta opcional (acepta ID, nombre o banco).
  function accionAtajo(data, q) {
    var med = null, t = String(q.tarjeta || '').trim();
    if (/^ultima/.test(normalizar(t))) t = ''; // "Última usada"
    if (t) {
      var n = normalizar(t);
      data.tarjetas.concat(data.cuentas).forEach(function (x) {
        if (!med && (normalizar(x.id) === n || normalizar(x.nombre) === n || normalizar(x.banco) === n)) med = x.id;
      });
      if (!med) return { error: 'No encuentro la tarjeta "' + t + '".' };
    }
    return { accion: { tipo: 'agregarGasto', nombre: q.nombre, monto: q.monto, medio: med || undefined, origen: 'atajo' } };
  }

  /* ---------- Datos iniciales y de ejemplo ---------- */
  function vacio() { var d = {}; NOMBRES_TABLAS.forEach(function (t) { d[t] = []; }); return d; }
  function datosBase() {
    var d = vacio();
    d.tarjetas = [
      { id: 'tc-bi', nombre: 'Visa BI', banco: 'Banco Industrial', color: '#1F4E9C', inicial: 0 },
      { id: 'tc-bac', nombre: 'Mastercard BAC', banco: 'BAC Credomatic', color: '#C8102E', inicial: 0 },
      { id: 'tc-pro', nombre: 'Visa Promerica', banco: 'Promerica', color: '#0E7C86', inicial: 0 }
    ];
    d.cuentas = [
      { id: 'cta-bi', nombre: 'Monetaria BI', banco: 'Banco Industrial', color: '#1F4E9C', inicial: 0 },
      { id: 'cta-banrural', nombre: 'Ahorro Banrural', banco: 'Banrural', color: '#0B7A3E', inicial: 0 },
      { id: 'cta-bam', nombre: 'Monetaria BAM', banco: 'BAM', color: '#D9661F', inicial: 0 },
      { id: 'cta-gyt', nombre: 'Ahorro G&T', banco: 'G&T Continental', color: '#B8860B', inicial: 0 }
    ];
    d.reglas = REGLAS_BASE.map(function (r) { return { palabra: r.palabra, categoria: r.categoria, tipo: r.tipo, origen: r.origen }; });
    return d;
  }
  // Acciones de ejemplo relativas al mes actual (se marcan con ejemplo = TRUE).
  function accionesEjemplo(hoy) {
    var ym = mesDe(hoy), ant = sumarMeses(ym, -1);
    var d = function (m, dia) { return m + '-' + pad(Math.min(dia, diasDelMes(+m.slice(0, 4), +m.slice(5, 7)))); };
    var dHoy = +hoy.slice(8, 10), dd = function (dia) { return d(ym, Math.min(dia, dHoy)); };
    var m31 = sumarMeses(ym, -2); // mes con 31 días para la cuota que empieza el 31
    while (diasDelMes(+m31.slice(0, 4), +m31.slice(5, 7)) !== 31) m31 = sumarMeses(m31, -1);
    return [
      { tipo: 'agregarPersona', id: 'ana', nombre: 'Ana', clase: 'permanente' },
      { tipo: 'agregarPersona', id: 'luis', nombre: 'Luis', clase: 'mes', mes: ym },
      { tipo: 'agregarIngreso', id: 'ej-i1', fecha: dd(1), cuenta: 'cta-bi', descripcion: 'Salario', monto: '9500' },
      { tipo: 'agregarIngreso', id: 'ej-i2', fecha: dd(1), cuenta: 'cta-banrural', descripcion: 'Ahorro inicial', monto: '3000' },
      { tipo: 'agregarGasto', id: 'ej-g1', fecha: dd(2), nombre: 'Súper La Torre', monto: '642.35', medio: 'tc-bi' },
      { tipo: 'agregarGasto', id: 'ej-g2', fecha: dd(3), nombre: 'Gasolina', monto: '250', medio: 'tc-bac' },
      { tipo: 'agregarGasto', id: 'ej-g3', fecha: dd(4), nombre: 'Almuerzo Campero', monto: '100.01', medio: 'tc-bi',
        partes: dividirIguales(10001, ['yo', 'ana', 'luis']) },
      { tipo: 'agregarGasto', id: 'ej-g4', fecha: dd(5), nombre: 'Netflix', monto: '79', medio: 'tc-pro' },
      { tipo: 'agregarGasto', id: 'ej-g5', fecha: dd(6), nombre: 'Medicina farmacia', monto: '185.50', medio: 'tc-bac', partes: [{ p: 'ana', m: 18550 }] },
      { tipo: 'agregarGasto', id: 'ej-g6', fecha: dd(7), nombre: 'Luz EEGSA', monto: '310.40', medio: 'cta-bi' },
      { tipo: 'agregarGasto', id: 'ej-g7', fecha: dd(8), nombre: 'Café', monto: '28', medio: 'tc-bi' },
      { tipo: 'agregarGasto', id: 'ej-g8', fecha: d(ant, 15), nombre: 'Cine', monto: '120', medio: 'tc-bi' },
      { tipo: 'agregarCuota', id: 'ej-c1', nombre: 'Celular', fechaInicio: m31 + '-31', total: '4999', numCuotas: '12', dueno: 'yo', tarjeta: 'tc-bi' },
      { tipo: 'agregarCuota', id: 'ej-c2', nombre: 'Laptop de Ana', fechaInicio: d(ant, 10), total: '6000', numCuotas: '6', dueno: 'ana', tarjeta: 'tc-bac', categoria: 'Educación' },
      { tipo: 'pagarTarjeta', id: 'ej-p1', fecha: dd(9), tarjeta: 'tc-bi', cuenta: 'cta-bi', monto: '500' },
      { tipo: 'guardarPresupuesto', categoria: 'Alimentación – supermercado', monto: '1800' },
      { tipo: 'guardarPresupuesto', categoria: 'Alimentación – comidas fuera', monto: '50' },
      { tipo: 'guardarPresupuesto', categoria: 'Transporte', monto: '900' },
      { tipo: 'guardarPresupuesto', categoria: 'Suscripciones', monto: '80' }
    ];
  }
  // Inserta los ejemplos sobre `data` y devuelve todas las operaciones aplicadas.
  function sembrarEjemplos(data, ctx) {
    var todas = [];
    accionesEjemplo(ctx.hoy).forEach(function (a) {
      var res = aplicar(data, a, { hoy: ctx.hoy, ahora: ctx.ahora, ejemplo: true });
      if (!res.ok) throw new Error('Ejemplo inválido (' + a.tipo + '): ' + res.error);
      res.ops.forEach(function (o) { if (o.op === 'add') o.row.ejemplo = true; if (o.cambios) o.cambios.ejemplo = true; });
      aplicarOps(data, res.ops); todas = todas.concat(res.ops);
    });
    return todas;
  }

  /* ---------- Conversión fila de hoja <-> objeto ---------- */
  function aFila(tabla, obj) {
    return TABLAS[tabla].cols.map(function (c) {
      var k = c[0], t = c[2], v = obj[k];
      if (tabla === 'gastos' && k === 'miParte') return miParte(obj) / 100;
      if (tabla === 'cuotas' && k === 'montoCuota') { var e = calendarioCuota(obj); return e[0].monto / 100; }
      if (tabla === 'cuotas' && k === 'fechaFinal') { var f = calendarioCuota(obj); return f[f.length - 1].fecha; }
      if (t === 'money') return (v || 0) / 100;
      if (t === 'bool') return !!v;
      if (t === 'reparto') return codificarReparto(v);
      if (t === 'int') return v || 0;
      return v === undefined || v === null ? '' : String(v);
    });
  }
  function deFila(tabla, fila, fmtFecha) {
    var o = {};
    TABLAS[tabla].cols.forEach(function (c, i) {
      var k = c[0], t = c[2], v = fila[i];
      if (t === 'derived') return;
      if (v instanceof Date) v = fmtFecha ? fmtFecha(v) : v.toISOString().slice(0, 10);
      if (t === 'money') o[k] = v === '' || v === null ? 0 : (parseMonto(v) || 0);
      else if (t === 'int') o[k] = parseInt(v, 10) || 0;
      else if (t === 'bool') o[k] = v === true || String(v).toUpperCase() === 'TRUE' || v === 'Sí';
      else if (t === 'reparto') o[k] = decodificarReparto(v);
      else o[k] = v === null || v === undefined ? '' : String(v).trim();
    });
    return o;
  }

  return {
    CATEGORIAS: CATEGORIAS, TIPOS: TIPOS, TIPO_POR_CATEGORIA: TIPO_POR_CATEGORIA, TABLAS: TABLAS,
    NOMBRES_TABLAS: NOMBRES_TABLAS, REGLAS_BASE: REGLAS_BASE, ALERTA_PCT: ALERTA_PCT,
    parseMonto: parseMonto, fmtQ: fmtQ, decimal: decimal, montoValido: montoValido,
    fechaValida: fechaValida, diasDelMes: diasDelMes, mesDe: mesDe, sumarMeses: sumarMeses,
    nombreMes: nombreMes, fechaCorta: fechaCorta, normalizar: normalizar, clasificar: clasificar,
    palabraParaRegla: palabraParaRegla, dividirIguales: dividirIguales, codificarReparto: codificarReparto,
    decodificarReparto: decodificarReparto, miParte: miParte, calendarioCuota: calendarioCuota,
    cuotasDelMes: cuotasDelMes, estadoCuota: estadoCuota, buscar: buscar, medio: medio,
    deudaTarjeta: deudaTarjeta, saldoCuenta: saldoCuenta, ultimoMedio: ultimoMedio,
    personasDelMes: personasDelMes, nombrePersona: nombrePersona, recuento: recuento,
    presupuestoMes: presupuestoMes, mesesConActividad: mesesConActividad, aplicar: aplicar,
    aplicarOps: aplicarOps, accionAtajo: accionAtajo, vacio: vacio, datosBase: datosBase,
    sembrarEjemplos: sembrarEjemplos, aFila: aFila, deFila: deFila
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Core;

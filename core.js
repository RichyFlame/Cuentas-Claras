/* =====================================================================
   Cuentas Claras — núcleo compartido (versión 2)
   Este MISMO archivo se usa en la web app (core.js) y en Apps Script
   (pégalo como Core.gs). Todas las reglas de negocio viven aquí para
   que la app y el servidor calculen exactamente lo mismo.
   Todos los montos se manejan en CENTAVOS ENTEROS (Q1.00 = 100).

   Mes contable: una compra con tarjeta pertenece al mes en que CORTA
   su ciclo (corte 27: del 28 sep al 27 oct = octubre). Lo que se paga
   con una cuenta pertenece a su mes calendario.
   ===================================================================== */
var Core = (function () {
  'use strict';

  var VERSION = 2;

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
  var ALERTA_PCT = 80;       // desde este % del presupuesto se avisa "cerca"
  var DIAS_AVISO_PAGO = 5;   // aviso de pago de tarjeta: 5 días antes

  /* ---------- Estructura de las hojas ----------
     [clave interna, encabezado en la hoja, tipo]
     tipos: text | date | money | int | bool | boolSi (vacío = sí) | reparto | derived
     Las columnas se leen y escriben por ENCABEZADO: agregar columnas nuevas
     al final de una hoja existente no rompe nada. */
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
      ['fechaFinal', 'Última cuota', 'derived'], ['ejemplo', 'Ejemplo', 'bool'],
      ['partes', 'Reparto', 'reparto']] },
    tarjetas: { hoja: 'Tarjetas', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['nombre', 'Nombre', 'text'], ['banco', 'Banco', 'text'],
      ['color', 'Color', 'text'], ['inicial', 'Deuda inicial (Q)', 'money'],
      ['corte', 'Día de corte', 'int'], ['pago', 'Día de pago', 'int'], ['activa', 'Activa', 'boolSi']] },
    cuentas: { hoja: 'Cuentas', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['nombre', 'Nombre', 'text'], ['banco', 'Banco', 'text'],
      ['color', 'Color', 'text'], ['inicial', 'Saldo inicial (Q)', 'money'], ['activa', 'Activa', 'boolSi']] },
    pagos: { hoja: 'Pagos', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['fecha', 'Fecha', 'date'], ['tarjeta', 'Tarjeta', 'text'],
      ['cuenta', 'Desde cuenta', 'text'], ['monto', 'Monto (Q)', 'money'], ['ejemplo', 'Ejemplo', 'bool']] },
    ingresos: { hoja: 'Ingresos', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['fecha', 'Fecha', 'date'], ['cuenta', 'Cuenta', 'text'],
      ['descripcion', 'Descripción', 'text'], ['monto', 'Monto (Q)', 'money'], ['ejemplo', 'Ejemplo', 'bool']] },
    retiros: { hoja: 'Retiros', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['fecha', 'Fecha', 'date'], ['cuenta', 'Cuenta', 'text'],
      ['descripcion', 'Descripción', 'text'], ['monto', 'Monto (Q)', 'money'], ['ejemplo', 'Ejemplo', 'bool']] },
    transferencias: { hoja: 'Transferencias', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['fecha', 'Fecha', 'date'], ['origen', 'Desde cuenta', 'text'], ['destino', 'Hacia cuenta', 'text'],
      ['descripcion', 'Descripción', 'text'], ['monto', 'Monto (Q)', 'money'], ['ejemplo', 'Ejemplo', 'bool']] },
    personas: { hoja: 'Personas', clave: 'id', cols: [
      ['id', 'ID', 'text'], ['nombre', 'Nombre', 'text'], ['tipo', 'Tipo', 'text'],
      ['mes', 'Mes (si es de un mes)', 'text'], ['ejemplo', 'Ejemplo', 'bool'], ['activa', 'Activa', 'boolSi']] },
    reglas: { hoja: 'Reglas', clave: 'palabra', cols: [
      ['palabra', 'Palabra clave', 'text'], ['categoria', 'Categoría', 'text'],
      ['tipo', 'Tipo', 'text'], ['origen', 'Origen', 'text']] },
    presupuesto: { hoja: 'Presupuesto', clave: 'categoria', cols: [
      ['categoria', 'Categoría', 'text'], ['monto', 'Límite mensual (Q)', 'money'], ['ejemplo', 'Ejemplo', 'bool']] }
  };
  var NOMBRES_TABLAS = Object.keys(TABLAS);

  /* ---------- Montos ---------- */
  function parseMonto(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : null;
    var s = String(v).trim().replace(/^q\.?\s*/i, '').replace(/\s+/g, '');
    if (!s) return null;
    var neg = false;
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    s = s.replace(/^q\.?/i, '');
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
    var p = s.split('.');
    var ent = parseInt(p[0] || '0', 10), dec = (p[1] || ''), cent;
    if (dec.length <= 2) cent = parseInt((dec + '00').slice(0, 2), 10);
    else cent = Math.round(parseFloat('0.' + dec) * 100);
    var total = ent * 100 + cent;
    return neg ? -total : total;
  }
  function decimal(c) {
    var neg = c < 0; c = Math.abs(c);
    return (neg ? '-' : '') + Math.floor(c / 100) + '.' + ('0' + (c % 100)).slice(-2);
  }
  function fmtQ(c) {
    c = Math.round(c || 0);
    var neg = c < 0; c = Math.abs(c);
    var ent = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + 'Q' + ent + '.' + ('0' + (c % 100)).slice(-2);
  }
  function montoValido(c) { return typeof c === 'number' && c > 0 && c <= 10000000000; }

  /* ---------- Fechas (texto AAAA-MM-DD) ---------- */
  function diasDelMes(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function fechaValida(f) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f || ''))) return false;
    var y = +f.slice(0, 4), m = +f.slice(5, 7), d = +f.slice(8, 10);
    return m >= 1 && m <= 12 && d >= 1 && d <= diasDelMes(y, m);
  }
  function mesDe(f) { return String(f).slice(0, 7); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function sumarMeses(ym, k) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  }
  function diaEn(ym, d) { return ym + '-' + pad(Math.min(d, diasDelMes(+ym.slice(0, 4), +ym.slice(5, 7)))); }
  function utc(f) { return Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)); }
  function sumarDias(f, k) { return new Date(utc(f) + k * 864e5).toISOString().slice(0, 10); }
  function diasEntre(a, b) { return Math.round((utc(b) - utc(a)) / 864e5); }
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function nombreMes(ym) { return MESES[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
  function fechaCorta(f) { return +f.slice(8, 10) + ' ' + MESES[+f.slice(5, 7) - 1].slice(0, 3) + ' ' + f.slice(0, 4); }
  function diaMes(f) { return +f.slice(8, 10) + ' ' + MESES[+f.slice(5, 7) - 1].slice(0, 3); }

  /* ---------- Texto y clasificación ---------- */
  function normalizar(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function singular(n) {
    return n.split(' ').map(function (t) { return t.length > 3 && /s$/.test(t) ? t.slice(0, -1) : t; }).join(' ');
  }
  function clasificar(nombre, reglas) {
    var n = normalizar(nombre);
    var textos = [' ' + n + ' ', ' ' + singular(n) + ' '];
    var mejor = null, mejorPts = -1;
    (reglas || []).forEach(function (r) {
      var kw = normalizar(r.palabra);
      if (!kw || CATEGORIAS.indexOf(r.categoria) < 0) return;
      if (textos[0].indexOf(' ' + kw + ' ') < 0 && textos[1].indexOf(' ' + kw + ' ') < 0) return;
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
      'Deudas y tarjetas': 'prestamo,cuota prestamo,pago tarjeta,abono,intereses,deuda,terreno,hermana,tio',
      'Suscripciones': 'netflix,spotify,disney,hbo,youtube premium,youtube,icloud,amazon prime,prime video,chatgpt,apple music,game pass,suscripcion,membresia,crunchyroll',
      'Entretenimiento': 'cine,cinepolis,cinemark,concierto,bar,cerveza,fiesta,juego,videojuego,steam,boliche,paseo,entrada,karaoke',
      'Ropa y cuidado personal': 'ropa,zapato,tenis,camisa,pantalon,vestido,corte de pelo,barberia,salon,perfume,cosmetico,siman,zara,shampoo',
      'Familia y regalos': 'regalo,cumpleanos,mama,papa,donacion,ofrenda,diezmo,iglesia,boda,baby shower',
      'Ahorro': 'ahorro,fondo de emergencia,deposito ahorro,ahorro bloqueado'
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
  function sumaPartes(partes, quien) {
    return (partes || []).reduce(function (a, x) { return a + (!quien || x.p === quien ? x.m : 0); }, 0);
  }
  function miParte(g) { return sumaPartes(g.partes, 'yo'); }

  /* ---------- Búsquedas ---------- */
  function buscar(lista, id, clave) { clave = clave || 'id'; for (var i = 0; i < (lista || []).length; i++) if (lista[i][clave] === id) return lista[i]; return null; }
  function activo(x) { return x && x.activa !== false; }
  function medio(data, id) {
    var t = buscar(data.tarjetas, id); if (t) return { tipo: 'tarjeta', obj: t };
    var c = buscar(data.cuentas, id); if (c) return { tipo: 'cuenta', obj: c };
    return null;
  }
  function nombrePersona(data, id) {
    if (id === 'yo') return 'Yo'; var p = buscar(data.personas, id); return p ? p.nombre : id;
  }

  /* ---------- Cortes de tarjeta ---------- */
  function tieneCorte(t) { return !!t && t.corte >= 1 && t.corte <= 31; }
  function corteDelMes(t, ym) { return diaEn(ym, t.corte); }
  function ultimoCorte(t, hoy) { var c = corteDelMes(t, mesDe(hoy)); return c <= hoy ? c : corteDelMes(t, sumarMeses(mesDe(hoy), -1)); }
  function siguienteCorte(t, hoy) { var c = corteDelMes(t, mesDe(hoy)); return c > hoy ? c : corteDelMes(t, sumarMeses(mesDe(hoy), 1)); }
  // Fecha límite de pago del estado que cierra en `corte` (el mismo día o después).
  function fechaPagoDe(t, corte) {
    var dia = t.pago >= 1 && t.pago <= 31 ? t.pago : t.corte;
    var p = diaEn(mesDe(corte), dia);
    return p >= corte ? p : diaEn(sumarMeses(mesDe(corte), 1), dia);
  }
  // Mes al que pertenece un movimiento según su tarjeta (ciclo) o su cuenta (calendario).
  function mesContable(data, medioId, fecha) {
    var t = buscar(data.tarjetas, medioId);
    if (!tieneCorte(t)) return mesDe(fecha);
    return fecha <= corteDelMes(t, mesDe(fecha)) ? mesDe(fecha) : sumarMeses(mesDe(fecha), 1);
  }
  function cicloDelMes(t, ym) {
    if (!tieneCorte(t)) return { desde: ym + '-01', hasta: diaEn(ym, 31), pago: null };
    var hasta = corteDelMes(t, ym);
    return { desde: sumarDias(corteDelMes(t, sumarMeses(ym, -1)), 1), hasta: hasta, pago: fechaPagoDe(t, hasta) };
  }

  /* ---------- Cuotas ---------- */
  function partesCuota(c) {
    var p = decodificarReparto(c.partes);
    return p.length ? p : [{ p: c.dueno || 'yo', m: c.total }];
  }
  // Calendario completo. Día 31 en mes corto -> último día del mes.
  // Cada persona paga su parte en cuotas iguales; la última cuota absorbe la diferencia.
  function calendarioCuota(c) {
    var n = c.numCuotas, ini = mesDe(c.fechaInicio), dia = +c.fechaInicio.slice(8, 10);
    var partes = partesCuota(c), out = [];
    for (var i = 0; i < n; i++) {
      var ult = i === n - 1;
      var pi = partes.map(function (x) { var b = Math.floor(x.m / n); return { p: x.p, m: ult ? x.m - b * (n - 1) : b }; });
      out.push({
        cuotaId: c.id, nombre: c.nombre, n: i + 1, de: n, fecha: diaEn(sumarMeses(ini, i), dia),
        monto: sumaPartes(pi), partes: pi, tarjeta: c.tarjeta, categoria: c.categoria, tipo: c.tipo
      });
    }
    return out;
  }
  function estadoCuota(c, hoy) {
    var cal = calendarioCuota(c), hechas = 0, prox = null;
    cal.forEach(function (x) { if (x.fecha <= hoy) hechas++; else if (!prox) prox = x; });
    return { calendario: cal, cargadas: hechas, proxima: prox, final: cal[cal.length - 1].fecha, montoCuota: cal[0].monto };
  }
  function describirDueno(data, partes) {
    if (partes.length === 1) return nombrePersona(data, partes[0].p);
    return partes.map(function (x) { return nombrePersona(data, x.p); }).join(', ');
  }

  /* ---------- Saldos y estados de cuenta ---------- */
  function cargosHasta(data, id, fecha) {
    var t = buscar(data.tarjetas, id), d = t ? (t.inicial || 0) : 0;
    data.gastos.forEach(function (g) { if (g.medio === id && (!fecha || g.fecha <= fecha)) d += g.monto; });
    data.cuotas.forEach(function (c) {
      if (c.tarjeta !== id) return;
      calendarioCuota(c).forEach(function (x) { if (x.fecha <= fecha) d += x.monto; });
    });
    return d;
  }
  function pagosDe(data, id) { return data.pagos.reduce(function (a, p) { return a + (p.tarjeta === id ? p.monto : 0); }, 0); }
  // Todo lo cargado hasta hoy (incluye cuotas ya vencidas) − pagos. Solo se usa para validar.
  function deudaTarjeta(data, id, hoy) {
    var t = buscar(data.tarjetas, id); if (!t) return 0;
    var d = t.inicial || 0;
    data.gastos.forEach(function (g) { if (g.medio === id) d += g.monto; });
    data.cuotas.forEach(function (c) { if (c.tarjeta === id) calendarioCuota(c).forEach(function (x) { if (x.fecha <= hoy) d += x.monto; }); });
    return d - pagosDe(data, id);
  }
  function contadoAlCorte(data, id, corte) { return Math.max(0, cargosHasta(data, id, corte) - pagosDe(data, id)); }

  /* Estado de cuenta MES A MES de una tarjeta.
     Cada ciclo (mes contable) suma sus compras y SOLO la cuota de ese mes de cada compra en cuotas
     (lo que falta por pagar de las cuotas se ve en la sección Cuotas).
     Se empieza a contar desde el primer ciclo en que registraste algo con esa tarjeta, así las cuotas
     de meses anteriores a usar la app no aparecen como deuda.
     Los pagos se aplican al ciclo más antiguo que tenga saldo pendiente. */
  function ciclosTarjeta(data, id, hastaYm) {
    var t = buscar(data.tarjetas, id), porMes = {}, inicio = null;
    function suma(ym, k, m) { porMes[ym] = porMes[ym] || { compras: 0, cuotas: 0 }; porMes[ym][k] += m; }
    data.gastos.forEach(function (g) {
      if (g.medio !== id) return;
      var ym = mesContable(data, id, g.fecha); suma(ym, 'compras', g.monto);
      if (!inicio || ym < inicio) inicio = ym;
    });
    data.pagos.forEach(function (p) {
      if (p.tarjeta !== id) return;
      var ym = mesContable(data, id, p.fecha); if (!inicio || ym < inicio) inicio = ym;
    });
    if (!inicio || inicio > hastaYm) inicio = hastaYm;
    data.cuotas.forEach(function (c) {
      if (c.tarjeta !== id) return;
      calendarioCuota(c).forEach(function (x) { var ym = mesContable(data, id, x.fecha); if (ym >= inicio && ym <= hastaYm) suma(ym, 'cuotas', x.monto); });
    });
    var disponible = pagosDe(data, id), ciclos = [];
    for (var ym = inicio; ym <= hastaYm; ym = sumarMeses(ym, 1)) {
      var m = porMes[ym] || { compras: 0, cuotas: 0 }, total = m.compras + m.cuotas, pagado = Math.min(total, disponible);
      disponible -= pagado;
      ciclos.push({ mes: ym, ciclo: cicloDelMes(t, ym), compras: m.compras, cuotas: m.cuotas, total: total, pagado: pagado, pendiente: total - pagado });
    }
    return { ciclos: ciclos, aFavor: disponible };
  }
  function cicloVacio(t, ym) { return { mes: ym, ciclo: cicloDelMes(t, ym), compras: 0, cuotas: 0, total: 0, pagado: 0, pendiente: 0 }; }
  // Lo que importa este mes: el ciclo que toca pagar (el que cerró, si aún no vence y debe algo; si no, el que está abierto).
  function estadoTarjeta(data, id, hoy) {
    var t = buscar(data.tarjetas, id), e = { conCorte: tieneCorte(t) };
    var mesUlt, mesSig, pagoUlt = null;
    if (e.conCorte) {
      var ult = ultimoCorte(t, hoy), sig = siguienteCorte(t, hoy);
      mesUlt = mesDe(ult); mesSig = mesDe(sig); pagoUlt = fechaPagoDe(t, ult);
    } else { mesSig = mesDe(hoy); mesUlt = sumarMeses(mesSig, -1); }
    var r = ciclosTarjeta(data, id, mesSig);
    var busca = function (ym) { return r.ciclos.filter(function (c) { return c.mes === ym; })[0] || cicloVacio(t, ym); };
    var cUlt = busca(mesUlt), cSig = busca(mesSig);
    e.ciclo = e.conCorte && pagoUlt >= hoy && cUlt.pendiente > 0 ? cUlt : cSig;
    e.anteriores = r.ciclos.filter(function (c) { return c.mes < e.ciclo.mes; }).reduce(function (a, c) { return a + c.pendiente; }, 0);
    e.porPagar = e.anteriores + e.ciclo.pendiente;
    e.aFavor = r.aFavor; e.ciclos = r.ciclos; e.cicloUltimo = cUlt; e.cicloSiguiente = cSig;
    e.deuda = deudaTarjeta(data, id, hoy);
    return e;
  }
  // Máximo que se acepta como pago: lo cargado hasta el próximo corte (con la cuota de ese ciclo) − lo pagado.
  function limitePago(data, id, hoy) {
    var t = buscar(data.tarjetas, id); if (!t) return 0;
    var tope = tieneCorte(t) ? siguienteCorte(t, hoy) : diaEn(mesDe(hoy), 31);
    return Math.max(cargosHasta(data, id, tope) - pagosDe(data, id), estadoTarjeta(data, id, hoy).porPagar);
  }
  // Pagos de tarjeta que vencen dentro de `dias` días (0 = hoy), con lo pendiente de ese ciclo.
  function recordatorios(data, hoy, dias) {
    if (dias === undefined) dias = DIAS_AVISO_PAGO;
    var out = [];
    data.tarjetas.forEach(function (t) {
      if (!activo(t) || !tieneCorte(t)) return;
      var e = estadoTarjeta(data, t.id, hoy), vistos = {};
      [e.cicloUltimo, e.cicloSiguiente].forEach(function (c) {
        var pago = c.ciclo.pago, d = diasEntre(hoy, pago);
        if (vistos[pago] || d < 0 || d > dias || c.pendiente <= 0) return; vistos[pago] = 1;
        out.push({ tarjeta: t.id, nombre: t.nombre, corte: c.ciclo.hasta, pago: pago, dias: d, monto: c.pendiente, estimado: c.ciclo.hasta > hoy });
      });
    });
    return out.sort(function (a, b) { return a.pago.localeCompare(b.pago); });
  }
  function textoRecordatorio(r) {
    var cuando = r.dias === 0 ? 'hoy' : (r.dias === 1 ? 'mañana' : 'en ' + r.dias + ' días');
    return 'Paga ' + r.nombre + ' ' + cuando + ' (' + diaMes(r.pago) + '): ' + fmtQ(r.monto) + (r.estimado ? ' hasta ahora, corta el ' + diaMes(r.corte) : ' de contado');
  }
  function saldoCuenta(data, id) {
    var c = buscar(data.cuentas, id); if (!c) return 0;
    var s = c.inicial || 0;
    data.ingresos.forEach(function (i) { if (i.cuenta === id) s += i.monto; });
    (data.retiros || []).forEach(function (r) { if (r.cuenta === id) s -= r.monto; });
    (data.transferencias || []).forEach(function (t) { if (t.origen === id) s -= t.monto; if (t.destino === id) s += t.monto; });
    data.pagos.forEach(function (p) { if (p.cuenta === id) s -= p.monto; });
    data.gastos.forEach(function (g) { if (g.medio === id) s -= g.monto; });
    return s;
  }
  function ultimoMedio(data) {
    var ult = null;
    data.gastos.forEach(function (g) {
      var m = medio(data, g.medio); if (!m || !activo(m.obj)) return;
      if (!ult || (g.creado || '') >= (ult.creado || '')) ult = g;
    });
    if (ult) return ult.medio;
    var t = data.tarjetas.filter(activo)[0] || data.cuentas.filter(activo)[0];
    return t ? t.id : null;
  }

  /* ---------- Personas ---------- */
  function personasDelMes(data, ym) {
    return data.personas.filter(function (p) { return activo(p) && (p.tipo === 'permanente' || p.mes === ym); });
  }

  /* ---------- Recuento del mes (contable) ---------- */
  function recuento(data, ym) {
    var gastos = data.gastos.filter(function (g) { return mesContable(data, g.medio, g.fecha) === ym; });
    var cuotas = [];
    data.cuotas.forEach(function (c) {
      calendarioCuota(c).forEach(function (x) { if (mesContable(data, x.tarjeta, x.fecha) === ym) cuotas.push(x); });
    });
    var per = {}, orden = [];
    function asegura(id) {
      if (per[id]) return;
      per[id] = { id: id, nombre: nombrePersona(data, id), gastos: 0, cuotas: 0, porMedio: {} }; orden.push(id);
    }
    asegura('yo'); personasDelMes(data, ym).forEach(function (p) { asegura(p.id); });
    var total = 0, porMedio = {}, porCatMia = {}, porCatTodo = {};
    function sumar(partes, medioId, cat, clave) {
      partes.forEach(function (x) {
        asegura(x.p); per[x.p][clave] += x.m;
        per[x.p].porMedio[medioId] = (per[x.p].porMedio[medioId] || 0) + x.m;
        if (x.p === 'yo') porCatMia[cat] = (porCatMia[cat] || 0) + x.m;
      });
    }
    gastos.forEach(function (g) {
      total += g.monto; porMedio[g.medio] = (porMedio[g.medio] || 0) + g.monto;
      porCatTodo[g.categoria] = (porCatTodo[g.categoria] || 0) + g.monto;
      sumar(g.partes, g.medio, g.categoria, 'gastos');
    });
    cuotas.forEach(function (x) {
      total += x.monto; porMedio[x.tarjeta] = (porMedio[x.tarjeta] || 0) + x.monto;
      porCatTodo[x.categoria] = (porCatTodo[x.categoria] || 0) + x.monto;
      sumar(x.partes, x.tarjeta, x.categoria, 'cuotas');
    });
    var personas = orden.map(function (id) { var o = per[id]; o.total = o.gastos + o.cuotas; return o; });
    var tarjetas = data.tarjetas.filter(function (t) { return activo(t) || porMedio[t.id]; }).map(function (t) {
      var mio = per.yo.porMedio[t.id] || 0, tot = porMedio[t.id] || 0;
      return { id: t.id, ciclo: cicloDelMes(t, ym), total: tot, mio: mio, deOtros: tot - mio };
    });
    var suma = function (obj) { return Object.keys(obj).reduce(function (a, k) { return a + obj[k]; }, 0); };
    var mio = per.yo.total;
    var sumPer = personas.reduce(function (a, p) { return a + p.total; }, 0);
    return {
      mes: ym, total: total, mio: mio, deOtros: total - mio, personas: personas, tarjetas: tarjetas,
      porMedio: porMedio, porCategoriaMia: porCatMia, porCategoria: porCatTodo, gastos: gastos, cuotas: cuotas,
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
    data.gastos.forEach(function (g) { s[mesContable(data, g.medio, g.fecha)] = 1; });
    data.cuotas.forEach(function (c) { calendarioCuota(c).forEach(function (x) { s[mesContable(data, x.tarjeta, x.fecha)] = 1; }); });
    return Object.keys(s).sort();
  }

  /* ---------- Acciones -> operaciones ----------
     aplicar(data, accion, ctx) valida y devuelve {ok, ops, info} o {ok:false, error}.
     accion.tipo = nombre de la acción; Necesario/Prescindible viaja en accion.tipoGasto.
     ctx = { hoy:'AAAA-MM-DD', ahora:'ISO', id:function(prefijo){}, ejemplo:bool } */
  function err(msg) { return { ok: false, error: msg }; }
  function okOps(ops, info) { return { ok: true, ops: ops, info: info || {} }; }
  function dup() { return { ok: true, ops: [], info: { duplicado: true } }; }
  function nuevoId(ctx, pref) { return ctx && ctx.id ? ctx.id(pref) : pref + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function slug(s) { return normalizar(s).replace(/ /g, '-').slice(0, 20) || 'x'; }
  function idLibre(lista, base) { var id = base, k = 2; while (id === 'yo' || buscar(lista, id)) id = base + '-' + (k++); return id; }

  function validarMonto(v, que) {
    var c = parseMonto(v);
    if (v === '' || v === null || v === undefined || c === null) return { error: 'Escribe ' + (que || 'el monto') + '. Ejemplo: 45 o 45.50' };
    if (c <= 0) return { error: (que ? que.charAt(0).toUpperCase() + que.slice(1) : 'El monto') + ' tiene que ser mayor que cero.' };
    if (!montoValido(c)) return { error: 'Ese monto es demasiado grande.' };
    return { c: c };
  }
  function normalizarPartes(partes, total, porDefecto) {
    if (!partes || !partes.length) return [{ p: porDefecto || 'yo', m: total }];
    return partes.map(function (x) { return { p: x.p, m: typeof x.m === 'number' ? x.m : parseMonto(x.m) }; });
  }
  // opciones: { mes: 'AAAA-MM' (personas de un mes), permanentes: bool (cuotas) }
  function validarPartes(data, partes, total, op) {
    var vistos = {}, suma = 0;
    if (!partes.length) return 'Elige al menos una persona.';
    for (var i = 0; i < partes.length; i++) {
      var x = partes[i];
      if (vistos[x.p]) return 'Una persona aparece dos veces en el reparto.';
      vistos[x.p] = 1;
      if (x.p !== 'yo') {
        var per = buscar(data.personas, x.p);
        if (!per) return 'No encuentro a la persona "' + x.p + '".';
        var yaEstaba = (op.permitidos || []).indexOf(x.p) >= 0;
        if (!activo(per) && !yaEstaba) return per.nombre + ' ya no está en tu lista de personas.';
        if (op.permanentes && per.tipo !== 'permanente') return 'Las cuotas duran varios meses: ' + per.nombre + ' tiene que ser una persona permanente.';
        if (!op.permanentes && per.tipo === 'mes' && per.mes !== op.mes) return per.nombre + ' solo está registrada para ' + nombreMes(per.mes) + '.';
      }
      if (typeof x.m !== 'number' || x.m < 0 || Math.round(x.m) !== x.m) return 'Revisa los montos del reparto.';
      suma += x.m;
    }
    if (suma !== total) return 'El reparto suma ' + fmtQ(suma) + ' y el total es ' + fmtQ(total) + '. Ajusta los montos.';
    return null;
  }
  function validarDia(v, que) {
    var n = parseInt(v, 10);
    if (!(n >= 1 && n <= 31) || String(n) !== String(v).trim()) return { error: 'Escribe el día de ' + que + ' (un número del 1 al 31).' };
    return { n: n };
  }
  function usosDe(data, tabla, id) {
    if (tabla === 'tarjetas') return data.gastos.filter(function (g) { return g.medio === id; }).length +
      data.cuotas.filter(function (c) { return c.tarjeta === id; }).length + data.pagos.filter(function (p) { return p.tarjeta === id; }).length;
    if (tabla === 'cuentas') return data.gastos.filter(function (g) { return g.medio === id; }).length +
      data.pagos.filter(function (p) { return p.cuenta === id; }).length + data.ingresos.filter(function (i) { return i.cuenta === id; }).length +
      (data.retiros || []).filter(function (r) { return r.cuenta === id; }).length +
      (data.transferencias || []).filter(function (t) { return t.origen === id || t.destino === id; }).length;
    return data.gastos.filter(function (g) { return g.partes.some(function (x) { return x.p === id; }); }).length +
      data.cuotas.filter(function (c) { return partesCuota(c).some(function (x) { return x.p === id; }); }).length;
  }
  // Cuenta válida: activa, o la misma que ya tenía el registro que se está editando.
  function cuentaOk(data, id, previa) { var c = buscar(data.cuentas, id); return c && (activo(c) || id === previa) ? c : null; }
  // Ingresos y retiros: crear (editar = false) o editar (editar = true). Los retiros pueden dejar la cuenta en negativo.
  function movimientoCuenta(tabla, que, editar) {
    return function (data, a, ctx) {
      var antes = editar ? buscar(data[tabla], a.id) : null;
      if (editar && !antes) return err('No encuentro ese ' + que + '.');
      var c = cuentaOk(data, a.cuenta, antes && antes.cuenta); if (!c) return err('Elige la cuenta.');
      var v = validarMonto(a.monto, 'el monto del ' + que); if (v.error) return err(v.error);
      var fecha = a.fecha || ctx.hoy; if (!fechaValida(fecha)) return err('La fecha no es válida.');
      var desc = String(a.descripcion || '').trim() || (tabla === 'retiros' ? 'Retiro' : 'Ingreso');
      if (editar) return okOps([{ op: 'update', tabla: tabla, id: antes.id, cambios: { fecha: fecha, cuenta: c.id, descripcion: desc, monto: v.c } }]);
      var id = a.id || nuevoId(ctx, tabla === 'retiros' ? 'r' : 'i');
      if (buscar(data[tabla], id)) return dup();
      return okOps([{ op: 'add', tabla: tabla, row: { id: id, fecha: fecha, cuenta: c.id, descripcion: desc, monto: v.c, ejemplo: !!ctx.ejemplo } }]);
    };
  }
  // Transferencias entre tus cuentas: baja una y sube la otra por el mismo monto. No es gasto ni ingreso.
  function transferencia(editar) {
    return function (data, a, ctx) {
      var antes = editar ? buscar(data.transferencias, a.id) : null;
      if (editar && !antes) return err('No encuentro esa transferencia.');
      var o = cuentaOk(data, a.origen, antes && antes.origen); if (!o) return err('Elige la cuenta de donde sale el dinero.');
      var d = cuentaOk(data, a.destino, antes && antes.destino); if (!d) return err('Elige la cuenta a donde llega el dinero.');
      if (o.id === d.id) return err('La cuenta de origen y la de destino tienen que ser distintas.');
      var v = validarMonto(a.monto, 'el monto de la transferencia'); if (v.error) return err(v.error);
      var fecha = a.fecha || ctx.hoy; if (!fechaValida(fecha)) return err('La fecha no es válida.');
      var desc = String(a.descripcion || '').trim() || 'Transferencia';
      if (editar) return okOps([{ op: 'update', tabla: 'transferencias', id: antes.id, cambios: { fecha: fecha, origen: o.id, destino: d.id, descripcion: desc, monto: v.c } }]);
      var id = a.id || nuevoId(ctx, 't');
      if (buscar(data.transferencias, id)) return dup();
      return okOps([{ op: 'add', tabla: 'transferencias', row: { id: id, fecha: fecha, origen: o.id, destino: d.id, descripcion: desc, monto: v.c, ejemplo: !!ctx.ejemplo } }]);
    };
  }
  // Pagos de tarjeta: crear o editar. Al editar, el pago original no cuenta para los límites.
  function pagoTarjeta(editar) {
    return function (data, a, ctx) {
      var antes = editar ? buscar(data.pagos, a.id) : null;
      if (editar && !antes) return err('No encuentro ese pago.');
      var t = buscar(data.tarjetas, a.tarjeta); if (!t) return err('Elige la tarjeta que vas a pagar.');
      var c = cuentaOk(data, a.cuenta, antes && antes.cuenta); if (!c) return err('Elige la cuenta desde donde pagas.');
      var v = validarMonto(a.monto, 'el monto del pago'); if (v.error) return err(v.error);
      var fecha = a.fecha || ctx.hoy; if (!fechaValida(fecha)) return err('La fecha no es válida.');
      if (!editar) { var id0 = a.id || nuevoId(ctx, 'p'); if (buscar(data.pagos, id0)) return dup(); }
      var deuda = limitePago(data, t.id, ctx.hoy) + (antes && antes.tarjeta === t.id ? antes.monto : 0);
      if (deuda <= 0) return err(t.nombre + ' no tiene deuda pendiente.');
      if (v.c > deuda) return err('El pago (' + fmtQ(v.c) + ') es mayor que la deuda de ' + t.nombre + ' (' + fmtQ(deuda) + '). Puedes pagar como máximo ' + fmtQ(deuda) + '.');
      var saldo = saldoCuenta(data, c.id) + (antes && antes.cuenta === c.id ? antes.monto : 0);
      if (v.c > saldo) return err(c.nombre + ' tiene ' + fmtQ(saldo) + '. No alcanza para pagar ' + fmtQ(v.c) + '.');
      if (editar) return okOps([{ op: 'update', tabla: 'pagos', id: antes.id, cambios: { fecha: fecha, tarjeta: t.id, cuenta: c.id, monto: v.c } }]);
      return okOps([{ op: 'add', tabla: 'pagos', row: { id: id0, fecha: fecha, tarjeta: t.id, cuenta: c.id, monto: v.c, ejemplo: !!ctx.ejemplo } }]);
    };
  }
  function borrarDe(tabla) {
    return function (data, a) { return okOps(buscar(data[tabla], a.id) ? [{ op: 'delete', tabla: tabla, id: a.id }] : []); };
  }
  // Valida y arma un gasto (nuevo o editado). `antes` = el gasto original al editar.
  function armarGasto(data, a, ctx, antes) {
    var nombre = String(a.nombre || '').trim();
    if (!nombre) return { error: 'Escribe en qué fue el gasto. Ejemplo: almuerzo' };
    var v = validarMonto(a.monto); if (v.error) return { error: v.error };
    var fecha = a.fecha || ctx.hoy; if (!fechaValida(fecha)) return { error: 'La fecha no es válida.' };
    var med = a.medio || ultimoMedio(data), m = med && medio(data, med);
    if (!m) return { error: 'Elige una tarjeta o cuenta.' };
    if (!activo(m.obj) && !(antes && antes.medio === med) && !(!antes && a.id)) return { error: m.obj.nombre + ' está cerrada. Elige otra.' };
    var cl = clasificar(nombre, data.reglas);
    var cat = CATEGORIAS.indexOf(a.categoria) >= 0 ? a.categoria : cl.categoria;
    var tipo = TIPOS.indexOf(a.tipoGasto) >= 0 ? a.tipoGasto : (a.categoria ? TIPO_POR_CATEGORIA[cat] : cl.tipo);
    var partes = normalizarPartes(a.partes, v.c);
    var previas = antes ? antes.partes.map(function (x) { return x.p; }) : [];
    var e = validarPartes(data, partes, v.c, { mes: mesContable(data, med, fecha), permitidos: previas }); if (e) return { error: e };
    return { campos: { fecha: fecha, nombre: nombre, monto: v.c, categoria: cat, tipo: tipo, medio: med, partes: partes }, regla: cl.regla };
  }

  // Valida y arma una compra en cuotas (nueva o editada). `antes` = la cuota original al editar.
  function armarCuota(data, a, ctx, id, antes) {
    var nombre = String(a.nombre || '').trim(); if (!nombre) return { error: 'Escribe qué compraste en cuotas.' };
    if (!fechaValida(a.fechaInicio)) return { error: 'Elige la fecha de la primera cuota.' };
    var v = validarMonto(a.total, 'el monto total'); if (v.error) return { error: v.error };
    var n = parseInt(a.numCuotas, 10);
    if (!(n >= 1 && n <= 120) || String(n) !== String(a.numCuotas).trim()) return { error: 'El número de cuotas tiene que ser un número entero entre 1 y 120.' };
    if (v.c < n) return { error: 'El monto total es muy pequeño para ' + n + ' cuotas.' };
    var t = buscar(data.tarjetas, a.tarjeta);
    var tarjetaOk = t && (activo(t) || (antes && antes.tarjeta === t.id) || (!antes && a.id));
    if (!tarjetaOk) return { error: 'Elige la tarjeta de la cuota.' };
    var partes = normalizarPartes(a.partes, v.c, a.dueno);
    var previas = antes ? partesCuota(antes).map(function (x) { return x.p; }) : [];
    var e = validarPartes(data, partes, v.c, { permanentes: true, permitidos: previas }); if (e) return { error: e };
    var cl = clasificar(nombre, data.reglas);
    var cat = CATEGORIAS.indexOf(a.categoria) >= 0 ? a.categoria : cl.categoria;
    var row = { id: id, nombre: nombre, fechaInicio: a.fechaInicio, total: v.c, numCuotas: n,
      dueno: partes.length === 1 ? partes[0].p : 'varios', partes: partes, tarjeta: t.id, categoria: cat,
      tipo: TIPOS.indexOf(a.tipoGasto) >= 0 ? a.tipoGasto : (a.categoria ? TIPO_POR_CATEGORIA[cat] : cl.tipo),
      ejemplo: antes ? !!antes.ejemplo : !!ctx.ejemplo };
    var cal = calendarioCuota(row);
    row.montoCuota = cal[0].monto; row.fechaFinal = cal[cal.length - 1].fecha;
    return { row: row, cal: cal };
  }

  var acciones = {
    agregarGasto: function (data, a, ctx) {
      var id = a.id || nuevoId(ctx, 'g');
      if (buscar(data.gastos, id)) return dup();
      var r = armarGasto(data, a, ctx, null); if (r.error) return err(r.error);
      var row = r.campos; row.id = id; row.origen = a.origen || 'app'; row.revisado = a.origen !== 'atajo';
      row.creado = ctx.ahora || new Date().toISOString(); row.ejemplo = !!ctx.ejemplo;
      return okOps([{ op: 'add', tabla: 'gastos', row: row }], { gasto: row, regla: r.regla });
    },
    // Edita todo el gasto. Si cambias la categoría, también aprende la regla para la próxima vez.
    editarGasto: function (data, a, ctx) {
      var g = buscar(data.gastos, a.id); if (!g) return err('No encuentro ese gasto.');
      var r = armarGasto(data, a, ctx, g); if (r.error) return err(r.error);
      var cambios = r.campos; cambios.revisado = true;
      var ops = [{ op: 'update', tabla: 'gastos', id: g.id, cambios: cambios }];
      var palabra = palabraParaRegla(cambios.nombre);
      if (palabra && (cambios.categoria !== g.categoria || cambios.tipo !== g.tipo)) {
        var regla = buscar(data.reglas, palabra, 'palabra');
        var nueva = { palabra: palabra, categoria: cambios.categoria, tipo: cambios.tipo, origen: 'usuario' };
        ops.push(regla ? { op: 'update', tabla: 'reglas', id: palabra, cambios: nueva } : { op: 'add', tabla: 'reglas', row: nueva });
      }
      return okOps(ops, { gasto: Object.assign({}, g, cambios), palabra: palabra });
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
      return okOps((a.ids || []).filter(function (id) { return buscar(data.gastos, id); })
        .map(function (id) { return { op: 'update', tabla: 'gastos', id: id, cambios: { revisado: true } }; }));
    },
    borrarGasto: function (data, a) {
      return okOps(buscar(data.gastos, a.id) ? [{ op: 'delete', tabla: 'gastos', id: a.id }] : []);
    },
    agregarCuota: function (data, a, ctx) {
      var id = a.id || nuevoId(ctx, 'c');
      if (buscar(data.cuotas, id)) return dup();
      var r = armarCuota(data, a, ctx, id, null); if (r.error) return err(r.error);
      return okOps([{ op: 'add', tabla: 'cuotas', row: r.row }], { calendario: r.cal });
    },
    // Edita todo: descripción, monto total, número de cuotas, fecha de la primera cuota, tarjeta, categoría y reparto.
    editarCuota: function (data, a, ctx) {
      var c = buscar(data.cuotas, a.id); if (!c) return err('No encuentro esa compra en cuotas.');
      var r = armarCuota(data, a, ctx, c.id, c); if (r.error) return err(r.error);
      var cambios = {}; Object.keys(r.row).forEach(function (k) { if (k !== 'id' && k !== 'ejemplo') cambios[k] = r.row[k]; });
      return okOps([{ op: 'update', tabla: 'cuotas', id: c.id, cambios: cambios }], { calendario: r.cal });
    },
    borrarCuota: function (data, a) {
      return okOps(buscar(data.cuotas, a.id) ? [{ op: 'delete', tabla: 'cuotas', id: a.id }] : []);
    },
    pagarTarjeta: pagoTarjeta(false),
    editarPago: pagoTarjeta(true),
    borrarPago: borrarDe('pagos'),
    agregarIngreso: movimientoCuenta('ingresos', 'ingreso'),
    agregarRetiro: movimientoCuenta('retiros', 'retiro'),
    editarIngreso: movimientoCuenta('ingresos', 'ingreso', true),
    editarRetiro: movimientoCuenta('retiros', 'retiro', true),
    borrarIngreso: borrarDe('ingresos'),
    borrarRetiro: borrarDe('retiros'),
    agregarTransferencia: transferencia(false),
    editarTransferencia: transferencia(true),
    borrarTransferencia: borrarDe('transferencias'),
    agregarBanco: function (data, a, ctx) {
      var tabla = a.tabla === 'cuentas' ? 'cuentas' : 'tarjetas', esT = tabla === 'tarjetas';
      var nombre = String(a.nombre || '').trim(); if (!nombre) return err('Escribe el nombre de la ' + (esT ? 'tarjeta' : 'cuenta') + '.');
      if (!/^#[0-9a-fA-F]{6}$/.test(a.color || '')) return err('Elige el color del banco.');
      var ini = a.inicial === '' || a.inicial === undefined || a.inicial === null ? 0 : parseMonto(a.inicial);
      if (ini === null || ini < 0) return err('El monto inicial no es válido.');
      var row = { nombre: nombre, banco: String(a.banco || '').trim(), color: a.color, inicial: ini, activa: true };
      if (esT) {
        var c = validarDia(a.corte, 'corte'); if (c.error) return err(c.error);
        var p = validarDia(a.pago, 'pago'); if (p.error) return err(p.error);
        row.corte = c.n; row.pago = p.n;
      }
      if (a.id && buscar(data[tabla], a.id)) return dup();
      row.id = a.id || idLibre(data[tabla], (esT ? 'tc-' : 'cta-') + slug(nombre));
      return okOps([{ op: 'add', tabla: tabla, row: row }], { id: row.id });
    },
    editarBanco: function (data, a) {
      var tabla = a.tabla === 'cuentas' ? 'cuentas' : 'tarjetas', esT = tabla === 'tarjetas';
      var x = buscar(data[tabla], a.id); if (!x) return err('No encuentro esa ' + (esT ? 'tarjeta' : 'cuenta') + '.');
      var nombre = String(a.nombre || '').trim(); if (!nombre) return err('Escribe un nombre.');
      var ini = a.inicial === '' || a.inicial === undefined ? 0 : parseMonto(a.inicial);
      if (ini === null || ini < 0) return err('El monto inicial no es válido.');
      if (!/^#[0-9a-fA-F]{6}$/.test(a.color || '')) return err('Elige un color.');
      var cambios = { nombre: nombre, banco: String(a.banco || '').trim(), color: a.color, inicial: ini };
      if (esT) {
        var c = validarDia(a.corte, 'corte'); if (c.error) return err(c.error);
        var p = validarDia(a.pago, 'pago'); if (p.error) return err(p.error);
        cambios.corte = c.n; cambios.pago = p.n;
      }
      return okOps([{ op: 'update', tabla: tabla, id: x.id, cambios: cambios }]);
    },
    // Si tiene movimientos se archiva (queda en el historial pero ya no aparece para elegir).
    borrarBanco: function (data, a, ctx) {
      var tabla = a.tabla === 'cuentas' ? 'cuentas' : 'tarjetas';
      var x = buscar(data[tabla], a.id); if (!x) return okOps([]);
      if (tabla === 'tarjetas') {
        var hoyB = ctx.hoy;
        var cuotasPend = data.cuotas.some(function (c) { return c.tarjeta === x.id && calendarioCuota(c).some(function (q) { return q.fecha > hoyB; }); });
        if (cuotasPend) return err(x.nombre + ' todavía tiene cuotas pendientes. Bórralas o espera a que terminen antes de quitarla.');
        if (estadoTarjeta(data, x.id, hoyB).porPagar > 0) return err(x.nombre + ' todavía tiene saldo por pagar. Págalo antes de quitarla.');
      }
      if (usosDe(data, tabla, x.id)) return okOps([{ op: 'update', tabla: tabla, id: x.id, cambios: { activa: false } }], { archivada: true });
      return okOps([{ op: 'delete', tabla: tabla, id: x.id }], { archivada: false });
    },
    agregarPersona: function (data, a, ctx) {
      var nombre = String(a.nombre || '').trim(); if (!nombre) return err('Escribe el nombre de la persona.');
      var tipo = a.clase === 'mes' ? 'mes' : 'permanente';
      var mes = tipo === 'mes' ? (a.mes || mesDe(ctx.hoy)) : '';
      if (tipo === 'mes' && !/^\d{4}-\d{2}$/.test(mes)) return err('Elige el mes de esta persona.');
      if (a.id && buscar(data.personas, a.id)) return dup();
      var id = a.id || idLibre(data.personas, slug(nombre));
      return okOps([{ op: 'add', tabla: 'personas', row: { id: id, nombre: nombre, tipo: tipo, mes: mes, ejemplo: !!ctx.ejemplo, activa: true } }], { id: id });
    },
    borrarPersona: function (data, a) {
      var p = buscar(data.personas, a.id); if (!p) return okOps([]);
      if (usosDe(data, 'personas', p.id)) return okOps([{ op: 'update', tabla: 'personas', id: p.id, cambios: { activa: false } }], { archivada: true });
      return okOps([{ op: 'delete', tabla: 'personas', id: p.id }], { archivada: false });
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
    NOMBRES_TABLAS.forEach(function (t) { if (!data[t]) data[t] = []; });
    var f = acciones[accion && accion.tipo];
    if (!f) return err('Acción desconocida.');
    try { return f(data, accion, ctx); } catch (e) { return err('Error: ' + (e && e.message || e)); }
  }
  function aplicarOps(data, ops) {
    ops.forEach(function (o) {
      var t = TABLAS[o.tabla], lista = data[o.tabla] = data[o.tabla] || [], k = t.clave;
      if (o.op === 'add') { lista.push(JSON.parse(JSON.stringify(o.row))); return; }
      for (var i = 0; i < lista.length; i++) if (lista[i][k] === o.id) {
        if (o.op === 'delete') lista.splice(i, 1);
        else Object.keys(o.cambios).forEach(function (c) { lista[i][c] = o.cambios[c]; });
        break;
      }
    });
    return data;
  }

  // Atajo de iPhone: nombre, monto y tarjeta opcional (ID, nombre o banco; "Última usada" = ninguna).
  function accionAtajo(data, q) {
    var med = null, t = String(q.tarjeta || '').trim();
    if (/^ultima/.test(normalizar(t))) t = '';
    if (t) {
      var n = normalizar(t);
      data.tarjetas.concat(data.cuentas).filter(activo).forEach(function (x) {
        if (!med && (normalizar(x.id) === n || normalizar(x.nombre) === n || normalizar(x.banco) === n)) med = x.id;
      });
      if (!med) return { error: 'No encuentro la tarjeta "' + t + '".' };
    }
    return { accion: { tipo: 'agregarGasto', nombre: q.nombre, monto: q.monto, medio: med || undefined, origen: 'atajo' } };
  }

  /* ---------- Presupuesto de tu plan (Registro v3 · Plan Oct–Dic 2026) ---------- */
  var PRESUPUESTO_PLAN = [
    ['Vivienda', 40000], ['Servicios', 36800], ['Alimentación – supermercado', 170000],
    ['Alimentación – comidas fuera', 60000], ['Transporte', 60000], ['Educación', 150000],
    ['Deudas y tarjetas', 247087], ['Suscripciones', 23059], ['Familia y regalos', 130000], ['Ahorro', 90900]
  ];

  /* ---------- Datos iniciales y de ejemplo (modo de prueba) ---------- */
  function vacio() { var d = {}; NOMBRES_TABLAS.forEach(function (t) { d[t] = []; }); return d; }
  function datosBase() {
    var d = vacio();
    d.reglas = REGLAS_BASE.map(function (r) { return { palabra: r.palabra, categoria: r.categoria, tipo: r.tipo, origen: r.origen }; });
    return d;
  }
  function accionesEjemplo(hoy) {
    var ym = mesDe(hoy), ant = sumarMeses(ym, -1);
    var dHoy = +hoy.slice(8, 10), dd = function (dia) { return diaEn(ym, Math.min(dia, dHoy)); };
    return [
      { tipo: 'agregarBanco', tabla: 'tarjetas', id: 'tc-ej1', nombre: 'Visa ejemplo', banco: 'Banco A', color: '#1F4E9C', corte: '27', pago: '27' },
      { tipo: 'agregarBanco', tabla: 'tarjetas', id: 'tc-ej2', nombre: 'Mastercard ejemplo', banco: 'Banco B', color: '#C8102E', corte: '15', pago: '5' },
      { tipo: 'agregarBanco', tabla: 'cuentas', id: 'cta-ej1', nombre: 'Monetaria ejemplo', banco: 'Banco A', color: '#1F4E9C' },
      { tipo: 'agregarBanco', tabla: 'cuentas', id: 'cta-ej2', nombre: 'Ahorro ejemplo', banco: 'Banco C', color: '#0B7A3E' },
      { tipo: 'agregarPersona', id: 'ana', nombre: 'Ana', clase: 'permanente' },
      { tipo: 'agregarPersona', id: 'luis', nombre: 'Luis', clase: 'mes', mes: ym },
      { tipo: 'agregarIngreso', id: 'ej-i1', fecha: dd(1), cuenta: 'cta-ej1', descripcion: 'Salario', monto: '9500' },
      { tipo: 'agregarGasto', id: 'ej-g1', fecha: dd(2), nombre: 'Súper La Torre', monto: '642.35', medio: 'tc-ej1' },
      { tipo: 'agregarGasto', id: 'ej-g2', fecha: dd(3), nombre: 'Gasolina', monto: '250', medio: 'tc-ej2' },
      { tipo: 'agregarGasto', id: 'ej-g3', fecha: dd(4), nombre: 'Almuerzo Campero', monto: '100.01', medio: 'tc-ej1', partes: dividirIguales(10001, ['yo', 'ana', 'luis']) },
      { tipo: 'agregarGasto', id: 'ej-g4', fecha: dd(5), nombre: 'Luz EEGSA', monto: '310.40', medio: 'cta-ej1' },
      { tipo: 'agregarCuota', id: 'ej-c1', nombre: 'Laptop', fechaInicio: diaEn(ant, 27), total: '6000', numCuotas: '6', tarjeta: 'tc-ej1',
        categoria: 'Deudas y tarjetas', partes: [{ p: 'yo', m: 300000 }, { p: 'ana', m: 300000 }] }
    ];
  }
  function sembrarEjemplos(data, ctx) {
    var todas = [];
    accionesEjemplo(ctx.hoy).forEach(function (a) {
      var res = aplicar(data, a, { hoy: ctx.hoy, ahora: ctx.ahora, ejemplo: true });
      if (!res.ok) throw new Error('Ejemplo inválido (' + a.tipo + '): ' + res.error);
      res.ops.forEach(function (o) { if (o.op === 'add') o.row.ejemplo = true; });
      aplicarOps(data, res.ops); todas = todas.concat(res.ops);
    });
    PRESUPUESTO_PLAN.forEach(function (p) { data.presupuesto.push({ categoria: p[0], monto: p[1], ejemplo: false }); });
    return todas;
  }

  /* ---------- Conversión fila de hoja <-> objeto ---------- */
  // Devuelve { 'Encabezado': valor } para escribir en la hoja.
  function aFilaObj(tabla, obj) {
    var o = {};
    TABLAS[tabla].cols.forEach(function (c) {
      var k = c[0], t = c[2], v = obj[k], out;
      if (tabla === 'gastos' && k === 'miParte') out = miParte(obj) / 100;
      else if (tabla === 'cuotas' && k === 'montoCuota') out = calendarioCuota(obj)[0].monto / 100;
      else if (tabla === 'cuotas' && k === 'fechaFinal') { var f = calendarioCuota(obj); out = f[f.length - 1].fecha; }
      else if (t === 'money') out = (v || 0) / 100;
      else if (t === 'bool') out = !!v;
      else if (t === 'boolSi') out = v !== false;
      else if (t === 'reparto') out = codificarReparto(v);
      else if (t === 'int') out = v || '';
      else out = v === undefined || v === null ? '' : String(v);
      o[c[1]] = out;
    });
    return o;
  }
  function aFila(tabla, obj) { var o = aFilaObj(tabla, obj); return TABLAS[tabla].cols.map(function (c) { return o[c[1]]; }); }
  // `fila` es un objeto { 'Encabezado': valor } o un arreglo en el orden del esquema.
  function deFila(tabla, fila, fmtFecha) {
    var o = {};
    TABLAS[tabla].cols.forEach(function (c, i) {
      var k = c[0], t = c[2], v = Array.isArray(fila) ? fila[i] : fila[c[1]];
      if (t === 'derived') return;
      if (v === undefined) v = '';
      if (v instanceof Date) v = fmtFecha ? fmtFecha(v) : v.toISOString().slice(0, 10);
      if (t === 'money') o[k] = v === '' || v === null ? 0 : (parseMonto(v) || 0);
      else if (t === 'int') o[k] = parseInt(v, 10) || 0;
      else if (t === 'bool') o[k] = v === true || String(v).toUpperCase() === 'TRUE' || v === 'Sí';
      else if (t === 'boolSi') o[k] = !(v === false || String(v).toUpperCase() === 'FALSE' || v === 'No');
      else if (t === 'reparto') o[k] = decodificarReparto(v);
      else o[k] = v === null ? '' : String(v).trim();
    });
    return o;
  }

  return {
    VERSION: VERSION, CATEGORIAS: CATEGORIAS, TIPOS: TIPOS, TIPO_POR_CATEGORIA: TIPO_POR_CATEGORIA, TABLAS: TABLAS,
    NOMBRES_TABLAS: NOMBRES_TABLAS, REGLAS_BASE: REGLAS_BASE, ALERTA_PCT: ALERTA_PCT, DIAS_AVISO_PAGO: DIAS_AVISO_PAGO,
    PRESUPUESTO_PLAN: PRESUPUESTO_PLAN,
    parseMonto: parseMonto, fmtQ: fmtQ, decimal: decimal, montoValido: montoValido,
    fechaValida: fechaValida, diasDelMes: diasDelMes, mesDe: mesDe, sumarMeses: sumarMeses, sumarDias: sumarDias,
    diasEntre: diasEntre, nombreMes: nombreMes, fechaCorta: fechaCorta, diaMes: diaMes, normalizar: normalizar,
    clasificar: clasificar, palabraParaRegla: palabraParaRegla, dividirIguales: dividirIguales,
    codificarReparto: codificarReparto, decodificarReparto: decodificarReparto, sumaPartes: sumaPartes, miParte: miParte,
    buscar: buscar, activo: activo, medio: medio, nombrePersona: nombrePersona,
    tieneCorte: tieneCorte, ultimoCorte: ultimoCorte, siguienteCorte: siguienteCorte, fechaPagoDe: fechaPagoDe,
    mesContable: mesContable, cicloDelMes: cicloDelMes,
    partesCuota: partesCuota, calendarioCuota: calendarioCuota, estadoCuota: estadoCuota, describirDueno: describirDueno,
    deudaTarjeta: deudaTarjeta, contadoAlCorte: contadoAlCorte, estadoTarjeta: estadoTarjeta, ciclosTarjeta: ciclosTarjeta, limitePago: limitePago,
    recordatorios: recordatorios, textoRecordatorio: textoRecordatorio, saldoCuenta: saldoCuenta,
    ultimoMedio: ultimoMedio, personasDelMes: personasDelMes, usosDe: usosDe, recuento: recuento,
    presupuestoMes: presupuestoMes, mesesConActividad: mesesConActividad, aplicar: aplicar, aplicarOps: aplicarOps,
    accionAtajo: accionAtajo, vacio: vacio, datosBase: datosBase, sembrarEjemplos: sembrarEjemplos,
    aFila: aFila, aFilaObj: aFilaObj, deFila: deFila
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Core;

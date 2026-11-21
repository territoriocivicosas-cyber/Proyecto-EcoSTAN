// ============================================================
// Analítica general + paneles Premium por proveedor (Alcaldía, Empresa de aseo, Recicladores)
// Módulo independiente: recibe del panel lo que necesita (ctx) y dibuja gráficos SVG sin librerías externas.
// ============================================================
export function crearAnalitica(ctx) {
    const esc = ctx.esc;
    const PAL = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#e11d48', '#65a30d', '#64748b'];
    const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const num = (n, d = 1) => Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: d });
    const pct = (a, b) => (b ? (a / b) * 100 : null);
    const DAY = 864e5;
    let vistaPremium = null, cache = null;

    /* ---------- utilidades de fecha ---------- */
    const f10 = v => (v || '').slice(0, 10);
    const mesDe = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const mesEtq = k => MESES[Number(k.slice(5)) - 1] + ' ' + k.slice(2, 4);
    function ultimosMeses(n) { const r = [], h = new Date(); for (let i = n - 1; i >= 0; i--) r.push(mesDe(new Date(h.getFullYear(), h.getMonth() - i, 1))); return r; }
    function lunes(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
    const isoD = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    function ultimasSemanas(n) { const r = [], l = lunes(new Date()); for (let i = n - 1; i >= 0; i--) r.push(isoD(new Date(l.getTime() - i * 7 * DAY))); return r; }

    /* ---------- gráficos (SVG / CSS, sin dependencias) ---------- */
    const vacio = t => `<div class="an-vacio">${esc(t || 'Sin datos en el periodo seleccionado')}</div>`;
    function barrasH(items, o = {}) {
        items = items.filter(i => i.value !== null && i.value !== undefined);
        if (!items.length) return vacio();
        const mx = o.max || Math.max(...items.map(i => i.value), 1), f = o.fmt || (v => num(v, 0));
        return `<div class="an-bh">${items.map((i, k) => `<div class="an-bh-r"><span class="an-bh-l" title="${esc(i.label)}">${esc(i.label)}</span>
            <div class="an-bh-t"><div class="an-bh-b" style="width:${Math.max(2, i.value / mx * 100)}%;background:${i.color || o.color || PAL[0]}"></div>${o.meta !== undefined ? `<i class="an-meta" style="left:${o.meta / mx * 100}%"></i>` : ''}</div>
            <span class="an-bh-v">${f(i.value)}${i.nota ? ` <small>${esc(i.nota)}</small>` : ''}</span></div>`).join('')}</div>`;
    }
    function apiladas(items, partes) {   // items: [{label, vals:[a,b,..]}]
        if (!items.length) return vacio();
        const mx = Math.max(...items.map(i => i.vals.reduce((a, b) => a + b, 0)), 1);
        return `<div class="an-leyenda">${partes.map(p => `<span><i style="background:${p.color}"></i>${esc(p.name)}</span>`).join('')}</div><div class="an-bh">${items.map(i => `<div class="an-bh-r"><span class="an-bh-l" title="${esc(i.label)}">${esc(i.label)}</span>
            <div class="an-bh-t an-ap">${i.vals.map((v, k) => v ? `<div class="an-bh-b" title="${esc(partes[k].name)}: ${v}" style="width:${v / mx * 100}%;background:${partes[k].color}"></div>` : '').join('')}</div>
            <span class="an-bh-v">${i.vals.reduce((a, b) => a + b, 0)}</span></div>`).join('')}</div>`;
    }
    function columnas(items, o = {}) {
        if (!items.length || items.every(i => !i.value)) return vacio();
        const W = Math.max(300, items.length * 46), H = o.h || 190, pl = 8, pb = 26, pt = 20, mx = Math.max(...items.map(i => i.value), 1), bw = (W - pl * 2) / items.length, f = o.fmt || (v => num(v, 0));
        const hi = o.destacar ? items.reduce((a, i, k) => (i.value > items[a].value ? k : a), 0) : -1;
        return `<svg class="an-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.titulo || 'Gráfico de columnas')}">
            <line x1="0" x2="${W}" y1="${H - pb}" y2="${H - pb}" stroke="#cbd5e1"/>
            ${items.map((i, k) => { const h = (H - pb - pt) * (i.value / mx), x = pl + k * bw + bw * 0.16, y = H - pb - h;
                return `<rect x="${x}" y="${y}" width="${bw * 0.68}" height="${Math.max(h, 0)}" rx="3" fill="${k === hi ? '#d97706' : (i.color || o.color || PAL[0])}"/>
                <text x="${x + bw * 0.34}" y="${y - 5}" text-anchor="middle" class="an-t">${f(i.value)}</text>
                <text x="${x + bw * 0.34}" y="${H - 8}" text-anchor="middle" class="an-t2">${esc(i.label)}</text>`; }).join('')}</svg>`;
    }
    function lineas(labels, series, o = {}) {   // series: [{name,color,data:[]}]
        const all = series.flatMap(s => s.data);
        if (!labels.length || !all.some(v => v > 0)) return vacio();
        const W = 560, H = o.h || 210, pl = 44, pr = 16, pt = 14, pb = 28, mx = Math.max(...all, 1), mag = Math.pow(10, Math.floor(Math.log10(mx / 4))), stp = [1, 2, 2.5, 5, 10].map(k => k * mag).find(v => v * 4 >= mx) || mag * 10, niceMax = stp * 4;
        const X = i => pl + (labels.length === 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (labels.length - 1)), Y = v => H - pb - (H - pb - pt) * (v / niceMax);
        const ticks = [0, 1, 2, 3, 4].map(k => niceMax / 4 * k);
        const step = Math.ceil(labels.length / 8);
        return `<div class="an-leyenda">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>
            <svg class="an-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.titulo || 'Gráfico de líneas')}">
            ${ticks.map(t => `<line x1="${pl}" x2="${W - pr}" y1="${Y(t)}" y2="${Y(t)}" stroke="#e2e8f0"/><text x="${pl - 6}" y="${Y(t) + 4}" text-anchor="end" class="an-t2">${num(t, niceMax < 8 ? 1 : 0)}</text>`).join('')}
            ${labels.map((l, i) => i % step === 0 ? `<text x="${X(i)}" y="${H - 8}" text-anchor="${i === labels.length - 1 ? 'end' : (i === 0 ? 'start' : 'middle')}" class="an-t2">${esc(l)}</text>` : '').join('')}
            ${series.map(s => `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" points="${s.data.map((v, i) => X(i) + ',' + Y(v)).join(' ')}"/>
                ${s.data.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="3.2" fill="${s.color}"><title>${esc(s.name)} · ${esc(labels[i])}: ${num(v)}</title></circle>`).join('')}`).join('')}</svg>`;
    }
    function dona(items, o = {}) {
        items = items.filter(i => i.value > 0);
        const tot = items.reduce((a, i) => a + i.value, 0);
        if (!tot) return vacio();
        const R = 52, Cc = 2 * Math.PI * R; let off = 0;
        const arcs = items.map((i, k) => { const len = i.value / tot * Cc, c = i.color || PAL[k % PAL.length];
            const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${c}" stroke-width="22" stroke-dasharray="${len} ${Cc - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(i.label)}: ${num(i.value)}</title></circle>`; off += len; return s; }).join('');
        return `<div class="an-dona"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(o.titulo || 'Gráfico circular')}">${arcs}<text x="70" y="68" text-anchor="middle" class="an-dn">${num(tot, 0)}</text><text x="70" y="84" text-anchor="middle" class="an-t2">${esc(o.centro || 'total')}</text></svg>
            <ul>${items.map((i, k) => `<li><i style="background:${i.color || PAL[k % PAL.length]}"></i><span>${esc(i.label)}</span><b>${num(i.value, o.dec ?? 0)}${o.unidad ? ' ' + o.unidad : ''}</b><small>${Math.round(i.value / tot * 100)}%</small></li>`).join('')}</ul></div>`;
    }
    const kpi = (t, v, n, tono) => `<div class="kpi-card an-kpi ${tono || ''}"><h4>${esc(t)}</h4><div class="kpi-valor">${v}</div><small>${n || ''}</small></div>`;
    const panel = (t, cuerpo, ayuda, ancho) => `<section class="an-card ${ancho === 2 ? 'an-w2' : ''}"><h4>${t}</h4>${ayuda ? `<p class="an-ayuda">${ayuda}</p>` : ''}${cuerpo}</section>`;
    const delta = (a, b) => b ? `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round((a / b - 1) * 100))}% vs periodo anterior` : 'Sin periodo anterior';

    /* ---------- carga de datos ---------- */
    function puntoEnPoligono(lng, lat, ring) {
        let d = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) d = !d;
        }
        return d;
    }
    function localizar(lat, lng, barrios) {
        for (const b of barrios) {
            if (lng < b._bb[0] || lng > b._bb[2] || lat < b._bb[1] || lat > b._bb[3]) continue;
            const g = b.geojson && (b.geojson.geometry || b.geojson);
            if (!g) continue;
            const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
            if (polys.some(p => puntoEnPoligono(lng, lat, p[0]))) return b;
        }
        return null;
    }
    async function cargarDatos(necesita) {
        const { mun, d1, d2 } = ctx.filtros(), rol = ctx.rol();
        const clave = JSON.stringify([mun, d1, d2, necesita, rol.dep]);
        if (cache && cache.k === clave && Date.now() - cache.t < 45000) return cache.d;
        const q = (tabla, f) => ctx.db.from(tabla).select(f || '*');
        const verRep = ctx.tablas.some(t => ctx.puede(t)), verCiclo = ctx.puede('operacion_pesajes') || ctx.puede('operacion_recicladores');
        const [reps, rutasR, planesR, novR, chatR, bitR, geoR] = await Promise.all([
            verRep ? Promise.all(ctx.tablas.map(t => ctx.puede(t) ? q(t) : Promise.resolve({ data: [] }))) : Promise.resolve([]),
            q('rutas_recoleccion'), q('rutas_planes'),
            ctx.db.from('rutas_novedades').select('*').gte('fecha', isoD(new Date(Date.now() - 120 * DAY))),
            necesita.premium && verRep ? ctx.db.from('chat_reportes').select('reporte_id,tabla_origen,created_at').eq('emisor', 'institucion') : Promise.resolve({ data: [] }),
            necesita.premium && verRep && (rol.superadmin || rol.dep === 'alcaldia') ? ctx.db.rpc('eco_bitacora_listar', { p_desde: d1 || null, p_hasta: d2 || null, p_municipio: mun, p_solo_borrados: true }) : Promise.resolve({ data: [] }),
            ctx.db.from('barrios_geo').select('barrio,municipio,geojson,centro_lat,centro_lng,comuna,comuna_nombre')
        ]);
        const barrios = (geoR.data || []).filter(b => b.geojson).map(b => {
            const g = b.geojson.geometry || b.geojson, pts = (g.type === 'MultiPolygon' ? g.coordinates.flat(1) : g.coordinates).flat(1);
            const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
            return { ...b, _bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
        }).filter(b => b.comuna != null);
        let reportes = [];
        (reps || []).forEach((res, i) => { const t = ctx.tablas[i]; const lista = ctx.competencia ? ctx.competencia(t, res.data || []) : (res.data || []); lista.forEach(r => reportes.push({ ...r, _tabla: t })); });
        (Array.isArray(bitR.data) ? bitR.data : []).forEach(x => { if (x.estado_final === 'eliminado') return;
            reportes.push({ id: x.reporte_id, _tabla: x.tabla_origen, created_at: x.creado_at, estado: x.estado_final, municipio: x.municipio, barrio: x.barrio, _minResp: x.min_primera_respuesta, _hist: true }); });
        reportes = reportes.filter(r => { const f = f10(r.created_at); return (mun === 'todos' || !r.municipio || r.municipio === mun) && (!d1 || f >= d1) && (!d2 || f <= d2); });
        reportes.forEach(r => {
            const lat = parseFloat(r.latitud), lng = parseFloat(r.longitud);
            const b = (!isNaN(lat) && !isNaN(lng) && barrios.length) ? localizar(lat, lng, barrios) : null;
            r._barrio = r.barrio || (b && b.barrio) || null; r._comuna = b ? b.comuna : null; r._comunaNom = b ? b.comuna_nombre : null; r._geo = b || null;
            r._estado = r.estado || 'pendiente'; r._d = new Date(r.created_at); r._f = f10(r.created_at);
        });
        const primera = {};
        (chatR.data || []).forEach(m => { const k = `${m.tabla_origen}:${m.reporte_id}`, t = new Date(m.created_at).getTime(); if (!primera[k] || t < primera[k]) primera[k] = t; });
        reportes.forEach(r => { r._hResp = r._hist ? (r._minResp != null ? r._minResp / 60 : null) : (primera[`${r._tabla}:${r.id}`] ? (primera[`${r._tabla}:${r.id}`] - r._d.getTime()) / 3600000 : null); if (r._hResp !== null && r._hResp < 0) r._hResp = null; });
        const d = { reportes: reportes.filter(r => r._estado !== 'cancelada'), rutas: (rutasR.data || []).filter(r => mun === 'todos' || r.municipio === mun),
            planes: planesR.data || [], novedades: novR.data || [], barrios, ciclo: null, verRep, verCiclo, mun };
        if (verCiclo && necesita.ciclo) {
            const [p, r, e] = await Promise.all([ctx.puente('pesajes'), ctx.puente('recicladores'), ctx.puente('empresas')]);
            d.ciclo = (p || r || e) ? { pesajes: p || [], recicladores: r || [], empresas: e || [] } : { error: ctx.puenteError ? ctx.puenteError() : 'Sin conexión con CicloGo' };
            const al = ctx.alcance ? ctx.alcance() : null;
            if (d.ciclo && !d.ciclo.error && al && al.limitado) {   // solo lo de su organización y las empresas de su territorio
                const ids = new Set((al.recicladores || []).map(String)), emp = new Set((al.empresas_ciclogo || []).map(String));
                d.ciclo.recicladores = d.ciclo.recicladores.filter(x => ids.has(String(x.id)) || emp.has(String(x.empresa_id)));
                const rid = new Set(d.ciclo.recicladores.map(x => String(x.id)));
                d.ciclo.pesajes = d.ciclo.pesajes.filter(p => rid.has(String(p.reciclador_id)) || emp.has(String(p.empresa_id)));
                d.ciclo.empresas = d.ciclo.empresas.filter(x => emp.has(String(x.id)));
            }
        }
        cache = { k: clave, t: Date.now(), d };
        return d;
    }

    /* ---------- indicadores ---------- */
    function indicadores(d) {
        const rep = d.reportes, resueltos = rep.filter(r => r._estado === 'resuelto').length, pend = rep.filter(r => r._estado === 'pendiente');
        const horas = rep.map(r => r._hResp).filter(h => h !== null);
        const rutas = d.rutas, iclr = rutas.length ? rutas.reduce((s, r) => s + (Number(r.cumplimiento) || 0), 0) / rutas.length : null;
        const hoy = d.planes.filter(p => p.activo !== false && String(p.dias || '').split(',').map(x => x.trim()).includes(DIAS[new Date().getDay()]));
        return { total: rep.length, resueltos, pend, tasa: pct(resueltos, rep.length), tpr: horas.length ? horas.reduce((a, b) => a + b, 0) / horas.length : null, nHoras: horas.length, iclr, nRutas: rutas.length,
            hoy, hoyEst: e => hoy.filter(p => (p.estado_hoy || 'programada') === e).length };
    }
    const contar = (lista, fn) => { const m = {}; lista.forEach(x => { const k = fn(x); if (k !== null && k !== undefined && k !== '') m[k] = (m[k] || 0) + 1; }); return m; };
    const top = (m, n) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
    const nombreTabla = t => ctx.nombres[t] || t;
    const horasFmt = h => ctx.fmtHoras(h);

    /* ---------- bloques de gráficos compartidos ---------- */
    function bloqueSerieReportes(d) {
        const sem = ultimasSemanas(12), cre = {}, res = {};
        d.reportes.forEach(r => { const k = isoD(lunes(r._d)); cre[k] = (cre[k] || 0) + 1; if (r._estado === 'resuelto') res[k] = (res[k] || 0) + 1; });
        return lineas(sem.map(s => s.slice(8) + '/' + s.slice(5, 7)), [{ name: 'Reportes recibidos', color: PAL[0], data: sem.map(s => cre[s] || 0) }, { name: 'Resueltos', color: PAL[1], data: sem.map(s => res[s] || 0) }], { titulo: 'Reportes por semana' });
    }
    const bloquePorCategoria = d => dona(Object.entries(contar(d.reportes, r => nombreTabla(r._tabla))).map(([label, value]) => ({ label, value })), { centro: 'reportes' });
    function bloquePorMunicipio(d) {
        const m = {}; d.reportes.forEach(r => { const k = r.municipio || 'Sin municipio'; m[k] = m[k] || [0, 0]; m[k][r._estado === 'resuelto' ? 1 : 0]++; });
        return apiladas(Object.entries(m).sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1])).map(([label, v]) => ({ label, vals: v })), [{ name: 'Pendientes / en proceso', color: PAL[2] }, { name: 'Resueltos', color: PAL[1] }]);
    }
    function bloqueBarrios(d, n = 10) {
        const p = d.reportes.filter(r => r._estado !== 'resuelto' && r._barrio), m = {};
        const muns = new Set(p.map(r => r.municipio)); p.forEach(r => { const k = r._barrio + (muns.size > 1 && r.municipio ? ' · ' + r.municipio : ''); m[k] = (m[k] || 0) + 1; });
        const t = top(m, n);
        return t.length ? barrasH(t.map(([label, value]) => ({ label, value })), { color: PAL[2] }) : vacio('Aún no hay reportes con barrio identificado. En Floridablanca se asigna por la ubicación GPS del reporte.');
    }
    function bloqueComunas(d) {
        const m = {}; d.reportes.filter(r => r._comuna != null).forEach(r => { const k = `Comuna ${r._comuna} · ${r._comunaNom || ''}`; m[k] = m[k] || [0, 0]; m[k][r._estado === 'resuelto' ? 1 : 0]++; });
        return Object.keys(m).length ? apiladas(Object.entries(m).sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1])).map(([label, v]) => ({ label, vals: v })), [{ name: 'Pendientes / en proceso', color: PAL[2] }, { name: 'Resueltos', color: PAL[1] }]) : vacio('Sin reportes ubicados en las comunas de Floridablanca.');
    }
    function bloqueDiaSemana(d) { const c = contar(d.reportes, r => r._d.getDay()); return columnas([1, 2, 3, 4, 5, 6, 0].map(i => ({ label: DIAS[i].slice(0, 3), value: c[i] || 0 })), { destacar: true, titulo: 'Reportes por día de la semana' }); }
    function bloqueTiempos(d) {
        const m = {}; d.reportes.forEach(r => { if (r._hResp === null) return; const k = nombreTabla(r._tabla); (m[k] = m[k] || []).push(r._hResp); });
        const it = Object.entries(m).map(([label, v]) => ({ label, value: v.reduce((a, b) => a + b, 0) / v.length, nota: `${v.length} caso(s)` }));
        return it.length ? barrasH(it, { fmt: v => horasFmt(v), color: PAL[4] }) : vacio('Aún no hay respuestas oficiales registradas.');
    }
    function bloqueRutasCumplimiento(d) {
        const it = d.rutas.map(r => ({ label: `${r.barrio} (${r.municipio})`, value: Number(r.cumplimiento) || 0, color: (Number(r.cumplimiento) || 0) < ctx.umbral() ? '#dc2626' : '#16a34a' })).sort((a, b) => a.value - b.value).slice(0, 10);
        return it.length ? barrasH(it, { max: 100, fmt: v => v + '%', meta: ctx.umbral() }) + `<p class="an-ayuda">La marca vertical es el umbral de ${ctx.umbral()}%. Se muestran las 10 rutas con menor cumplimiento.</p>` : vacio('No hay rutas registradas.');
    }
    function bloqueEstadoHoy(i) {
        const e = { programada: ['Programadas', PAL[0]], en_curso: ['En curso', PAL[2]], completada: ['Completadas', PAL[1]], incumplida: ['Incumplidas', '#dc2626'], suspendida: ['Suspendidas', '#94a3b8'] };
        return dona(Object.entries(e).map(([k, [label, color]]) => ({ label, color, value: i.hoyEst(k) })), { centro: 'rutas hoy' });
    }
    const TIPOS_NOV = { retraso: 'Retraso', falla: 'Falla del camión', cierre_vial: 'Cierre vial', clima: 'Clima', otra: 'Otra', nota: 'Nota', incumplida: 'Ruta incumplida', suspendida: 'Ruta suspendida' };
    function bloqueNovedades(d) {
        const desde = isoD(new Date(Date.now() - 30 * DAY)), n = d.novedades.filter(x => (x.fecha || '') >= desde && !['inicio', 'finalizada', 'en_curso'].includes(x.tipo));
        return dona(Object.entries(contar(n, x => TIPOS_NOV[x.tipo] || x.tipo)).map(([label, value]) => ({ label, value })), { centro: 'novedades' });
    }
    function bloqueCumplimientoHistorico(d) {   // por ruta: finalizadas vs incumplidas (novedades)
        const m = {}; d.novedades.forEach(x => { if (!['finalizada', 'incumplida'].includes(x.tipo)) return; m[x.plan_id] = m[x.plan_id] || [0, 0]; m[x.plan_id][x.tipo === 'finalizada' ? 0 : 1]++; });
        const nom = id => (d.planes.find(p => String(p.id) === String(id)) || {}).nombre || 'Ruta ' + id;
        const it = Object.entries(m).map(([id, v]) => ({ label: nom(id), vals: v }));
        return it.length ? apiladas(it, [{ name: 'Completadas', color: PAL[1] }, { name: 'Incumplidas', color: '#dc2626' }]) : vacio('Aún no hay recorridos cerrados en el historial de novedades.');
    }

    /* ---------- reciclaje ---------- */
    const mat = p => (p.material || 'Otros').trim();
    const kg = p => Number(p.peso_kg || 0);
    function datosCiclo(d) {
        const c = d.ciclo; if (!c || c.error) return null;
        const ahora = Date.now(), p30 = c.pesajes.filter(p => ahora - new Date(p.created_at) <= 30 * DAY), pAnt = c.pesajes.filter(p => { const t = ahora - new Date(p.created_at); return t > 30 * DAY && t <= 60 * DAY; });
        const sum = l => l.reduce((a, p) => a + kg(p), 0);
        return { c, p30, pAnt, kg30: sum(p30), kgAnt: sum(pAnt), sum };
    }
    function bloquesCiclo(d) {
        const x = datosCiclo(d);
        if (!x) return { aviso: d.ciclo && d.ciclo.error ? `No se pudo consultar CicloGo (${esc(d.ciclo.error)}). Revisa el puente seguro.` : 'Sin acceso a los datos de reciclaje.' };
        const { c } = x, meses = ultimosMeses(6), porMes = {}; c.pesajes.forEach(p => { const k = mesDe(new Date(p.created_at)); porMes[k] = (porMes[k] || 0) + kg(p); });
        const porMat = {}; x.p30.forEach(p => { porMat[mat(p)] = (porMat[mat(p)] || 0) + kg(p); });
        const matAnt = {}; x.pAnt.forEach(p => { matAnt[mat(p)] = (matAnt[mat(p)] || 0) + kg(p); });
        const porRec = {}; x.p30.forEach(p => { porRec[p.reciclador_id] = (porRec[p.reciclador_id] || 0) + kg(p); });
        const nomRec = id => (c.recicladores.find(r => String(r.id) === String(id)) || {}).nombre_completo || 'Reciclador';
        const porEca = {}; x.p30.forEach(p => { porEca[p.empresa_id || 'sin'] = (porEca[p.empresa_id || 'sin'] || 0) + kg(p); });
        const nomEca = id => id === 'sin' ? 'Sin ECA asignada' : ((c.empresas.find(e => String(e.id) === String(id)) || {}).nombre || 'ECA');
        const dow = {}; x.p30.forEach(p => { const k = new Date(p.created_at).getDay(); dow[k] = (dow[k] || 0) + kg(p); });
        const activos = new Set(x.p30.map(p => String(p.reciclador_id)));
        const ultimo = {}; c.pesajes.forEach(p => { const t = new Date(p.created_at).getTime(); if (!ultimo[p.reciclador_id] || t > ultimo[p.reciclador_id]) ultimo[p.reciclador_id] = t; });
        const inactivos = c.recicladores.filter(r => r.verificado !== false && (!ultimo[r.id] || Date.now() - ultimo[r.id] > 30 * DAY));
        const calidad = contar(x.p30, p => p.calidad || 'Sin dato');
        return { x, c, meses, porMes, porMat, matAnt, porRec, nomRec, porEca, nomEca, dow, activos, inactivos, calidad,
            serie: lineas(meses.map(mesEtq), [{ name: 'Kilogramos reciclados', color: PAL[1], data: meses.map(k => Math.round(porMes[k] || 0)) }], { titulo: 'Kilogramos por mes' }),
            donaMat: dona(Object.entries(porMat).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value), { centro: 'kg · 30 d', unidad: 'kg' }),
            topRec: top(porRec, 10).length ? barrasH(top(porRec, 10).map(([id, v]) => ({ label: nomRec(id), value: v })), { color: PAL[1], fmt: v => num(v, 0) + ' kg' }) : vacio(),
            topEca: top(porEca, 8).length ? barrasH(top(porEca, 8).map(([id, v]) => ({ label: nomEca(id), value: v })), { color: PAL[0], fmt: v => num(v, 0) + ' kg' }) : vacio(),
            diaSem: columnas([1, 2, 3, 4, 5, 6, 0].map(i => ({ label: DIAS[i].slice(0, 3), value: Math.round(dow[i] || 0) })), { destacar: true, titulo: 'Kilogramos por día de la semana' }) };
    }
    function recsCiclo(b) {
        const r = [];
        if (!b.c.pesajes.length) return [{ t: '', m: '📭 Aún no hay pesajes registrados. Cuando las ECA registren material en la báscula, aquí verás las tendencias.' }];
        if (b.x.kgAnt > 0) { const v = b.x.kg30 / b.x.kgAnt - 1; r.push(v >= 0.1 ? { t: 'ok', m: `📈 El material reciclado de los últimos 30 días (<b>${num(b.x.kg30, 0)} kg</b>) subió ${Math.round(v * 100)}% frente al periodo anterior.` } : v <= -0.1 ? { t: 'alerta', m: `📉 El material recibido cayó ${Math.round(-v * 100)}% frente a los 30 días anteriores (${num(b.x.kgAnt, 0)} → ${num(b.x.kg30, 0)} kg). Revisar rutas de recolección selectiva y la comunicación con los recicladores.` } : { t: '', m: `➡️ El volumen se mantiene estable (${num(b.x.kg30, 0)} kg, ${Math.round(v * 100)}% vs periodo anterior).` }); }
        const cambios = Object.keys({ ...b.porMat, ...b.matAnt }).map(m => ({ m, a: b.porMat[m] || 0, p: b.matAnt[m] || 0 })).filter(z => z.p >= 20 || z.a >= 20);
        const sube = cambios.filter(z => z.p > 0).sort((a, b2) => (b2.a / b2.p) - (a.a / a.p))[0];
        if (sube && sube.a / sube.p >= 1.3) r.push({ t: 'ok', m: `🟢 <b>${esc(sube.m)}</b> crece ${Math.round((sube.a / sube.p - 1) * 100)}% (${num(sube.p, 0)} → ${num(sube.a, 0)} kg). Buen momento para negociar mejores precios de venta.` });
        const baja = cambios.filter(z => z.p > 0).sort((a, b2) => (a.a / a.p) - (b2.a / b2.p))[0];
        if (baja && baja.a / baja.p <= 0.7) r.push({ t: 'alerta', m: `🔻 <b>${esc(baja.m)}</b> cae ${Math.round((1 - baja.a / baja.p) * 100)}%. Verificar si hay un problema de recolección o de precio de compra.` });
        const topR = top(b.porRec, 3), tot = b.x.kg30;
        if (tot > 0 && topR.length === 3 && topR.reduce((a, z) => a + z[1], 0) / tot >= 0.6) r.push({ t: '', m: `⚖️ Los 3 recicladores principales aportan el ${Math.round(topR.reduce((a, z) => a + z[1], 0) / tot * 100)}% del material. Dependencia alta: incentivar a más recicladores (puntos, capacitación, rutas).` });
        if (b.inactivos.length) r.push({ t: b.inactivos.length >= 5 ? 'alerta' : '', m: `😴 <b>${b.inactivos.length}</b> reciclador(es) verificado(s) no registran pesajes hace más de 30 días. Contactarlos para entender el motivo o reasignarlos a una ECA cercana.` });
        const dm = Object.entries(b.dow).sort((a, z) => z[1] - a[1])[0];
        if (dm && tot > 0) r.push({ t: '', m: `📅 El día de mayor recepción es <b>${DIAS[dm[0]]}</b> (${Math.round(dm[1] / tot * 100)}% del material). Reforzar personal y báscula ese día.` });
        const sinEca = b.porEca.sin; if (sinEca && sinEca / tot >= 0.2) r.push({ t: 'alerta', m: `🏢 El ${Math.round(sinEca / tot * 100)}% del material no está asociado a una ECA. Vincular a esos recicladores mejora la trazabilidad (SUI).` });
        return r;
    }

    /* ---------- sugerencias de rutas (aseo / alcaldía) ---------- */
    const dist = (a, b) => { const R = 6371, rad = Math.PI / 180, dl = (b[0] - a[0]) * rad, dn = (b[1] - a[1]) * rad, x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
    function sugerenciasRutas(d) {
        const pend = d.reportes.filter(r => r._estado !== 'resuelto' && r._geo), porB = {};
        pend.forEach(r => { const k = r._geo.municipio + '|' + r._geo.barrio; porB[k] = porB[k] || { geo: r._geo, n: 0, dias: {} }; porB[k].n++; porB[k].dias[r._d.getDay()] = (porB[k].dias[r._d.getDay()] || 0) + 1; });
        const norm = s => ctx.norm(s), planesAct = d.planes.filter(p => p.activo !== false);
        const cubierto = b => planesAct.filter(p => (p.barrios || []).some(x => norm(x.barrio) === norm(b.geo.barrio) && x.municipio === b.geo.municipio));
        const lista = Object.values(porB).map(b => ({ ...b, planes: cubierto(b) }));
        const ctr = b => [b.geo.centro_lat, b.geo.centro_lng];
        const sin = lista.filter(b => !b.planes.length).sort((a, z) => z.n - a.n);
        sin.forEach(b => { let mejor = null; planesAct.forEach(p => (p.barrios || []).forEach(x => { if (x.lat == null) return; const dk = dist(ctr(b), [x.lat, x.lng]); if (!mejor || dk < mejor.km) mejor = { plan: p, km: dk }; })); b.cercano = mejor; });
        const usados = new Set(), clusters = [];
        sin.forEach(b => {
            const id = b.geo.municipio + b.geo.barrio; if (usados.has(id)) return;
            const g = [b]; usados.add(id);
            sin.forEach(o => { const oid = o.geo.municipio + o.geo.barrio; if (!usados.has(oid) && g.length < 6 && o.geo.municipio === b.geo.municipio && dist(ctr(b), ctr(o)) <= 1.8) { g.push(o); usados.add(oid); } });
            const dias = {}; g.forEach(x => Object.entries(x.dias).forEach(([k, v]) => { dias[k] = (dias[k] || 0) + v; }));
            const dk = Object.entries(dias).sort((a, z) => z[1] - a[1])[0];
            clusters.push({ barrios: g.map(x => x.geo.barrio), municipio: b.geo.municipio, total: g.reduce((a, x) => a + x.n, 0), dia: dk ? DIAS[dk[0]] : 'Lunes' });
        });
        const ns = lista.map(b => b.n).sort((a, z) => a - z), p75 = ns.length ? ns[Math.floor(ns.length * 0.75)] : 3, umbral = Math.max(3, p75);
        const alta = lista.filter(b => b.planes.length && b.n >= umbral).sort((a, z) => z.n - a.n).slice(0, 6);
        return { sin: sin.slice(0, 8), clusters: clusters.filter(c => c.total >= 2).slice(0, 4), alta, hayGeo: d.barrios.length > 0, umbral };
    }
    function bloqueSugerencias(d) {
        const s = sugerenciasRutas(d);
        if (!s.hayGeo) return vacio('Para sugerir rutas necesito los barrios con límites. Ve a Rutas → Cargar límites de barrios (Floridablanca).');
        if (!s.sin.length && !s.alta.length) return `<div class="ia-item ok">✅ Todos los barrios con reportes pendientes ya están cubiertos por una ruta y ninguno supera la demanda esperada.</div>`;
        let h = '';
        if (s.clusters.length) h += `<h5 class="an-h5">🧭 Rutas nuevas sugeridas (barrios con reportes y sin ruta)</h5><div class="an-sug">${s.clusters.map((c, i) => `<div class="an-sug-c"><div><b>Ruta sugerida ${i + 1}</b> · ${esc(c.municipio)}<br><span>${c.barrios.map(esc).join(' → ')}</span><br><small>${c.total} reporte(s) pendientes · día sugerido: ${esc(c.dia)} · 06:00</small></div><button type="button" class="btn-publicar-banner" style="margin:0;" data-an="crear-ruta" data-i="${i}">🗺️ Crear en el mapa</button></div>`).join('')}</div>`;
        if (s.sin.length) h += `<h5 class="an-h5">📍 Barrios con reportes pendientes sin ruta</h5>${tabla(['Barrio', 'Reportes pendientes', 'Ruta más cercana (para ampliarla)'], s.sin.map(b => `<tr><td>${esc(b.geo.barrio)} <small>(Comuna ${b.geo.comuna})</small></td><td>${b.n}</td><td>${b.cercano ? esc(b.cercano.plan.nombre) + ` <small>(a ${num(b.cercano.km, 1)} km · ${esc(b.cercano.plan.dias || '')})</small>` : 'No hay rutas creadas'}</td></tr>`))}`;
        if (s.alta.length) h += `<h5 class="an-h5">🔁 Barrios con ruta pero alta demanda (≥ ${s.umbral} reportes pendientes)</h5>${tabla(['Barrio', 'Reportes pendientes', 'Ruta actual', 'Sugerencia'], s.alta.map(b => { const dias = String(b.planes[0].dias || ''), dp = Object.entries(b.dias).sort((a, z) => z[1] - a[1])[0], dn = dp ? DIAS[dp[0]] : null;
            return `<tr><td>${esc(b.geo.barrio)}</td><td>${b.n}</td><td>${esc(b.planes[0].nombre)} <small>(${esc(dias)})</small></td><td>${dn && !dias.includes(dn) ? `Agregar paso el <b>${esc(dn)}</b> (día con más reportes)` : 'Aumentar frecuencia o reforzar el recorrido'}</td></tr>`; }))}`;
        d._sug = s;
        return h;
    }
    const tabla = (cab, filas) => `<div style="overflow-x:auto;"><table class="an-tabla"><thead><tr>${cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${filas.join('')}</tbody></table></div>`;

    /* ---------- IA: reglas sobre reportes y rutas ---------- */
    function recsReportes(d, i, alcance) {
        const r = [];
        d.rutas.filter(x => Number(x.cumplimiento) < ctx.umbral()).slice(0, 4).forEach(x => r.push({ t: 'alerta', m: `🚛 <b>${esc(x.barrio)}</b> (${esc(x.municipio)}) opera al ${Number(x.cumplimiento)}%, bajo el umbral de ${ctx.umbral()}%. Revisar vehículo y personal, o reasignar la ruta.` }));
        const inc = d.novedades.filter(n => n.tipo === 'incumplida' && (n.fecha || '') >= isoD(new Date(Date.now() - 30 * DAY)));
        if (inc.length >= 2) { const m = top(contar(inc, n => (d.planes.find(p => String(p.id) === String(n.plan_id)) || {}).nombre || 'Ruta'), 1)[0]; r.push({ t: 'alerta', m: `⛔ ${inc.length} recorridos incumplidos en 30 días; la ruta con más fallas es <b>${esc(m[0])}</b> (${m[1]}). Programar mantenimiento del vehículo o un recorrido de respaldo.` }); }
        const fallas = d.novedades.filter(n => ['falla', 'cierre_vial', 'retraso'].includes(n.tipo) && (n.fecha || '') >= isoD(new Date(Date.now() - 30 * DAY)));
        if (fallas.length >= 3) { const t = top(contar(fallas, n => TIPOS_NOV[n.tipo]), 1)[0]; r.push({ t: '', m: `🔧 Las novedades más frecuentes del último mes son <b>${esc(t[0])}</b> (${t[1]} de ${fallas.length}). Definir un plan de contingencia para ese tipo de evento.` }); }
        const pm = top(contar(i.pend, x => x.municipio || 'Sin municipio'), 1)[0];
        if (alcance !== 'aseo' && pm && pm[1] >= 3 && pm[1] / i.pend.length >= 0.35) r.push({ t: '', m: `📍 <b>${esc(pm[0])}</b> concentra ${pm[1]} de ${i.pend.length} incidencias pendientes (${Math.round(pm[1] / i.pend.length * 100)}%). Priorizar una cuadrilla de apoyo.` });
        const pb = top(contar(i.pend.filter(x => x._barrio), x => x._barrio), 1)[0];
        if (pb && pb[1] >= 3) r.push({ t: '', m: `🏘️ El barrio con más pendientes es <b>${esc(pb[0])}</b> (${pb[1]}). ${alcance === 'aseo' ? 'Candidato a ruta nueva o a mayor frecuencia (ver sugerencias).' : 'Coordinar una intervención integral con las dependencias.'}` });
        const pc = top(contar(i.pend, x => x._tabla), 1)[0];
        if (alcance !== 'aseo' && pc && pc[1] >= 3) r.push({ t: '', m: `📋 La categoría con más pendientes es <b>${esc(nombreTabla(pc[0]))}</b> (${pc[1]}). Asignar un responsable dedicado.` });
        if (i.tpr !== null && i.tpr > 24) r.push({ t: 'alerta', m: `⏱️ El tiempo promedio de primera respuesta (${horasFmt(i.tpr)}) supera las 24 horas. Definir turnos de atención y responder primero lo más antiguo.` });
        if (i.tasa !== null && i.total >= 5 && i.tasa < 60) r.push({ t: 'alerta', m: `📉 La tasa de resolución es ${i.tasa.toFixed(1)}%. Considerar refuerzo temporal de recursos operativos.` });
        const antes = d.reportes.filter(x => Date.now() - x._d <= 30 * DAY).length, prev = d.reportes.filter(x => { const t = Date.now() - x._d; return t > 30 * DAY && t <= 60 * DAY; }).length;
        if (prev >= 5 && antes >= prev * 1.3) r.push({ t: 'alerta', m: `📈 Los reportes de los últimos 30 días (${antes}) crecieron ${Math.round((antes / prev - 1) * 100)}% frente a los 30 anteriores (${prev}). Anticipar capacidad operativa.` });
        const dd = top(contar(d.reportes, x => x._d.getDay()), 1)[0];
        if (dd && d.reportes.length >= 10) r.push({ t: '', m: `📅 El día con más reportes es <b>${DIAS[dd[0]]}</b> (${Math.round(dd[1] / d.reportes.length * 100)}%). Programar recorridos de refuerzo para ese día.` });
        return r;
    }
    const listaIA = recs => { const ord = { alerta: 0, '': 1, ok: 2 }, l = (recs.length ? recs : [{ t: 'ok', m: '✅ Operación estable: los indicadores están dentro de lo esperado.' }]).slice().sort((a, b) => (ord[a.t] ?? 1) - (ord[b.t] ?? 1)), it = x => `<div class="ia-item ${x.t}">${x.m}</div>`;
        return `<div class="an-ia">${l.slice(0, 6).map(it).join('')}${l.length > 6 ? `<details class="an-mas"><summary>Ver ${l.length - 6} recomendación(es) más</summary><div class="an-ia" style="margin-top:8px;">${l.slice(6).map(it).join('')}</div></details>` : ''}</div><p class="an-ayuda">Generado el ${new Date().toLocaleString('es-CO')} con los datos actuales (motor de reglas, no un modelo externo).</p>`; };
    const tarjetasCiclo = (b) => kpi('Kg reciclados (30 días)', num(b.x.kg30, 0), delta(b.x.kg30, b.x.kgAnt)) + kpi('Pesajes (30 días)', b.x.p30.length, `${(b.x.kg30 / 1000).toFixed(2)} toneladas`)
        + kpi('Recicladores activos', `${b.activos.size}<span style="font-size:15px; color:#64748b; font-weight:600;"> / ${b.c.recicladores.length}</span>`, `${b.c.recicladores.filter(r => r.en_linea).length} en línea ahora`) + kpi('Empresas ECA', b.c.empresas.length, `${Object.keys(b.porEca).filter(k => k !== 'sin').length} con recepción en 30 días`);

    /* ---------- ANALÍTICA GENERAL (panorama) ---------- */
    async function cargarPanorama() {
        const c = document.getElementById('panoramaContenido');
        if (!c) return;
        c.innerHTML = '<p class="an-ayuda">Preparando el panorama...</p>';
        try {
            const d = await cargarDatos({ ciclo: true }), i = indicadores(d), b = d.ciclo ? bloquesCiclo(d) : null, ok = b && !b.aviso;
            const rutasOk = ctx.puede('gestion_rutas') || ctx.rol().superadmin;
            let h = `<div class="kpi-grid">`;
            if (d.verRep) h += kpi('Reportes en el periodo', i.total, `${i.pend.length} pendientes`) + kpi('Tasa de resolución', i.tasa === null ? 'N/D' : i.tasa.toFixed(0) + '%', `${i.resueltos} resueltos`);
            if (rutasOk) h += kpi('Rutas hoy', i.hoy.length, `${i.hoyEst('en_curso')} en curso · ${i.hoyEst('completada')} completadas`);
            if (ok) h += kpi('Kg reciclados (30 días)', num(b.x.kg30, 0), delta(b.x.kg30, b.x.kgAnt));
            h += `</div><div class="an-grid">`;
            if (d.verRep) h += panel('Reportes por semana', bloqueSerieReportes(d), 'Recibidos y resueltos en las últimas 12 semanas.', 2) + panel('Reportes por categoría', bloquePorCategoria(d)) + panel('Reportes por municipio', bloquePorMunicipio(d));
            if (rutasOk) h += panel('Estado de las rutas hoy', bloqueEstadoHoy(i));
            if (ok) h += panel('Material reciclado por mes', b.serie, 'Kilogramos recibidos en las ECA.', 2) + panel('Por tipo de material (30 días)', b.donaMat);
            else if (b && b.aviso) h += panel('Reciclaje', `<div class="an-vacio">${b.aviso}</div>`);
            h += `</div>`;
            if (!d.verRep && !rutasOk && !ok) h = vacio('Tu perfil aún no tiene módulos con datos para mostrar.');
            c.innerHTML = h + `<p class="an-ayuda" style="margin-top:12px;">Para análisis avanzado y recomendaciones de la IA, abre <b>Plan Premium</b>.</p>`;
        } catch (e) { c.innerHTML = `<p style="color:#b91c1c;">Error al preparar el panorama: ${esc(e.message)}</p>`; }
    }

    /* ---------- PREMIUM ---------- */
    async function vistaAlcaldia(d) {
        const i = indicadores(d), b = d.ciclo ? bloquesCiclo(d) : null, ok = b && !b.aviso;
        let h = `<div class="kpi-grid">${kpi('Cumplimiento logístico (ICLR)', i.iclr === null ? 'N/D' : i.iclr.toFixed(1) + '%', `${i.nRutas} ruta(s) · umbral ${ctx.umbral()}%`, i.iclr !== null && i.iclr < ctx.umbral() ? 'mal' : '')}
            ${kpi('Tasa de resolución', i.tasa === null ? 'N/D' : i.tasa.toFixed(1) + '%', `${i.resueltos} de ${i.total} reportes`)}
            ${kpi('Tiempo de primera respuesta', horasFmt(i.tpr), `${i.nHoras} caso(s) con respuesta`)}
            ${kpi('Pendientes por atender', i.pend.length, 'Reportes sin resolver')}
            ${ok ? kpi('Kg reciclados (30 días)', num(b.x.kg30, 0), delta(b.x.kg30, b.x.kgAnt)) : ''}</div>`;
        const recs = recsReportes(d, i, 'alcaldia').concat(ok ? recsCiclo(b) : []);
        h += `<section class="an-card an-w3"><h4>🤖 Asistente IA · Prioridades para decidir</h4>${listaIA(recs)}</section>`;
        h += `<h3 class="an-sec">Ciudad y reportes ciudadanos</h3><div class="an-grid">`
            + panel('Reportes recibidos vs resueltos', bloqueSerieReportes(d), 'Últimas 12 semanas. Si las dos líneas se separan, la capacidad de respuesta no alcanza.', 2) + panel('Por categoría', bloquePorCategoria(d))
            + panel('Por municipio', bloquePorMunicipio(d), 'Pendientes frente a resueltos.') + panel('Comunas de Floridablanca', bloqueComunas(d), 'Ubicación por GPS del reporte.') + panel('Barrios con más pendientes', bloqueBarrios(d, 10))
            + panel('Tiempo de primera respuesta por categoría', bloqueTiempos(d)) + panel('Día de la semana con más reportes', bloqueDiaSemana(d)) + `</div>`;
        h += `<h3 class="an-sec">Logística de recolección</h3><div class="an-grid">` + panel('Rutas hoy', bloqueEstadoHoy(i)) + panel('Cumplimiento por ruta', bloqueRutasCumplimiento(d)) + panel('Novedades en el camino (30 días)', bloqueNovedades(d)) + panel('Recorridos completados vs incumplidos', bloqueCumplimientoHistorico(d)) + `</div>`;
        h += `<section class="an-card an-w3"><h4>🧭 Mejores rutas según los reportes</h4>${bloqueSugerencias(d)}</section>`;
        h += `<h3 class="an-sec">Reciclaje inclusivo</h3>` + (ok ? `<div class="an-grid">${panel('Material reciclado por mes', b.serie, null, 2)}${panel('Por material (30 días)', b.donaMat)}${panel('Recicladores con más aporte (30 días)', b.topRec)}${panel('Kg por empresa ECA (30 días)', b.topEca)}</div>` : `<div class="an-vacio">${b ? b.aviso : 'Sin acceso a CicloGo.'}</div>`);
        return h;
    }
    async function vistaAseo(d) {
        const i = indicadores(d);
        const cerr = d.novedades.filter(n => ['finalizada', 'incumplida'].includes(n.tipo) && (n.fecha || '') >= isoD(new Date(Date.now() - 30 * DAY))), okc = cerr.filter(n => n.tipo === 'finalizada').length;
        let h = `<div class="kpi-grid">${kpi('Cumplimiento logístico (ICLR)', i.iclr === null ? 'N/D' : i.iclr.toFixed(1) + '%', `${i.nRutas} ruta(s) · umbral ${ctx.umbral()}%`, i.iclr !== null && i.iclr < ctx.umbral() ? 'mal' : '')}
            ${kpi('Recorridos de hoy', i.hoy.length, `${i.hoyEst('completada')} completados · ${i.hoyEst('en_curso')} en curso · ${i.hoyEst('incumplida')} incumplidos`)}
            ${kpi('Cumplimiento 30 días', cerr.length ? Math.round(okc / cerr.length * 100) + '%' : 'N/D', `${okc} completados de ${cerr.length} cerrados`)}
            ${kpi('Reportes pendientes', i.pend.length, 'De tu competencia')}
            ${kpi('Primera respuesta', horasFmt(i.tpr), `${i.nHoras} caso(s)`)}</div>`;
        const recs = recsReportes(d, i, 'aseo');
        const s = sugerenciasRutas(d); if (s.clusters[0]) recs.unshift({ t: 'alerta', m: `🧭 ${s.sin.length} barrio(s) con reportes pendientes <b>no tienen ruta</b>. Mira la ruta nueva sugerida más abajo (${s.clusters[0].barrios.map(esc).join(', ')}).` });
        h += `<section class="an-card an-w3"><h4>🤖 Asistente IA · Optimización de flota y rutas</h4>${listaIA(recs)}</section>`;
        h += `<h3 class="an-sec">Reportes que llegan a tu operación</h3><div class="an-grid">` + panel('Reportes por semana', bloqueSerieReportes(d), null, 2) + panel('Barrios con más pendientes', bloqueBarrios(d, 10), 'Donde más se necesita presencia.')
            + panel('Día de la semana con más reportes', bloqueDiaSemana(d), 'Útil para programar recorridos de refuerzo.') + panel('Por municipio', bloquePorMunicipio(d)) + panel('Comunas de Floridablanca', bloqueComunas(d)) + `</div>`;
        h += `<h3 class="an-sec">Rutas y novedades</h3><div class="an-grid">` + panel('Rutas hoy', bloqueEstadoHoy(i)) + panel('Cumplimiento por ruta', bloqueRutasCumplimiento(d)) + panel('Novedades en el camino (30 días)', bloqueNovedades(d), 'Qué está afectando los recorridos.') + panel('Recorridos completados vs incumplidos', bloqueCumplimientoHistorico(d)) + `</div>`;
        h += `<section class="an-card an-w3"><h4>🧭 Rutas sugeridas a partir de los reportes</h4><p class="an-ayuda">Cruza los reportes pendientes (por barrio) con las rutas que ya tienes programadas.</p>${bloqueSugerencias(d)}</section>`;
        return h;
    }
    async function vistaRecicladores(d) {
        const b = d.ciclo ? bloquesCiclo(d) : null;
        if (!b || b.aviso) return `<div class="an-vacio">${b ? b.aviso : 'Sin acceso a los datos de CicloGo.'}</div>`;
        let h = `<div class="kpi-grid">${tarjetasCiclo(b)}</div>`;
        h += `<section class="an-card an-w3"><h4>🤖 Asistente IA · Decisiones para reciclaje</h4>${listaIA(recsCiclo(b))}</section>`;
        h += `<h3 class="an-sec">Volumen y materiales</h3><div class="an-grid">` + panel('Kilogramos por mes', b.serie, 'Últimos 6 meses.', 2) + panel('Material por tipo (30 días)', b.donaMat)
            + panel('Día de la semana con más recepción', b.diaSem, 'Para planear personal y báscula.') + panel('Calidad del material (30 días)', dona(Object.entries(b.calidad).map(([label, value]) => ({ label, value })), { centro: 'pesajes' })) + `</div>`;
        h += `<h3 class="an-sec">Personas y empresas</h3><div class="an-grid">` + panel('Recicladores con más aporte (30 días)', b.topRec) + panel('Kg por empresa ECA (30 días)', b.topEca)
            + panel('Recicladores sin pesajes en 30 días', b.inactivos.length ? tabla(['Reciclador', 'Último pesaje'], b.inactivos.slice(0, 10).map(r => `<tr><td>${esc(r.nombre_completo || '—')}</td><td>${b.c.pesajes.length && Date.now() ? (function (u) { return u ? new Date(u).toLocaleDateString('es-CO') : 'Nunca'; })(Math.max(0, ...b.c.pesajes.filter(p => p.reciclador_id === r.id).map(p => new Date(p.created_at).getTime())) || 0) : 'Nunca'}</td></tr>`)) + (b.inactivos.length > 10 ? `<p class="an-ayuda">y ${b.inactivos.length - 10} más…</p>` : '') : vacio('Todos los recicladores verificados tienen actividad reciente.'), 'Candidatos a seguimiento.') + `</div>`;
        return h;
    }
    async function vistaPGIRS(d) {
        const i = indicadores(d), b = d.ciclo ? bloquesCiclo(d) : null, ok = b && !b.aviso;
        const kw = (r, re) => re.test(ctx.norm([r.tipo_afectacion, r.tipo_residuo, r.nombre_reporte, r.tipo_situacion].filter(Boolean).join(' ')));
        const poda = d.reportes.filter(r => kw(r, /poda|cesped|arbol/)), rcd = d.reportes.filter(r => kw(r, /escombro|construccion|demolicion|rcd/)), esp = d.reportes.filter(r => kw(r, /voluminoso|colchon|mueble|llanta|electr|peligros|especial/));
        const rutasSin = d.rutas.length, inc = d.novedades.filter(n => n.tipo === 'incumplida').length;
        const filas = [
            ['Institucional', 'Tasa de resolución de reportes', i.tasa === null ? 'N/D' : i.tasa.toFixed(1) + '%', `${i.resueltos} de ${i.total}`],
            ['Institucional', 'Tiempo de primera respuesta', horasFmt(i.tpr), `${i.nHoras} caso(s)`],
            ['Recolección y transporte', 'Cumplimiento de rutas (ICLR)', i.iclr === null ? 'N/D' : i.iclr.toFixed(1) + '%', `${i.nRutas} ruta(s) activas`],
            ['Recolección y transporte', 'Recorridos incumplidos (120 d)', inc, `${rutasSin} barrio(s) con servicio programado`],
            ['Corte de césped y poda', 'Reportes ciudadanos', poda.length, 'Por palabras clave del reporte'],
            ['Residuos de construcción y demolición', 'Reportes ciudadanos', rcd.length, 'Escombros y RCD'],
            ['Residuos especiales', 'Reportes ciudadanos', esp.length, 'Voluminosos, RAEE, llantas, peligrosos'],
            ['Aprovechamiento', 'Kg aprovechados (30 días)', ok ? num(b.x.kg30, 0) + ' kg' : 'Sin dato', ok ? delta(b.x.kg30, b.x.kgAnt) : 'Requiere CicloGo'],
            ['Inclusión de recicladores', 'Recicladores verificados / activos (30 d)', ok ? `${b.c.recicladores.filter(r => r.verificado !== false).length} / ${b.activos.size}` : 'Sin dato', ok ? 'Recicladores de su alcance' : 'Requiere CicloGo'],
            ['Barrido y limpieza · Lavado · Disposición final · Riesgo · Rural', 'Sin fuente de datos todavía', '—', 'Se habilitan al conectar su fuente']
        ];
        let h = `<div class="kpi-grid">${kpi('Reportes ciudadanos', i.total, 'En su territorio')}${kpi('Pendientes', i.pend.length, 'Sin resolver')}${kpi('Cumplimiento de rutas (ICLR)', i.iclr === null ? 'N/D' : i.iclr.toFixed(1) + '%', `${i.nRutas} ruta(s)`)}${ok ? kpi('Kg aprovechados (30 días)', num(b.x.kg30, 0), delta(b.x.kg30, b.x.kgAnt)) : ''}</div>`;
        h += `<section class="an-card an-w3"><h4>📘 Indicadores por programa del PGIRS</h4><p class="an-ayuda">Insumo para el seguimiento del Plan de Gestión Integral de Residuos Sólidos (Res. 754 de 2014). Los datos salen de los reportes, rutas y pesajes del territorio asignado.</p>`
            + tabla(['Programa', 'Indicador', 'Valor', 'Detalle'], filas.map(f => `<tr><td>${esc(f[0])}</td><td>${esc(f[1])}</td><td><strong>${f[2]}</strong></td><td>${f[3]}</td></tr>`)) + `</section>`;
        h += `<div class="an-grid">` + panel('Reportes por semana', bloqueSerieReportes(d), null, 2) + panel('Por municipio', bloquePorMunicipio(d)) + panel('Barrios con más pendientes', bloqueBarrios(d, 10))
            + (ok ? panel('Material aprovechado por mes', b.serie, null, 2) + panel('Por material (30 días)', b.donaMat) : '') + `</div>`;
        return h;
    }
    const VISTAS = { pgirs: ['📘 PGIRS', vistaPGIRS, { ciclo: true, premium: true }], alcaldia: ['🏛️ Alcaldía', vistaAlcaldia, { ciclo: true, premium: true }], aseo: ['🚛 Empresa de aseo', vistaAseo, { ciclo: false, premium: true }], recicladores: ['♻️ Recicladores', vistaRecicladores, { ciclo: true, premium: true }] };

    async function cargarPremium() {
        const tabs = document.getElementById('premiumTabs'), cont = document.getElementById('premiumContenido'), bit = document.getElementById('bitacoraWrap');
        if (!cont) return;
        const rol = ctx.rol(), al = ctx.alcance ? ctx.alcance() : {}, claves = rol.superadmin ? ['alcaldia', 'aseo', 'recicladores', 'pgirs'] : (Array.isArray(al.vistas) && al.vistas.length ? al.vistas.filter(k => VISTAS[k]) : (VISTAS[rol.dep] ? [rol.dep] : []));
        if (!claves.length) { tabs.innerHTML = ''; cont.innerHTML = vacio('Tu dependencia no tiene un panel premium propio. Pide al superadmin que te asigne uno.'); if (bit) bit.style.display = 'none'; return; }
        if (!claves.includes(vistaPremium)) vistaPremium = claves[0];
        tabs.innerHTML = claves.length > 1 ? claves.map(k => `<button type="button" class="an-tab ${k === vistaPremium ? 'act' : ''}" data-an="vista" data-k="${k}">${VISTAS[k][0]}</button>`).join('') : `<h3 class="an-tit">${VISTAS[vistaPremium][0]}</h3>`;
        cont.innerHTML = '<p class="an-ayuda">Analizando datos...</p>';
        try {
            const [, fn, need] = VISTAS[vistaPremium], d = await cargarDatos(need);
            cont.innerHTML = await fn(d); cont._d = d;
            if (bit) { bit.style.display = (vistaPremium === 'alcaldia') ? '' : 'none'; if (vistaPremium === 'alcaldia') ctx.bitacora(); }
        } catch (e) { cont.innerHTML = `<p style="color:#b91c1c;">Error al generar la analítica: ${esc(e.message)}</p>`; }
    }

    document.addEventListener('click', e => {
        const b = e.target.closest('[data-an]'); if (!b) return;
        if (b.dataset.an === 'vista') { vistaPremium = b.dataset.k; cache = null; cargarPremium(); }
        else if (b.dataset.an === 'crear-ruta') {
            const d = document.getElementById('premiumContenido')._d, c = d && d._sug && d._sug.clusters[Number(b.dataset.i)];
            if (c) ctx.crearRuta({ nombre: 'Ruta sugerida – ' + c.barrios[0], municipio: c.municipio, barrios: c.barrios, dia: c.dia, hora: '06:00' });
        }
    });
    return { cargarPanorama, cargarPremium, limpiarCache: () => { cache = null; }, _t: { indicadores, sugerenciasRutas, localizar } };
}

/* Superadmin · Territorios, organizaciones y accesos (multi-cliente)
   Requiere el SQL 30. Todo se guarda en la base y la base hace cumplir el alcance (RLS). */
export function crearTerritorios(ctx) {
    const db = ctx.db, esc = ctx.esc;
    let muns = [], orgs = [], om = [], ob = [], rb = [], users = [], ciclo = null;
    const geoCache = {};

    const TIPOS = {
        alcaldia: '🏛️ Alcaldía', empresa_aseo_publica: '🚛 Empresa de aseo · pública', empresa_aseo_privada: '🚛 Empresa de aseo · privada',
        eca_publica: '🏢 ECA · pública', eca_privada: '🏢 ECA · privada', asociacion_recicladores: '♻️ Asociación de recicladores',
        autoridad_ambiental: '🌿 Autoridad ambiental (CDMB)', otra: '📁 Otra'
    };
    const VISTAS = { alcaldia: '🏛️ Alcaldía', aseo: '🚛 Empresa de aseo', recicladores: '♻️ Recicladores', pgirs: '📘 PGIRS' };
    const BASE = ['inicio_resumen', 'analitica_kpi', 'plan_premium'];
    const PLANTILLAS = {
        alcaldia: { m: [...BASE, 'reportes_abandonados', 'reportes_violencia_animal', 'reportes_ciudadania', 'gestion_rutas', 'operacion_recicladores', 'operacion_pesajes', 'operacion_ecas'], v: ['alcaldia', 'pgirs'] },
        empresa_aseo_publica: { m: [...BASE, 'reportes_abandonados', 'gestion_rutas'], v: ['aseo'] },
        empresa_aseo_privada: { m: [...BASE, 'reportes_abandonados', 'gestion_rutas'], v: ['aseo'] },
        eca_publica: { m: [...BASE, 'operacion_recicladores', 'operacion_pesajes', 'operacion_ecas'], v: ['recicladores'] },
        eca_privada: { m: [...BASE, 'operacion_recicladores', 'operacion_pesajes', 'operacion_ecas'], v: ['recicladores'] },
        asociacion_recicladores: { m: [...BASE, 'operacion_recicladores', 'operacion_pesajes'], v: ['recicladores'] },
        autoridad_ambiental: { m: [...BASE, 'reportes_abandonados', 'reportes_violencia_animal'], v: ['pgirs'] },
        otra: { m: [...BASE], v: [] }
    };
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const orgDe = id => orgs.find(o => o.id === id);
    const munsDe = id => om.filter(x => x.organizacion_id === id).map(x => x.municipio);
    const el = id => document.getElementById(id);
    const aviso = (id, t, ok) => { const e = el(id); if (e) { e.textContent = t; e.style.color = ok ? '#15803d' : '#b91c1c'; } };

    async function cargarTodo() {
        const [a, b, c, d, e, f] = await Promise.all([
            db.from('territorios_municipios').select('*').order('orden'), db.from('organizaciones').select('*').order('nombre'),
            db.from('organizacion_municipios').select('*'), db.from('organizacion_barrios').select('*'),
            db.from('reciclador_barrios').select('*').order('reciclador_nombre'), db.from('usuarios_panel').select('*').order('nombre')]);
        const err = [a, b, c, d, e, f].find(r => r.error);
        if (err) return err.error.message;
        muns = a.data || []; orgs = b.data || []; om = c.data || []; ob = d.data || []; rb = e.data || []; users = f.data || [];
        return null;
    }
    async function cargarCiclo() {
        if (ciclo) return ciclo;
        const [r, e] = await Promise.all([ctx.puente('recicladores'), ctx.puente('empresas')]);
        ciclo = { recicladores: r || [], empresas: e || [], error: (!r && !e) ? (ctx.puenteError() || 'Sin conexión con CicloGo') : null };
        return ciclo;
    }
    async function barriosDe(mun) {
        if (geoCache[mun]) return geoCache[mun];
        const { data } = await db.from('barrios_geo').select('barrio,comuna_nombre').eq('municipio', mun).order('barrio');
        return (geoCache[mun] = data || []);
    }

    /* ---------- 1) Municipios ---------- */
    function pintarMunicipios() {
        const c = el('terrMunicipios'); if (!c) return;
        const grupos = ['Área metropolitana', 'Cercano', 'Otro'];
        c.innerHTML = `<form data-tr="mun-nuevo" class="form-banner-grid" style="margin-bottom:10px;">
            <div class="form-banner-group"><label>Agregar municipio</label><input id="munNombre" placeholder="Ej. Barrancabermeja" required></div>
            <div class="form-banner-group"><label>Grupo</label><select id="munGrupo">${grupos.map(g => `<option>${g}</option>`).join('')}</select></div>
            <div class="form-banner-group" style="align-self:end;"><button class="btn-publicar-banner" type="submit">➕ Agregar</button></div></form>
            <div style="overflow-x:auto;"><table class="tabla-admin"><thead><tr><th>Municipio</th><th>Grupo</th><th>CDMB</th><th>Habilitado</th><th>Organizaciones</th></tr></thead><tbody>
            ${muns.map(m => `<tr><td><strong>${esc(m.nombre)}</strong><br><small>${esc(m.departamento)}</small></td><td>${esc(m.grupo)}</td>
              <td><label><input type="checkbox" data-tr="mun-cdmb" data-id="${m.id}" ${m.cdmb ? 'checked' : ''}> en jurisdicción</label></td>
              <td><label><input type="checkbox" data-tr="mun-activo" data-id="${m.id}" ${m.activo ? 'checked' : ''}> activo</label></td>
              <td>${om.filter(x => norm(x.municipio) === norm(m.nombre)).length}</td></tr>`).join('')}</tbody></table></div>
            <p style="font-size:12px;color:#666;">La marca CDMB es una referencia inicial: confírmala con la corporación antes de usarla en reportes oficiales.</p>`;
    }

    /* ---------- 2) Organizaciones ---------- */
    const CAMPOS = [['nombre', 'Razón social / nombre *', 'text'], ['nit', 'NIT *', 'text'], ['representante', 'Representante legal *', 'text'], ['doc_representante', 'Documento del representante *', 'text'],
        ['telefono', 'Teléfono *', 'tel'], ['correo', 'Correo de contacto *', 'email'], ['direccion', 'Dirección *', 'text'], ['municipio_sede', 'Municipio sede *', 'mun'],
        ['registro', 'Registro RUPS / habilitación', 'text'], ['resolucion', 'Resolución, acuerdo o contrato', 'text'], ['fecha_constitucion', 'Fecha de constitución', 'date']];
    const OPCIONALES = ['registro', 'resolucion', 'fecha_constitucion'];
    function camposOrg(p, o) {
        o = o || {};
        return CAMPOS.map(([k, et, ty]) => `<div class="form-banner-group"><label>${et}</label>${ty === 'mun'
            ? `<select id="${p}-${k}" ${OPCIONALES.includes(k) ? '' : 'required'}><option value="">— Elegir —</option>${muns.map(m => `<option ${m.nombre === o[k] ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select>`
            : `<input id="${p}-${k}" type="${ty}" value="${esc(o[k] || '')}" ${OPCIONALES.includes(k) ? '' : 'required'}>`}</div>`).join('');
    }
    function leerOrg(p) { const r = {}; CAMPOS.forEach(([k]) => { const v = el(`${p}-${k}`).value.trim(); r[k] = v || null; }); return r; }
    function faltaOrg(r) { const f = CAMPOS.find(([k]) => !OPCIONALES.includes(k) && !r[k]); return f ? 'Falta: ' + f[1].replace(' *', '') : null; }
    function formOrg(cic) {
        return `<form data-tr="org-nueva"><h4 style="margin:0 0 8px;">➕ Nueva organización (datos de identificación)</h4>
          <div class="form-banner-grid"><div class="form-banner-group"><label>Tipo *</label><select id="orgTipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
          ${camposOrg('on')}
          <div class="form-banner-group"><label>Empresa en CicloGo (si ya existe allí)</label><select id="orgCiclo"><option value="">— Ninguna —</option>${(cic.empresas || []).map(e => `<option value="${esc(String(e.id))}">${esc(e.nombre || e.id)}</option>`).join('')}</select></div></div>
          <label style="font-size:13px;font-weight:600;">Municipios donde opera / que verá *</label>
          <div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0 10px;">${muns.filter(m => m.activo).map(m => `<label style="font-size:13px;"><input type="checkbox" class="onMun" value="${esc(m.nombre)}"> ${esc(m.nombre)}</label>`).join('')}</div>
          <button class="btn-publicar-banner" type="submit">➕ Crear organización</button></form>`;
    }
    function tarjetaOrg(o, cic) {
        const ms = munsDe(o.id), bs = ob.filter(x => x.organizacion_id === o.id), rbs = rb.filter(x => x.organizacion_id === o.id);
        const us = users.filter(u => u.organizacion_id === o.id);
        const emp = (cic.empresas || []).find(e => String(e.id) === String(o.ciclogo_empresa_id));
        return `<div class="card-admin-banner" style="margin-bottom:12px;${o.activo ? '' : 'opacity:.6;'}" data-org="${o.id}">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;">
            <h3 style="margin:0;">${esc(o.nombre)} <small style="font-weight:400;">· ${TIPOS[o.tipo] || o.tipo}</small></h3>
            <span><button class="btn-chat-admin" data-tr="org-activo" data-id="${o.id}" data-v="${!o.activo}">${o.activo ? '⏸️ Suspender' : '▶️ Reactivar'}</button>
            <button class="btn-chat-admin" data-tr="org-borrar" data-id="${o.id}" style="background:#c62828;">🗑️</button></span></div>
          <p style="font-size:12px;color:#666;margin:4px 0 8px;">${o.nit ? 'NIT ' + esc(o.nit) + ' · ' : ''}${esc(o.representante || 'Sin representante')}${o.telefono ? ' · ' + esc(o.telefono) : ''}${o.correo ? ' · ' + esc(o.correo) : ''} · ${us.length} usuario(s)${emp ? ' · CicloGo: ' + esc(emp.nombre) : ''}</p>
          <label style="font-weight:600;font-size:13px;">Municipios que ve</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin:4px 0 8px;">${muns.filter(m => m.activo).map(m => `<label style="font-size:13px;"><input type="checkbox" data-tr="org-mun" data-id="${o.id}" data-m="${esc(m.nombre)}" ${ms.some(x => norm(x) === norm(m.nombre)) ? 'checked' : ''}> ${esc(m.nombre)}</label>`).join('')}</div>
          <details data-det="bar-${o.id}"><summary style="cursor:pointer;font-weight:600;font-size:13px;">📍 Barrios asignados (${bs.length ? bs.length + ' barrio(s)' : 'todos los de sus municipios'})</summary><div id="bar-${o.id}" style="margin-top:8px;">Cargando…</div></details>
          <details style="margin-top:6px;" data-det="rec-${o.id}"><summary style="cursor:pointer;font-weight:600;font-size:13px;">♻️ Recicladores y barrios acordados (${new Set(rbs.map(x => x.reciclador_id)).size})</summary><div id="rec-${o.id}" style="margin-top:8px;">Cargando…</div></details>
          <details style="margin-top:6px;"><summary style="cursor:pointer;font-weight:600;font-size:13px;">⚙️ Datos y CicloGo</summary>
            <div class="form-banner-grid" style="margin-top:8px;">${camposOrg('ed' + o.id.replace(/-/g, ''), o)}
              <div class="form-banner-group"><label>Empresa CicloGo</label><select id="ed-ci-${o.id}"><option value="">— Ninguna —</option>${(cic.empresas || []).map(e => `<option value="${esc(String(e.id))}" ${String(e.id) === String(o.ciclogo_empresa_id) ? 'selected' : ''}>${esc(e.nombre || e.id)}</option>`).join('')}</select></div>
              <div class="form-banner-group" style="align-self:end;"><button class="btn-publicar-banner" data-tr="org-guardar" data-id="${o.id}">💾 Guardar</button></div></div></details></div>`;
    }
    async function pintarOrganizaciones() {
        const c = el('terrOrganizaciones'); if (!c) return;
        const cic = await cargarCiclo();
        const fila = o => { const ms = munsDe(o.id), n = users.filter(u => u.organizacion_id === o.id).length, emp = (cic.empresas || []).find(e => String(e.id) === String(o.ciclogo_empresa_id));
            return `<tr style="${o.activo ? '' : 'opacity:.55;'}"><td><strong>${esc(o.nombre)}</strong><br><small>${TIPOS[o.tipo] || o.tipo}</small></td>
              <td>${esc(o.nit || '—')}</td><td>${esc(ms.join(', ') || '—')}</td>
              <td>${esc(o.representante || '—')}<br><small>${esc(o.telefono || '')} ${esc(o.correo || '')}</small></td>
              <td>${n}</td><td><span class="status-badge ${o.activo ? 'status-resuelto' : 'status-cancelada'}">${o.activo ? 'Activa' : 'Suspendida'}</span></td>
              <td style="white-space:nowrap;"><button class="btn-chat-admin" data-tr="org-editar" data-id="${o.id}">✏️ Datos</button>
                <button class="btn-chat-admin" data-tr="org-activo" data-id="${o.id}" data-v="${!o.activo}">${o.activo ? '⏸️' : '▶️'}</button>
                <button class="btn-chat-admin" data-tr="org-borrar" data-id="${o.id}" style="background:#c62828;">🗑️</button></td></tr>
              <tr id="edit-${o.id}" style="display:none;"><td colspan="7" style="background:#f8fafc;">
                <div class="form-banner-grid">${camposOrg('ed' + o.id.replace(/-/g, ''), o)}
                  <div class="form-banner-group"><label>Empresa CicloGo</label><select id="ed-ci-${o.id}"><option value="">— Ninguna —</option>${(cic.empresas || []).map(e => `<option value="${esc(String(e.id))}" ${String(e.id) === String(o.ciclogo_empresa_id) ? 'selected' : ''}>${esc(e.nombre || e.id)}</option>`).join('')}</select></div></div>
                <label style="font-size:13px;font-weight:600;">Municipios</label>
                <div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0 8px;">${muns.filter(m => m.activo).map(m => `<label style="font-size:13px;"><input type="checkbox" data-tr="org-mun" data-id="${o.id}" data-m="${esc(m.nombre)}" ${ms.some(x => norm(x) === norm(m.nombre)) ? 'checked' : ''}> ${esc(m.nombre)}</label>`).join('')}</div>
                <button class="btn-publicar-banner" data-tr="org-guardar" data-id="${o.id}">💾 Guardar datos</button></td></tr>`; };
        c.innerHTML = `<p style="font-size:13px;color:#555;margin:0 0 10px;">Las organizaciones se crean junto con su usuario en <b>Usuarios del panel</b>. Aquí ves el listado y puedes corregir sus datos.</p>`
            + (cic.error ? `<p style="font-size:12px;color:#b45309;">CicloGo no respondió (${esc(cic.error)}).</p>` : '')
            + (orgs.length ? `<div style="overflow-x:auto;"><table class="tabla-admin"><thead><tr><th>Organización</th><th>NIT</th><th>Municipios</th><th>Representante</th><th>Usuarios</th><th>Estado</th><th></th></tr></thead><tbody>${orgs.map(fila).join('')}</tbody></table></div>` : '<p>Aún no hay organizaciones.</p>');
    }
    async function pintarBarrios(id) {
        const cont = el('bar-' + id); if (!cont) return;
        const ms = munsDe(id); if (!ms.length) { cont.innerHTML = '<small>Primero marca los municipios.</small>'; return; }
        const mias = ob.filter(x => x.organizacion_id === id);
        let h = '<small>Sin marcar ningún barrio de un municipio = ve todos sus barrios. Marca solo los acordados con la alcaldía.</small>';
        for (const m of ms) {
            const geo = await barriosDe(m), sel = mias.filter(x => norm(x.municipio) === norm(m)).map(x => x.barrio);
            const nombres = [...new Set([...geo.map(g => g.barrio), ...sel])].sort((a, b) => a.localeCompare(b, 'es'));
            h += `<fieldset style="margin:8px 0;border:1px solid #ddd;border-radius:8px;padding:8px;"><legend style="font-size:13px;font-weight:600;">${esc(m)} <small>(${nombres.length ? nombres.length + ' barrios' : 'sin barrios cargados'})</small></legend>
              <div style="max-height:200px;overflow:auto;display:flex;flex-wrap:wrap;gap:4px 14px;">${nombres.map(n => `<label style="font-size:12px;"><input type="checkbox" data-bm="${esc(m)}" value="${esc(n)}" ${sel.some(s => norm(s) === norm(n)) ? 'checked' : ''}> ${esc(n)}</label>`).join('') || '<small>Carga los límites del municipio en Rutas, o escribe los barrios abajo.</small>'}</div>
              <input data-bx="${esc(m)}" placeholder="Barrios adicionales, separados por coma" style="width:100%;margin-top:6px;"></fieldset>`;
        }
        cont.innerHTML = h + `<button class="btn-publicar-banner" data-tr="bar-guardar" data-id="${id}">💾 Guardar barrios</button> <span id="barAv-${id}" style="font-size:12px;"></span>`;
    }
    async function pintarRecicladores(id) {
        const cont = el('rec-' + id); if (!cont) return;
        const cic = await cargarCiclo(), ms = munsDe(id), mias = rb.filter(x => x.organizacion_id === id);
        const porRec = {}; mias.forEach(x => { (porRec[x.reciclador_id] = porRec[x.reciclador_id] || { n: x.reciclador_nombre, filas: [] }).filas.push(x); });
        let h = Object.keys(porRec).length ? Object.entries(porRec).map(([rid, r]) => `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;margin-bottom:6px;font-size:13px;"><strong>${esc(r.n || rid)}</strong>
            ${r.filas.map(f => `<div>${esc(f.municipio)} · ${esc(f.barrio)} ${f.acuerdo ? '<small>(' + esc(f.acuerdo) + ')</small>' : ''} <button class="btn-chat-admin" style="padding:0 6px;" data-tr="rec-quitar" data-id="${id}" data-r="${f.id}">✕</button></div>`).join('')}</div>`).join('') : '<small>Sin asignaciones todavía.</small>';
        if (!ms.length) return void (cont.innerHTML = h + '<p><small>Marca primero los municipios de la organización.</small></p>');
        h += `<div style="border-top:1px dashed #ccc;padding-top:8px;margin-top:6px;"><div class="form-banner-grid">
            <div class="form-banner-group"><label>Reciclador (CicloGo)</label><select id="rcSel-${id}"><option value="">— Elegir —</option>${(cic.recicladores || []).map(r => `<option value="${esc(String(r.id))}" data-n="${esc(r.nombre_completo || '')}">${esc(r.nombre_completo || r.id)}</option>`).join('')}</select></div>
            <div class="form-banner-group"><label>Municipio</label><select id="rcMun-${id}" data-tr="rec-mun" data-id="${id}">${ms.map(m => `<option>${esc(m)}</option>`).join('')}</select></div>
            <div class="form-banner-group"><label>Acuerdo / soporte</label><input id="rcAc-${id}" placeholder="Ej. Acuerdo con la alcaldía 2026"></div></div>
            <div id="rcBar-${id}" style="max-height:180px;overflow:auto;display:flex;flex-wrap:wrap;gap:4px 14px;margin:6px 0;"></div>
            <button class="btn-publicar-banner" data-tr="rec-asignar" data-id="${id}">➕ Asignar barrios al reciclador</button> <span id="rcAv-${id}" style="font-size:12px;"></span></div>`;
        cont.innerHTML = h; await pintarBarriosRec(id);
    }
    async function pintarBarriosRec(id) {
        const sel = el('rcMun-' + id), box = el('rcBar-' + id); if (!sel || !box) return;
        const m = sel.value, asign = ob.filter(x => x.organizacion_id === id && norm(x.municipio) === norm(m)).map(x => x.barrio);
        const nombres = asign.length ? asign : (await barriosDe(m)).map(g => g.barrio);
        box.innerHTML = nombres.map(n => `<label style="font-size:12px;"><input type="checkbox" value="${esc(n)}"> ${esc(n)}</label>`).join('') || '<small>Este municipio no tiene barrios cargados.</small>';
    }

    /* ---------- 3) Accesos ---------- */
    function pintarAccesos() {
        const c = el('terrAccesos'); if (!c) return;
        const mods = ctx.modulos(), usr = users.filter(u => (u.dependencia || '').toLowerCase() !== 'superadmin');
        c.innerHTML = `<p style="font-size:13px;color:#555;">Para dar acceso a un cliente: 1) crea el usuario en <b>Usuarios del panel</b>, 2) aquí elige su organización, 3) marca los módulos y vistas de analítica que necesita. Sin organización el usuario ve todo (como hasta ahora).</p>`
            + (usr.length ? usr.map(u => {
                const o = orgDe(u.organizacion_id), pl = o ? PLANTILLAS[o.tipo] : null, mm = u.modulos || (pl ? pl.m : null), vv = u.vistas_analitica || (pl ? pl.v : []);
                return `<div class="card-admin-banner" style="margin-bottom:10px;" data-usr="${u.id}">
                  <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;"><strong>${esc(u.nombre)} <small style="font-weight:400;">· ${esc(u.email)} · ${esc(u.dependencia)}</small></strong>
                  <span class="status-badge ${u.organizacion_id ? 'status-resuelto' : 'status-cancelada'}">${u.organizacion_id ? 'Con alcance limitado' : 'Sin límite territorial'}</span></div>
                  <div class="form-banner-grid" style="margin-top:6px;"><div class="form-banner-group"><label>Organización</label><select data-tr="acc-org" data-id="${u.id}"><option value="">— Ninguna (ve todo) —</option>${orgs.map(x => `<option value="${x.id}" ${x.id === u.organizacion_id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></div></div>
                  ${(() => { if (!o || !['alcaldia', 'autoridad_ambiental'].includes(o.tipo)) return ''; const em = empresasDelTerritorio(o); return `<div style="font-size:13px;background:#f1f5f9;border-radius:8px;padding:8px;margin:6px 0;"><b>Empresas de su territorio (se ven por defecto):</b> ${em.length ? em.map(x => esc(x.nombre) + ' <small>(' + (TIPOS[x.tipo] || '').replace(/^\S+\s/, '') + ')</small>').join(' · ') : 'ninguna registrada todavía. Créalas en Organizaciones y marca el mismo municipio.'}</div>`; })()}
                  <label style="font-size:13px;font-weight:600;">Municipio(s) de este usuario <small style="font-weight:400;">(el sistema le muestra solo lo de ese territorio)</small></label>
                  <div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0 8px;">${muns.filter(m => m.activo).map(m => `<label style="font-size:13px;"><input type="checkbox" data-amu value="${esc(m.nombre)}" ${((u.municipios && u.municipios.length) ? u.municipios : (o ? munsDe(o.id) : [])).some(x => norm(x) === norm(m.nombre)) ? 'checked' : ''}> ${esc(m.nombre)}</label>`).join('')}</div>
                  <label style="font-size:13px;font-weight:600;">Módulos habilitados</label>
                  <div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0 8px;">${mods.map(m => `<label style="font-size:13px;"><input type="checkbox" data-am value="${m.v}" ${(!mm || mm.includes(m.v)) ? 'checked' : ''}> ${m.ico} ${esc(m.t)}</label>`).join('')}</div>
                  <label style="font-size:13px;font-weight:600;">Paneles de analítica premium</label>
                  <div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0 8px;">${Object.entries(VISTAS).map(([k, t]) => `<label style="font-size:13px;"><input type="checkbox" data-av value="${k}" ${vv.includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</div>
                  <button class="btn-publicar-banner" data-tr="acc-guardar" data-id="${u.id}">💾 Guardar acceso</button>
                  <button class="btn-chat-admin" data-tr="acc-plantilla" data-id="${u.id}">📋 Usar plantilla de su organización</button> <span id="accAv-${u.id}" style="font-size:12px;"></span></div>`;
            }).join('') : '<p>No hay usuarios del panel todavía.</p>');
    }


    /* ---------- Alta de cliente desde "Usuarios del panel" ---------- */
    const DEP = { alcaldia: 'alcaldia', empresa_aseo_publica: 'aseo', empresa_aseo_privada: 'aseo', eca_publica: 'recicladores', eca_privada: 'recicladores', asociacion_recicladores: 'recicladores', autoridad_ambiental: 'alcaldia', otra: 'alcaldia' };
    const ESCLIENTE = ['empresa_aseo_publica', 'empresa_aseo_privada', 'eca_publica', 'eca_privada', 'asociacion_recicladores'];
    async function montarFormUsuario() {
        const c = el('usrOrgBloque'); if (!c) return;
        const e = await cargarTodo(); if (e) { c.innerHTML = `<p style="color:#b91c1c;font-size:12px;">${esc(e)} (¿ejecutaste el SQL 30 y 32?)</p>`; return; }
        const cic = await cargarCiclo();
        c.innerHTML = `<div class="form-banner-grid"><div class="form-banner-group"><label>Organización (cliente)</label>
            <select id="usrOrg"><option value="__nueva">➕ Nueva organización (llenar datos abajo)</option><option value="">— Sin organización (ve todo; solo equipo interno) —</option>${orgs.filter(o => o.activo).map(o => `<option value="${o.id}">${esc(o.nombre)} · ${TIPOS[o.tipo]}</option>`).join('')}</select></div></div>
          <div id="usrOrgNueva" style="border:1px dashed #9ca3af;border-radius:8px;padding:10px;margin-bottom:10px;">
            <h4 style="margin:0 0 8px;">Datos de identificación de la organización</h4>
            <div class="form-banner-grid"><div class="form-banner-group"><label>Tipo *</label><select id="uoTipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
              ${camposOrg('uo')}
              <div class="form-banner-group"><label>Empresa en CicloGo (si ya existe allí)</label><select id="uoCiclo"><option value="">— Ninguna —</option>${(cic.empresas || []).map(x => `<option value="${esc(String(x.id))}">${esc(x.nombre || x.id)}</option>`).join('')}</select></div></div>
            <label style="font-size:13px;font-weight:600;">Municipios donde opera / que verá *</label>
            <div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0;">${muns.filter(m => m.activo).map(m => `<label style="font-size:13px;"><input type="checkbox" class="uoMun" value="${esc(m.nombre)}"> ${esc(m.nombre)}</label>`).join('')}</div></div>`;
        const sel = el('usrOrg'), dep = el('usrDependencia'), tipo = el('uoTipo');
        const fijarDep = k => { if (dep && DEP[k]) dep.value = DEP[k]; };
        sel.onchange = () => { el('usrOrgNueva').style.display = sel.value === '__nueva' ? '' : 'none'; const o = orgDe(sel.value); if (o) fijarDep(o.tipo); else if (sel.value === '__nueva') fijarDep(tipo.value); };
        tipo.onchange = () => fijarDep(tipo.value); fijarDep(tipo.value);
        // el nombre de la cuenta se llena solo con la razón social
        const nom = el('usrNombre'), rs = el('uo-nombre'); if (nom && rs) rs.oninput = () => { if (!nom.dataset.manual) nom.value = rs.value; }; if (nom) nom.oninput = () => { nom.dataset.manual = '1'; };
    }
    function validarFormUsuario() {
        if (!el('usrOrg') || el('usrOrg').value !== '__nueva') return null;
        const f = faltaOrg(leerOrg('uo')); if (f) return f;
        if (!document.querySelector('.uoMun:checked')) return 'Marca al menos un municipio de la organización.';
        return null;
    }
    // Crea la organización (si es nueva), la vincula al usuario y le aplica módulos, paneles y municipios por defecto
    async function vincularUsuario(usuarioId) {
        const v = el('usrOrg') ? el('usrOrg').value : ''; if (!v) return null;
        let org = orgDe(v), ms;
        if (v === '__nueva') {
            const d = leerOrg('uo'); ms = [...document.querySelectorAll('.uoMun:checked')].map(i => i.value);
            const r = await db.from('organizaciones').insert([{ ...d, tipo: el('uoTipo').value, contacto: d.representante, ciclogo_empresa_id: el('uoCiclo').value || null }]).select().single();
            if (r.error) throw r.error; org = r.data;
            const m = await db.from('organizacion_municipios').insert(ms.map(x => ({ organizacion_id: org.id, municipio: x }))); if (m.error) throw m.error;
        } else ms = munsDe(org.id);
        const pl = PLANTILLAS[org.tipo] || PLANTILLAS.otra;
        const u = await db.from('usuarios_panel').update({ organizacion_id: org.id, modulos: pl.m, vistas_analitica: pl.v, municipios: ms }).eq('id', usuarioId);
        if (u.error) throw u.error;
        return org;
    }
    // Empresas de aseo y de reciclaje registradas en los municipios de una alcaldía / autoridad ambiental
    function empresasDelTerritorio(o) {
        if (!o || !['alcaldia', 'autoridad_ambiental'].includes(o.tipo)) return [];
        const mias = munsDe(o.id).map(norm);
        return orgs.filter(x => x.activo && ESCLIENTE.includes(x.tipo) && munsDe(x.id).some(m => mias.includes(norm(m))));
    }

    /* ---------- acciones ---------- */
    const acciones = {
        async 'mun-nuevo'(t, e) { e.preventDefault(); const n = el('munNombre').value.trim(); if (!n) return;
            const { error } = await db.from('territorios_municipios').insert([{ nombre: n, grupo: el('munGrupo').value, orden: 100 + muns.length }]); if (error) return alert(error.message); await recargar(); },
        async 'org-nueva'(t, e) { e.preventDefault();
            const d = leerOrg('on'), f = faltaOrg(d); if (f) return aviso('orgAviso', f);
            const ms = [...document.querySelectorAll('.onMun:checked')].map(i => i.value); if (!ms.length) return aviso('orgAviso', 'Marca al menos un municipio.');
            const r = await db.from('organizaciones').insert([{ ...d, tipo: el('orgTipo').value, contacto: d.representante, ciclogo_empresa_id: el('orgCiclo').value || null }]).select().single();
            if (r.error) return aviso('orgAviso', r.error.message);
            const m = await db.from('organizacion_municipios').insert(ms.map(x => ({ organizacion_id: r.data.id, municipio: x }))); if (m.error) return aviso('orgAviso', m.error.message);
            await recargar(); aviso('orgAviso', 'Organización creada. Ahora, en Usuarios del panel, crea su usuario y elígela.', true); },
        async 'org-editar'(t) { const r = el('edit-' + t.dataset.id); if (r) r.style.display = r.style.display === 'none' ? '' : 'none'; },
        async 'org-activo'(t) { await db.from('organizaciones').update({ activo: t.dataset.v === 'true' }).eq('id', t.dataset.id); await recargar(); },
        async 'org-borrar'(t) { const o = orgDe(t.dataset.id); if (!confirm(`¿Eliminar "${o.nombre}"? Sus usuarios quedarán SIN límite territorial hasta que los reasignes.`)) return;
            const { error } = await db.from('organizaciones').delete().eq('id', t.dataset.id); if (error) return alert(error.message); await recargar(); },
        async 'org-guardar'(t) { const id = t.dataset.id, d = leerOrg('ed' + id.replace(/-/g, '')), f = faltaOrg(d); if (f) return alert(f);
            const { error } = await db.from('organizaciones').update({ ...d, contacto: d.representante, ciclogo_empresa_id: el('ed-ci-' + id).value || null }).eq('id', id);
            if (error) return alert(error.message); await recargar(); },
        async 'org-mun'(t) { const id = t.dataset.id, m = t.dataset.m;
            if (t.checked) { const { error } = await db.from('organizacion_municipios').upsert([{ organizacion_id: id, municipio: m }]); if (error) return alert(error.message); }
            else { await db.from('organizacion_municipios').delete().eq('organizacion_id', id).eq('municipio', m); await db.from('organizacion_barrios').delete().eq('organizacion_id', id).eq('municipio', m); }
            const [a, b] = await Promise.all([db.from('organizacion_municipios').select('*'), db.from('organizacion_barrios').select('*')]); om = a.data || []; ob = b.data || [];
            pintarMunicipios(); },
        async 'bar-guardar'(t) { const id = t.dataset.id, filas = [];
            document.querySelectorAll(`#bar-${id} input[data-bm]:checked`).forEach(i => filas.push({ organizacion_id: id, municipio: i.dataset.bm, barrio: i.value }));
            document.querySelectorAll(`#bar-${id} input[data-bx]`).forEach(i => i.value.split(',').map(s => s.trim()).filter(Boolean).forEach(n => filas.push({ organizacion_id: id, municipio: i.dataset.bx, barrio: n })));
            const uniq = [...new Map(filas.map(f => [norm(f.municipio) + '|' + norm(f.barrio), f])).values()];
            let r = await db.from('organizacion_barrios').delete().eq('organizacion_id', id); if (r.error) return aviso('barAv-' + id, r.error.message);
            if (uniq.length) { r = await db.from('organizacion_barrios').insert(uniq); if (r.error) return aviso('barAv-' + id, r.error.message); }
            const { data } = await db.from('organizacion_barrios').select('*'); ob = data || []; aviso('barAv-' + id, uniq.length ? `Guardado: ${uniq.length} barrio(s).` : 'Guardado: ve todos los barrios.', true); },
        async 'rec-mun'(t) { await pintarBarriosRec(t.dataset.id); },
        async 'rec-asignar'(t) { const id = t.dataset.id, s = el('rcSel-' + id), m = el('rcMun-' + id).value;
            if (!s.value) return aviso('rcAv-' + id, 'Elige un reciclador.');
            const bar = [...document.querySelectorAll(`#rcBar-${id} input:checked`)].map(i => i.value); if (!bar.length) return aviso('rcAv-' + id, 'Marca al menos un barrio.');
            const nombre = s.options[s.selectedIndex].dataset.n, ac = el('rcAc-' + id).value.trim() || null;
            const { error } = await db.from('reciclador_barrios').upsert(bar.map(b => ({ organizacion_id: id, reciclador_id: s.value, reciclador_nombre: nombre, municipio: m, barrio: b, acuerdo: ac, vigente: true })), { onConflict: 'reciclador_id,municipio,barrio' });
            if (error) return aviso('rcAv-' + id, error.message);
            const { data } = await db.from('reciclador_barrios').select('*').order('reciclador_nombre'); rb = data || []; await pintarRecicladores(id); aviso('rcAv-' + id, 'Asignado.', true); },
        async 'rec-quitar'(t) { await db.from('reciclador_barrios').delete().eq('id', t.dataset.r); rb = rb.filter(x => String(x.id) !== t.dataset.r); await pintarRecicladores(t.dataset.id); },
        async 'mun-cdmb'(t) { await db.from('territorios_municipios').update({ cdmb: t.checked }).eq('id', t.dataset.id); },
        async 'mun-activo'(t) { await db.from('territorios_municipios').update({ activo: t.checked }).eq('id', t.dataset.id); await recargar(); },
        async 'acc-org'(t) { const u = users.find(x => String(x.id) === t.dataset.id); u._orgNueva = t.value || null; u.organizacion_id = t.value || null;
            const o = orgDe(u.organizacion_id); if (o) { const pl = PLANTILLAS[o.tipo] || PLANTILLAS.otra; u.modulos = pl.m; u.vistas_analitica = pl.v; u.municipios = munsDe(o.id); } else { u.modulos = null; u.vistas_analitica = null; u.municipios = null; }
            pintarAccesos(); },
        async 'acc-guardar'(t) { const id = t.dataset.id, card = document.querySelector(`[data-usr="${id}"]`), u = users.find(x => String(x.id) === id);
            const org = u._orgNueva !== undefined ? u._orgNueva : (u.organizacion_id || null);
            const m = [...card.querySelectorAll('input[data-am]:checked')].map(i => i.value), v = [...card.querySelectorAll('input[data-av]:checked')].map(i => i.value), mu = [...card.querySelectorAll('input[data-amu]:checked')].map(i => i.value);
            if (org && !mu.length) return aviso('accAv-' + id, 'Marca al menos un municipio.');
            if (org) { const ya = munsDe(org).map(norm), nuevos = mu.filter(x => !ya.includes(norm(x)));
                if (nuevos.length) { const r = await db.from('organizacion_municipios').upsert(nuevos.map(x => ({ organizacion_id: org, municipio: x }))); if (r.error) return aviso('accAv-' + id, r.error.message); om = [...om, ...nuevos.map(x => ({ organizacion_id: org, municipio: x }))]; } }
            const { error } = await db.from('usuarios_panel').update({ organizacion_id: org, modulos: m, vistas_analitica: v, municipios: org ? mu : null }).eq('id', id);
            if (error) return aviso('accAv-' + id, error.message); Object.assign(u, { organizacion_id: org, modulos: m, vistas_analitica: v, municipios: org ? mu : null }); delete u._orgNueva; aviso('accAv-' + id, 'Acceso guardado. Se aplica en su próximo ingreso.', true); },
        async 'acc-plantilla'(t) { const id = t.dataset.id, u = users.find(x => String(x.id) === id), org = orgDe(u._orgNueva !== undefined ? u._orgNueva : u.organizacion_id);
            if (!org) return aviso('accAv-' + id, 'Primero elige y guarda una organización.'); const pl = PLANTILLAS[org.tipo] || PLANTILLAS.otra;
            u.modulos = pl.m; u.vistas_analitica = pl.v; u.organizacion_id = org.id; u.municipios = munsDe(org.id); pintarAccesos(); aviso('accAv-' + id, 'Plantilla cargada. Revisa y pulsa Guardar.', true); }
    };
    async function recargar() { const e = await cargarTodo(); if (e) { ['terrMunicipios', 'terrOrganizaciones', 'terrAccesos'].forEach(i => { const c = el(i); if (c) c.innerHTML = `<p style="color:#b91c1c;">${esc(e)} (¿ejecutaste el SQL 30?)</p>`; }); return; }
        pintarMunicipios(); await pintarOrganizaciones(); pintarAccesos(); }

    document.addEventListener('change', e => { const t = e.target.closest('[data-tr]'); if (t && ['org-mun', 'mun-cdmb', 'mun-activo', 'acc-org', 'rec-mun'].includes(t.dataset.tr)) acciones[t.dataset.tr](t, e); });
    document.addEventListener('click', e => { const t = e.target.closest('button[data-tr]'); if (t && acciones[t.dataset.tr]) acciones[t.dataset.tr](t, e); });
    document.addEventListener('submit', e => { const t = e.target.closest('form[data-tr]'); if (t && acciones[t.dataset.tr]) acciones[t.dataset.tr](t, e); });

    return { cargar: recargar, montarFormUsuario, validarFormUsuario, vincularUsuario };
}

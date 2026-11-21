/* ==========================================
   modules/rewards/rewards.js
   EcoPuntos: saldo, historial, canje y verificación QR del carnet del reciclador.
   Los puntos se calculan y validan en Supabase (funciones eco_*); la app solo los muestra.
   El canje en comercios: Edge Function cupones-ecostan de CicloGo (cupón con QR).
========================================== */
import { supabaseClient } from '../../core/supabaseClient.js';
import { datosUsuarioApp } from '../../core/authService.js';
import { estado, escaparHtml, mostrarToast, abrirEnlaceExterno, emitir, EVENTOS } from '../../core/utils.js';
import { registrarCapaCerrable } from '../../core/navigation.js';
import { registrarNovedadCampana, alertaAppActiva, dispararNotificacionMovil } from '../../core/notifications.js';

const CICLOGO_FUNCIONES = 'https://zzeakssbqfkaspbgkrsf.supabase.co/functions/v1/cupones-ecostan';
const CICLOGO_ANON = '';   // PEGA AQUÍ la clave pública (sb_publishable_...) del proyecto CicloGo

export async function rpcEco(nombre, params) {
    const { data, error } = await supabaseClient.rpc(nombre, params || {});
    if (error) throw error;
    // El saldo que se muestra y se puede gastar es el VIGENTE (los puntos duran 90 días)
    if (nombre === 'eco_resumen' && data) {
        try {
            const v = await supabaseClient.rpc('eco_vigencia');
            if (!v.error && v.data) { data.saldo_total = data.saldo; data.saldo = v.data.saldo_vigente; data.vigencia = v.data; }
        } catch (e) { /* si falla, queda el saldo total */ }
    }
    return data;
}

export function ecoAvisar(mensaje, id, extra) {
    if (!alertaAppActiva('ecopuntos')) return;
    registrarNovedadCampana({ id, tipo: 'ecopuntos', titulo: '⭐ EcoPuntos', mensaje, destino: 'inicio', ...(extra || {}) });
    mostrarToast('⭐ ' + mensaje);
}

export function lanzarConfeti() {
    const colores = ['#2e7d32', '#f9a825', '#43a047', '#fb8c00', '#00897b'];
    for (let i = 0; i < 40; i++) {
        const s = document.createElement('span');
        s.className = 'confeti';
        s.style.left = Math.random() * 100 + 'vw';
        s.style.background = colores[i % colores.length];
        s.style.animationDelay = Math.random() * 0.4 + 's';
        document.body.appendChild(s);
        setTimeout(() => s.remove(), 2200);
    }
}

// El HTML de la billetera vive en rewards.html; aquí solo se actualizan sus datos
export function pintarBilletera(resumen) {
    const saldo = document.getElementById('ecoSaldo');
    if (saldo) saldo.textContent = resumen.saldo;
    const historial = document.getElementById('ecoHistorial');
    if (historial) historial.innerHTML = '';
}

/* ---------- Canje de EcoPuntos por cupones en comercios aliados (CicloGo) ---------- */
async function llamarCupones(accion, extra) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const token = session?.access_token || CICLOGO_ANON;
    const r = await fetch(CICLOGO_FUNCIONES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'apikey': CICLOGO_ANON },
        body: JSON.stringify({ accion, ...(extra || {}) })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || 'No se pudo completar la operación.');
    return j;
}

let canjeComercios = [];
const panelCanje = () => document.getElementById('panelCanje');

function canjearEnCicloGo() {
    panelCanje()?.classList.add('abierto');
    cambiarPestanaCanje('comercios');
}

function cerrarPanelCanje() { detenerQR(); panelCanje()?.classList.remove('abierto'); }

/* ---------- Catálogo de comercios: categorías, foto y enlace a Maps ---------- */
let canjeEstado = { habilitado: true, saldo: 0 };
let canjeCategoria = 'todas';

function enlaceMapsSeguro(u) {
    try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch (e) { return null; }
}

function fijarCategoriaCanje(c) { canjeCategoria = c; pintarCatalogoCanje(); }

function pintarCatalogoCanje() {
    const cont = document.getElementById('canjeContenido');
    if (!cont) return;
    const { habilitado, saldo } = canjeEstado;
    const cats = [...new Set(canjeComercios.map(c => c.categoria || 'Otro'))].sort();
    if (canjeCategoria !== 'todas' && !cats.includes(canjeCategoria)) canjeCategoria = 'todas';
    const lista = canjeComercios.filter(c => canjeCategoria === 'todas' || (c.categoria || 'Otro') === canjeCategoria);
    const chips = cats.length > 1
        ? `<div class="canje-cats">${['todas', ...cats].map(k => `<button type="button" class="canje-cat ${canjeCategoria === k ? 'activa' : ''}" onclick="fijarCategoriaCanje(${JSON.stringify(k).replace(/"/g, '&quot;')})">${k === 'todas' ? 'Todas' : escaparHtml(k)}</button>`).join('')}</div>` : '';
    cont.innerHTML = `<p class="canje-saldo">Tu saldo: <b>${saldo}</b> EcoPuntos</p>` +
        (habilitado ? '' : '<div class="canje-bloqueo">🔒 Tus puntos siguen sumando, pero para canjear necesitas completar <b>1 recogida de reciclaje este mes</b> (carnet verificado y pesaje confirmado).</div>') + chips +
        (lista.length ? lista.map(c => {
            const maps = c.maps_url ? enlaceMapsSeguro(c.maps_url) : null;
            const foto = c.foto_url && /^data:image\/(jpeg|png|webp);base64,/.test(c.foto_url) ? c.foto_url : null;
            return `<div class="canje-card">
                ${foto ? `<img class="canje-foto" src="${foto}" alt="${escaparHtml(c.nombre)}" loading="lazy">` : ''}
                <div class="canje-cab"><strong>${escaparHtml(c.nombre)}</strong><span class="canje-badge">${escaparHtml(c.categoria || 'Otro')}</span></div>
                <small>${escaparHtml(c.municipio || '')}${c.direccion ? ' · ' + escaparHtml(c.direccion) : ''}</small>
                ${c.descripcion ? `<p class="canje-desc">${escaparHtml(c.descripcion)}</p>` : ''}
                ${c.horario ? `<small>🕒 ${escaparHtml(c.horario)}</small>` : ''}
                ${maps ? `<a class="canje-maps" href="${escaparHtml(maps)}" target="_blank" rel="noopener noreferrer">📍 Cómo llegar</a>` : ''}
                ${(c.ofertas || []).map(o => `<div class="canje-oferta">
                    <p><b>${escaparHtml(o.titulo)}</b>${o.detalle ? '<br><small>' + escaparHtml(o.detalle) + '</small>' : ''}</p>
                    <small>${Number(o.monto_minimo) > 0 ? 'Compra mínima: $' + Number(o.monto_minimo).toLocaleString('es-CO') : 'Sin compra mínima'}</small>
                    <button type="button" class="btn-qr" ${(!habilitado || saldo < o.puntos) ? 'disabled' : ''} onclick="canjearCupon(${Number(o.id)})">Generar QR · ${Number(o.puntos)} pts</button>
                  </div>`).join('')}
              </div>`;
        }).join('') : '<p class="aviso-vacio">Aún no hay ofertas disponibles' + (canjeCategoria !== 'todas' ? ' en esta categoría' : '') + '.</p>');
}

async function cambiarPestanaCanje(pestana) {
    detenerQR();
    document.querySelectorAll('#panelCanje [data-canje-tab]').forEach(b =>
        b.classList.toggle('activa', b.dataset.canjeTab === pestana));
    const cont = document.getElementById('canjeContenido');
    if (!cont) return;
    cont.innerHTML = '<p class="aviso-vacio">Cargando…</p>';
    try {
        if (pestana === 'comercios') {
            const [{ comercios }, resumen, impacto] = await Promise.all([llamarCupones('catalogo'), rpcEco('eco_resumen').catch(() => null), rpcEco('eco_impacto').catch(() => null)]);
            const habilitado = !impacto || impacto.canje_habilitado !== false;
            canjeComercios = comercios || [];
            const saldo = resumen?.saldo ?? Number(document.getElementById('ecoSaldo')?.textContent || 0);
            canjeEstado = { habilitado, saldo };
            pintarCatalogoCanje();
        } else {
            const { cupones } = await llamarCupones('mis');
            cont.innerHTML = (cupones || []).length ? cupones.map(k => `<div class="canje-card ${k.estado === 'redimido' ? 'usado' : ''}">
                <strong>${escaparHtml(k.comercios?.nombre || 'Comercio')}</strong>
                <p>${escaparHtml(k.beneficio || '')}</p>
                <small>${k.estado === 'redimido' ? '✅ Usado' : 'Vence: ' + new Date(k.vence_at).toLocaleDateString()}</small>
                ${k.estado === 'generado' ? `<button type="button" class="btn-qr secundario" onclick="mostrarCupon('${escaparHtml(k.codigo)}')">Ver código QR</button>` : ''}
              </div>`).join('') : '<p class="aviso-vacio">Todavía no tienes cupones.</p>';
        }
    } catch (e) { cont.innerHTML = `<p class="aviso-vacio">${escaparHtml(e.message || 'Error al cargar.')}</p>`; }
}

let qrTimer = null, qrPoll = null;
function detenerQR() { clearInterval(qrTimer); clearInterval(qrPoll); qrTimer = qrPoll = null; }

async function canjearCupon(idOferta) {
    let c = null, o = null;
    canjeComercios.forEach(x => (x.ofertas || []).forEach(y => { if (Number(y.id) === Number(idOferta)) { c = x; o = y; } }));
    if (!o || !confirm(`Vas a generar tu QR para "${o.titulo}" en ${c.nombre} (${o.puntos} EcoPuntos).\n\nEl QR dura 60 segundos: genéralo cuando estés en la caja. Los puntos se descuentan cuando el comercio lo escanee.`)) return;
    generarQR(idOferta);
}

async function generarQR(idOferta) {
    detenerQR();
    const cont = document.getElementById('canjeContenido');
    if (cont) cont.innerHTML = '<p class="aviso-vacio">Generando tu QR…</p>';
    try {
        const { qr } = await llamarCupones('generar_qr', { oferta_id: Number(idOferta) });
        mostrarQR(qr, idOferta);
    } catch (e) { mostrarToast('⚠️ ' + (e.message || 'No se pudo generar el QR.')); cambiarPestanaCanje('comercios'); }
}

function mostrarQR(qr, idOferta) {
    const cont = document.getElementById('canjeContenido');
    if (!cont) return;
    cont.innerHTML = `<div class="canje-card canje-codigo">
        <strong>${escaparHtml(qr.comercio)}</strong>
        <p>${escaparHtml(qr.beneficio)} · <b>${Number(qr.puntos)} pts</b></p>
        <div id="canjeQR"></div>
        <div class="canje-texto">${escaparHtml(qr.token)}</div>
        <div id="qrReloj" class="qr-reloj">⏱️ 60 s</div>
        <small>Muéstralo en la caja. Se descuentan los puntos cuando el comercio lo escanea.</small>
        <button type="button" class="btn-qr secundario" id="qrRegenerar" style="display:none;" onclick="generarQR(${Number(idOferta)})">🔄 Generar un QR nuevo</button>
        <button type="button" class="btn-qr secundario" onclick="cancelarQR()">Volver</button>
    </div>`;
    if (window.QRCode) new window.QRCode(document.getElementById('canjeQR'), { text: qr.token, width: 200, height: 200 });
    const fin = new Date(qr.expires_at).getTime();
    qrTimer = setInterval(() => {
        const s = Math.max(0, Math.round((fin - Date.now()) / 1000));
        const el = document.getElementById('qrReloj');
        if (el) { el.textContent = s > 0 ? `⏱️ ${s} s` : '⌛ El QR venció'; el.classList.toggle('urgente', s <= 10); }
        if (s <= 0) {
            clearInterval(qrTimer);
            const box = document.getElementById('canjeQR'); if (box) box.style.opacity = '.15';
            const b = document.getElementById('qrRegenerar'); if (b) b.style.display = 'block';
        }
    }, 500);
    // Cada 3 s se pregunta si el comercio ya lo canjeó
    qrPoll = setInterval(async () => {
        try {
            const { estado } = await llamarCupones('estado_qr', { token: qr.token });
            if (estado === 'usado') {
                detenerQR();
                lanzarConfeti();
                rpcEco('eco_resumen').then(pintarBilletera).catch(() => {});
                cont.innerHTML = `<div class="canje-card canje-codigo"><strong>✅ ¡Canje realizado!</strong><p>${escaparHtml(qr.beneficio)}</p><small>Se descontaron ${Number(qr.puntos)} EcoPuntos.</small>
                    <button type="button" class="btn-qr secundario" onclick="cambiarPestanaCanje('mis')">Ver mis canjes</button></div>`;
            }
        } catch (e) { /* se reintenta */ }
    }, 3000);
}

function mostrarCupon(codigo) {   // cupones del sistema anterior que aún no vencen
    const cont = document.getElementById('canjeContenido');
    if (!cont) return;
    cont.innerHTML = `<div class="canje-card canje-codigo">
        <strong>Presenta este código en el comercio</strong>
        <div id="canjeQR"></div>
        <div class="canje-texto">${escaparHtml(codigo)}</div>
        <button type="button" class="btn-qr secundario" onclick="cambiarPestanaCanje('mis')">Volver a mis canjes</button>
    </div>`;
    if (window.QRCode) new window.QRCode(document.getElementById('canjeQR'), { text: codigo, width: 200, height: 200 });
}

function cancelarQR() { detenerQR(); cambiarPestanaCanje('comercios'); }


registrarCapaCerrable({ estaAbierta: () => !!panelCanje()?.classList.contains('abierto'), cerrar: cerrarPanelCanje });

async function verHistorialEco() {
    const cont = document.getElementById('ecoHistorial');
    if (!cont) return;
    try {
        const movs = await rpcEco('mis_movimientos', { p_limite: 30 });
        cont.innerHTML = (movs || []).length ? movs.map(m => `<div class="eco-mov"><span>${escaparHtml(m.descripcion || m.tipo)}<br><small>${new Date(m.created_at).toLocaleDateString()}</small></span>
            <b class="${m.puntos >= 0 ? 'eco-mas' : 'eco-menos'}">${m.puntos >= 0 ? '+' : ''}${m.puntos}</b></div>`).join('') : '<p class="aviso-vacio">Aún no tienes movimientos.</p>';
    } catch (e) { mostrarToast('No se pudo cargar el historial.'); }
}

// Avisa de los puntos que llegan desde fuera de la app (pesaje en CicloGo, canjes)
export async function sincronizarEcopuntosNovedades() {
    const email = (datosUsuarioApp().email || '').toLowerCase();
    if (!email || !supabaseClient) return;
    try {
        const movs = (await rpcEco('mis_movimientos', { p_limite: 20 })) || [];
        const clave = 'ecoUltimoMov_' + email;
        const ultimo = Number(localStorage.getItem(clave) || 0);
        const maxId = movs.reduce((m, x) => Math.max(m, x.id), 0);
        if (localStorage.getItem(clave) && alertaAppActiva('ecopuntos')) {
            movs.filter(x => x.id > ultimo && !['trivia', 'modulo', 'qr'].includes(x.tipo)).sort((a, b) => a.id - b.id).forEach(x => {
                const texto = x.puntos >= 0 ? `+${x.puntos} EcoPuntos: ${x.descripcion}` : `Canjeaste ${-x.puntos} EcoPuntos: ${x.descripcion}`;
                dispararNotificacionMovil('⭐ EcoPuntos', texto, { id: 'eco-mov-' + x.id, tipo: 'ecopuntos' });
            });
        }
        localStorage.setItem(clave, String(maxId));
    } catch (e) { /* sin sesión: no pasa nada */ }
}

/* ---------- QR del carnet del reciclador (desde el chat) ---------- */
let qrStream = null, qrBucle = null, qrReporteId = null;

export async function htmlBotonQR() {
    const r = estado.reporteSeleccionado;
    if (!r || r.tablaOrigen !== 'reportes_reciclaje') return '';
    try {
        const { data } = await supabaseClient.from('reportes_reciclaje').select('estado, reciclador_id, qr_validado_at').eq('id', r.id).single();
        if (data) Object.assign(r, data);
    } catch (e) {}
    if (r.reciclador_id && r.estado === 'en_proceso' && !r.qr_validado_at) {
        return `<div style="text-align:center; margin:12px 0;"><button type="button" class="btn-qr" onclick="abrirEscanerQR('${r.id}')">📷 ESCANEAR QR DEL RECICLADOR</button><br><small style="color:#777;">+50 EcoPuntos al verificar su carnet</small></div>`;
    }
    return '';
}

function abrirEscanerQR(reporteId) {
    qrReporteId = reporteId;
    const p = document.getElementById('panelQR');   // el panel está en rewards.html
    if (!p) return;
    const estadoQR = document.getElementById('qrEstado');
    if (estadoQR) estadoQR.textContent = 'Apunta la cámara al código QR del carnet del reciclador.';
    const foto = document.getElementById('qrFoto');
    if (foto) foto.value = '';
    p.classList.add('abierto');
    iniciarCamaraQR();
}

async function iniciarCamaraQR() {
    const estado = document.getElementById('qrEstado');
    if (!window.jsQR) { if (estado) estado.textContent = 'No se pudo cargar el lector de QR. Revisa tu conexión.'; return; }
    try {
        qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const video = document.getElementById('qrVideo');
        video.srcObject = qrStream;
        await video.play();
        const lienzo = document.createElement('canvas');
        const ctx = lienzo.getContext('2d', { willReadFrequently: true });
        const leer = () => {
            if (!qrStream) return;
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                lienzo.width = video.videoWidth; lienzo.height = video.videoHeight;
                ctx.drawImage(video, 0, 0);
                const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
                const qr = window.jsQR(img.data, img.width, img.height);
                if (qr && qr.data) { procesarCodigoQR(qr.data); return; }
            }
            qrBucle = requestAnimationFrame(leer);
        };
        leer();
    } catch (e) {
        if (estado) estado.textContent = 'No se pudo abrir la cámara. Usa el botón "Usar una foto del QR".';
    }
}

function leerQRDeFoto(input) {
    const archivo = input.files && input.files[0];
    if (!archivo || !window.jsQR) return;
    const img = new Image();
    img.onload = () => {
        const lienzo = document.createElement('canvas');
        lienzo.width = img.width; lienzo.height = img.height;
        const ctx = lienzo.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const datos = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
        const qr = window.jsQR(datos.data, datos.width, datos.height);
        if (qr && qr.data) procesarCodigoQR(qr.data);
        else mostrarToast('No se encontró un código QR en la foto. Intenta de nuevo.');
        URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(archivo);
}

function cerrarEscanerQR() {
    cancelAnimationFrame(qrBucle);
    if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
    document.getElementById('panelQR')?.classList.remove('abierto');
}

// Función definitiva para validar el QR en EcoSTAN
function validarQRReciclador(textoQREscaneado, reporteActual) {
    if (!textoQREscaneado || !reporteActual) return false;

    let idEscaneado = String(textoQREscaneado).trim();

    // Caso A: Si el QR tiene el formato nuevo "RECICLADOR_ID:2"
    if (idEscaneado.includes('RECICLADOR_ID:')) {
        idEscaneado = idEscaneado.split(':')[1].trim();
    }
    // Caso B: Si el QR tiene el formato antiguo "CICLOGO-REC|2|XYZ..."
    else if (idEscaneado.includes('|')) {
        const partes = idEscaneado.split('|');
        idEscaneado = partes[1] ? partes[1].trim() : idEscaneado;
    }

    const idReporte = String(reporteActual.reciclador_id || '').trim();

    // Comparamos de forma estricta asegurando que ambos sean texto limpio
    if (idEscaneado === idReporte && idReporte !== '') {
        return true; // ¡Validación exitosa! El QR corresponde al reciclador.
    } else {
        alert("El QR no corresponde al reciclador asignado a esta solicitud.");
        return false;
    }
}

async function procesarCodigoQR(texto) {
    const reporteId = qrReporteId;
    cerrarEscanerQR();
    try {
        // Reporte actual (se refresca reciclador_id desde la base de datos si hace falta)
        let reporte = (estado.reporteSeleccionado && String(estado.reporteSeleccionado.id) === String(reporteId)) ? estado.reporteSeleccionado : { id: reporteId };
        if (!reporte.reciclador_id) {
            const { data } = await supabaseClient.from('reportes_reciclaje').select('reciclador_id').eq('id', reporteId).single();
            if (data) reporte = { ...reporte, ...data };
        }
        if (!validarQRReciclador(texto, reporte)) return;

        const r = await rpcEco('validar_qr_reciclador', { p_reporte_id: String(reporteId), p_codigo: texto });
        lanzarConfeti();
        ecoAvisar(`Identidad del reciclador verificada: +${r.puntos} EcoPuntos.`, 'eco-qr-' + reporteId);
        emitir(EVENTOS.CHAT_REFRESCAR);
    } catch (e) { alert(e.message || 'No se pudo verificar el QR.'); }
}

Object.assign(window, { fijarCategoriaCanje, generarQR, cancelarQR, canjearEnCicloGo, cerrarPanelCanje, cambiarPestanaCanje, canjearCupon, mostrarCupon, verHistorialEco, abrirEscanerQR, leerQRDeFoto, cerrarEscanerQR });

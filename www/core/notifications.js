/* ==========================================
   core/notifications.js
   Todo lo que "avisa" al ciudadano: alertas configurables, campana de novedades,
   notificaciones locales y push (FCM) y suscripciones en tiempo real.
   No importa módulos de negocio: cuando algo debe abrir un reporte, refrescar el chat
   o recargar rutas, emite un evento (ver EVENTOS en utils.js).
========================================== */
import { supabaseClient } from './supabaseClient.js';
import { datosUsuarioApp, emailUsuarioApp, estaLogueado } from './authService.js';
import { plugins, escaparHtml, normalizarTexto, mostrarToast, emitir, EVENTOS, abrirEnlaceExterno } from './utils.js';
import { mostrarSeccion, registrarCapaCerrable } from './navigation.js';

const TABLAS_REPORTES = ['reportes_retiro', 'reportes_abandonados', 'reportes_violencia_animal', 'reportes_ciudadania', 'reportes_reciclaje'];

const CANAL_NOTIFICACIONES = {
    id: 'ciudad-limpia-alertas-v2',   // v2: Android no actualiza un canal ya creado; uno nuevo garantiza sonido y prioridad máxima
    name: 'Alertas Ciudad Limpia',
    description: 'Avisos sobre tus reportes y mensajes de la administración',
    importance: 5,
    visibility: 1,
    vibration: true,
    lights: true
};
let canalNotificacionesCreado = false;
let pushActivo = false;
const ultimoEstadoReportes = {};

/* ==========================================
   CONFIGURACIÓN DE ALERTAS (editable por el superadmin)
========================================== */
let configAlertasApp = {};

export async function cargarConfigAlertasApp() {
    try {
        const { data } = await supabaseClient.from('config_alertas').select('*');
        (data || []).forEach(f => { configAlertasApp[f.clave] = f; });
    } catch (e) {}
}

// Devuelve null si el superadmin desactivó la alerta; si no, el texto (editable) con sus variables ya aplicadas
export function plantillaAppAlerta(clave, tituloBase, mensajeBase, vars) {
    const cfg = configAlertasApp[clave];
    if (cfg && cfg.activa === false) return null;
    const poner = t => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
    return { titulo: poner((cfg && cfg.titulo) || tituloBase), mensaje: poner((cfg && cfg.mensaje) || mensajeBase) };
}
export const alertaAppActiva = clave => !(configAlertasApp[clave] && configAlertasApp[clave].activa === false);

/* ==========================================
   CAMPANA DE NOVEDADES
========================================== */
function claveNovedades() { return 'novedades_' + ((datosUsuarioApp().email || 'anon').toLowerCase()); }
function claveLeidas() { return 'novedadesLeidas_' + ((datosUsuarioApp().email || 'anon').toLowerCase()); }

function leerNovedades() {
    try { return JSON.parse(localStorage.getItem(claveNovedades()) || '[]'); } catch (e) { return []; }
}

export function novedadExiste(id) { return leerNovedades().some(n => n.id === id); }

function tipoDeNovedad(titulo) {
    const t = String(titulo || '').toLowerCase();
    if (t.includes('ecopuntos') || t.includes('desafío')) return 'ecopuntos';
    if (t.includes('reporte')) return 'estado';
    if (t.includes('respuesta')) return 'chat';
    if (t.includes('camión') || t.includes('recolección de hoy')) return 'camion';
    if (t.includes('ruta')) return 'ruta';
    if (t.includes('importante')) return 'banner';
    return 'aviso';
}

// Guarda la novedad en la campana. Devuelve false si ya estaba (evita duplicados).
export function registrarNovedadCampana({ id, tipo, titulo, mensaje, fecha, destino, url, datos }) {
    const lista = leerNovedades();
    id = id || ('n' + Date.now() + Math.random().toString(36).slice(2, 6));
    if (lista.some(n => n.id === id)) return false;
    lista.unshift({ id, tipo: tipo || tipoDeNovedad(titulo), titulo, mensaje, fecha: fecha || new Date().toISOString(), destino: destino || null, url: url || null, datos: datos || null });
    localStorage.setItem(claveNovedades(), JSON.stringify(lista.slice(0, 40)));
    actualizarBadgeCampana();
    return true;
}

function novedadesSinLeer() {
    const leidas = localStorage.getItem(claveLeidas()) || '';
    return leerNovedades().filter(n => n.fecha > leidas).length;
}

export function actualizarBadgeCampana() {
    const b = document.getElementById('badgeCampana');
    if (!b) return;
    const n = novedadesSinLeer();
    b.textContent = n > 9 ? '9+' : n;
    b.style.display = n > 0 ? 'flex' : 'none';
}

function asegurarPanelCampana() {
    let p = document.getElementById('panelCampana');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'panelCampana';
    p.className = 'panel-campana';
    p.innerHTML = `<div class="panel-campana-caja">
        <div class="panel-campana-cabecera"><strong>🔔 Novedades</strong>
            <div><button type="button" onclick="limpiarNovedades()">Limpiar</button><button type="button" onclick="cerrarCampana()">✕</button></div>
        </div><div id="listaNovedades" class="panel-campana-lista"></div>
        <button type="button" class="campana-prueba" onclick="probarPush()">🔔 Probar notificación en este celular</button></div>`;
    p.addEventListener('click', e => { if (e.target === p) cerrarCampana(); });
    document.body.appendChild(p);
    return p;
}

export function campanaAbierta() { return !!document.getElementById('panelCampana')?.classList.contains('abierto'); }

export function abrirCampana() {
    const p = asegurarPanelCampana();
    const leidas = localStorage.getItem(claveLeidas()) || '';
    const iconos = { ecopuntos: '⭐', estado: '📋', chat: '💬', camion: '🚛', ruta: '🗺️', banner: '⭐', aviso: '📢', noticia: '📰', vence: '⏳', recogida: '♻️', canje: '🎟️', prueba: '🔔' };
    const lista = leerNovedades();
    document.getElementById('listaNovedades').innerHTML = lista.length ? lista.map(n => `
        <div class="novedad${n.fecha > leidas ? ' nueva' : ''}" onclick="irANovedad('${escaparHtml(String(n.id)).replace(/'/g, '')}')">
            <span class="novedad-ico">${iconos[n.tipo] || '🔔'}</span>
            <div><strong>${escaparHtml(n.titulo)}</strong><p>${escaparHtml(n.mensaje)}</p>
            <small>${new Date(n.fecha).toLocaleString()}</small></div>
        </div>`).join('') : '<p class="aviso-vacio">No tienes novedades por ahora.</p>';
    p.classList.add('abierto');
    localStorage.setItem(claveLeidas(), new Date().toISOString());
    actualizarBadgeCampana();
}

export function cerrarCampana() { document.getElementById('panelCampana')?.classList.remove('abierto'); }

export function limpiarNovedades() {
    localStorage.setItem(claveNovedades(), '[]');
    localStorage.setItem(claveLeidas(), new Date().toISOString());
    abrirCampana();
}

const DESTINOS_TIPO = { ecopuntos: 'educacion', estado: 'mis-reportes', chat: 'mis-reportes', camion: 'rutas', ruta: 'rutas', banner: 'avisos', aviso: 'avisos', noticia: 'noticias', vence: 'canje', recogida: 'recogida', canje: 'canje' };

// Lleva al ciudadano a donde dice la alerta: un reporte, una noticia, el canje, una sección...
export function navegarADestino(datos) {
    datos = datos || {};
    if (datos.reporte_id && datos.tabla_origen) {
        emitir(EVENTOS.ABRIR_REPORTE, { id: datos.reporte_id, tabla: datos.tabla_origen, pestana: 'chat' });
        return;
    }
    if (datos.url && /^https?:\/\//.test(datos.url)) { abrirEnlaceExterno(datos.url); return; }
    const destino = datos.destino || DESTINOS_TIPO[datos.tipo];
    if (!destino) return;
    if (destino === 'noticias') {
        mostrarSeccion('educacion');
        setTimeout(() => document.getElementById('noticiasLista')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 600);
    } else if (destino === 'canje') {
        mostrarSeccion('inicio');
        setTimeout(() => window.canjearEnCicloGo && window.canjearEnCicloGo(), 250);
    } else if (destino === 'recogida') {
        mostrarSeccion('reporte-reciclaje-ciclogo');
    } else if (destino === 'reglas') {
        mostrarSeccion('inicio');
        setTimeout(() => window.abrirReglasEco && window.abrirReglasEco(), 250);
    } else {
        mostrarSeccion(destino);
    }
}

export function irANovedad(id) {
    cerrarCampana();
    const n = leerNovedades().find(x => String(x.id) === String(id));
    if (!n) return;
    navegarADestino({ ...(n.datos || {}), destino: n.destino, url: n.url, tipo: n.tipo });
}

export async function probarPush() {
    try {
        const { data, error } = await supabaseClient.rpc('enviar_push_prueba');
        if (error) throw error;
        mostrarToast(data > 0
            ? `Enviada a ${data} celular(es). Cierra la app y espera unos segundos.`
            : 'Este usuario no tiene celular registrado. Cierra sesión, vuelve a entrar y acepta los permisos.');
    } catch (e) { mostrarToast('No se pudo enviar la prueba: ' + (e.message || e)); }
}

/* ==========================================
   NOTIFICACIONES MÓVILES (locales y push)
========================================== */
async function crearCanalNotificaciones(plugin) {
    try {
        await plugin.createChannel(CANAL_NOTIFICACIONES);
        return true;
    } catch (e) {
        console.warn("No se pudo crear el canal de notificaciones:", e);
        return false;
    }
}

export async function solicitarPermisoNotificaciones() {
    if (plugins.LocalNotifications) {
        try {
            const perm = await plugins.LocalNotifications.requestPermissions();
            if (perm.display !== 'granted') {
                console.warn("Permiso de notificaciones locales no concedido en dispositivo nativo.");
            }
        } catch (e) {
            console.warn("Error al solicitar permisos locales de Capacitor:", e);
        }
        canalNotificacionesCreado = await crearCanalNotificaciones(plugins.LocalNotifications);
    } else if ("Notification" in window) {
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            try { await Notification.requestPermission(); } catch (e) {}
        }
    }
}

export function dispararNotificacionMovil(titulo, mensaje, extra) {
    // Toda notificación queda guardada en la campana; si ya estaba, no se vuelve a avisar
    const nueva = registrarNovedadCampana({ ...(extra || {}), titulo, mensaje });
    if (!nueva) return;
    if (pushActivo && document.visibilityState === 'hidden') return;

    if (plugins.LocalNotifications) {
        try {
            plugins.LocalNotifications.schedule({
                notifications: [{
                    title: titulo,
                    body: mensaje,
                    id: Math.floor(Math.random() * 100000),
                    ...(canalNotificacionesCreado ? { channelId: CANAL_NOTIFICACIONES.id } : {})
                }]
            });
        } catch (e) {
            console.error("Error al programar notificación local:", e);
        }
    } else if ("Notification" in window && Notification.permission === "granted") {
        try {
            new Notification(titulo, { body: mensaje, icon: 'logo.png' });
        } catch (e) {}
    }
}

export async function registrarNotificacionesPush() {
    if (!plugins.PushNotifications || !supabaseClient) return;      
    if (!estaLogueado()) return;
    const emailUsuario = emailUsuarioApp();

    try {
        await plugins.PushNotifications.removeAllListeners();

        await plugins.PushNotifications.addListener('registration', async (token) => {
            try {
                // Pasamos explícitamente el token y el email del usuario a la función RPC
                const { error } = await supabaseClient.rpc('registrar_token_push', { 
                    p_token: token.value, 
                    p_email: emailUsuario 
                });
                if (error) throw error;
                
                localStorage.setItem('pushTokenActual', token.value);
                pushActivo = true;
            } catch (e) {
                console.warn("No se pudo guardar el token push en Supabase:", e);
            }
        });

        await plugins.PushNotifications.addListener('registrationError', (err) => {
            pushActivo = false;
            console.warn("Error de registro push:", err);
        });

        // Con la app abierta FCM no muestra la bandeja: se guarda en la campana y se avisa con un toast
        await plugins.PushNotifications.addListener('pushNotificationReceived', (n) => {
            const d = n?.data || {};
            const nueva = registrarNovedadCampana({ id: 'push-' + (n.id || Date.now()), titulo: n.title || 'Ciudad Limpia', mensaje: n.body || '', tipo: d.tipo, destino: d.destino, url: d.url, datos: d });
            if (nueva) mostrarToast(`🔔 ${n.title || 'Nueva notificación'}`);
        });

        // Al tocar la notificación se abre el reporte correspondiente y directamente su chat
        await plugins.PushNotifications.addListener('pushNotificationActionPerformed', (accion) => {
            const datos = accion?.notification?.data || {};
            registrarNovedadCampana({ id: 'push-' + (accion?.notification?.id || Date.now()), titulo: accion?.notification?.title || 'Ciudad Limpia', mensaje: accion?.notification?.body || '', tipo: datos.tipo, destino: datos.destino, url: datos.url, datos });
            navegarADestino(datos);
        });

        let permiso = await plugins.PushNotifications.checkPermissions();
        if (permiso.receive === 'prompt' || permiso.receive === 'prompt-with-rationale') {
            permiso = await plugins.PushNotifications.requestPermissions();
        }
        if (permiso.receive !== 'granted') {
            console.warn("Permiso de notificaciones push no concedido.");
            return;
        }

        await crearCanalNotificaciones(plugins.PushNotifications);

        await plugins.PushNotifications.register();
        sincronizarNotificacionesEntregadas();
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizarNotificacionesEntregadas(); });
    } catch (e) {
        console.warn("No se pudieron activar las notificaciones push:", e);
    }
}

// Las notificaciones que llegaron con la app cerrada y siguen en la bandeja del celular pasan a la campana
async function sincronizarNotificacionesEntregadas() {
    try {
        const { notifications } = await plugins.PushNotifications.getDeliveredNotifications();
        (notifications || []).forEach(n => {
            const d = n.data || {};
            registrarNovedadCampana({ id: 'push-' + n.id, titulo: n.title || 'Ciudad Limpia', mensaje: n.body || '', tipo: d.tipo, destino: d.destino, url: d.url, datos: d });
        });
    } catch (e) { /* no disponible en el navegador */ }
}

export async function desregistrarTokenPush() {
    const token = localStorage.getItem('pushTokenActual');
    if (!token || !supabaseClient) return;

    try {
        await supabaseClient.rpc('eliminar_token_push', { p_token: token });
    } catch (e) {}

    localStorage.removeItem('pushTokenActual');
    pushActivo = false;
}

/* ==========================================
   SUSCRIPCIONES EN TIEMPO REAL
========================================== */
async function cargarEstadosBaseReportes(emailUsuario) {
    if (!supabaseClient || !emailUsuario) return;
    try {
        const resultados = await Promise.all(TABLAS_REPORTES.map(tabla =>
            supabaseClient.from(tabla).select('id, estado').eq('usuario_email', emailUsuario)
        ));
        resultados.forEach((res, i) => {
            (res.data || []).forEach(r => {
                ultimoEstadoReportes[`${TABLAS_REPORTES[i]}:${r.id}`] = (r.estado || 'pendiente').toLowerCase();
            });
        });
    } catch (e) {
        console.warn("No se pudo cargar el estado base de los reportes:", e);
    }
}

async function reporteEsDelUsuario(tabla, idReporte, emailUsuario) {
    if (!supabaseClient || !tabla || !idReporte || !emailUsuario) return false;

    try {
        const { data, error } = await supabaseClient.from(tabla).select('usuario_email').eq('id', idReporte).single();
        if (error || !data) return false;
        return (data.usuario_email || '').trim().toLowerCase() === emailUsuario;
    } catch (e) {
        return false;
    }
}

export function escucharAlertasGeneralesYChat() {
    if (!supabaseClient) return;
    const miEmailUsuario = emailUsuarioApp();

    cargarEstadosBaseReportes(miEmailUsuario);

    supabaseClient
        .channel('canal-chat-ciudadano-push')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_reportes' }, async payload => {
            const mensajeNuevo = payload.new;
            if (!mensajeNuevo || !['institucion', 'reciclador'].includes(mensajeNuevo.emisor)) return;

            const esMio = await reporteEsDelUsuario(mensajeNuevo.tabla_origen, mensajeNuevo.reporte_id, miEmailUsuario);
            if (!esMio) return;

            dispararNotificacionMovil("Ciudad Limpia - Respuesta Oficial", mensajeNuevo.mensaje);
            mostrarToast("¡Tienes nueva respuesta de la administración en tu chat!");
            emitir(EVENTOS.CHAT_NUEVO, { reporteId: mensajeNuevo.reporte_id });
        })
        .subscribe();

    TABLAS_REPORTES.forEach(tabla => {
        supabaseClient
            .channel(`canal-cambios-estado-${tabla}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: tabla }, payload => {
                const reporteActualizado = payload.new;
                if (!reporteActualizado) return;

                const emailReporte = (reporteActualizado.usuario_email || '').trim().toLowerCase();
                if (!(miEmailUsuario && emailReporte && miEmailUsuario === emailReporte)) return;

                const clave = `${tabla}:${reporteActualizado.id}`;
                const nuevoEstado = (reporteActualizado.estado || 'pendiente').toLowerCase();
                const estadoPrevio = ultimoEstadoReportes[clave] || 'pendiente';
                ultimoEstadoReportes[clave] = nuevoEstado;

                if (nuevoEstado === estadoPrevio) return;

                const plantilla = plantillaAppAlerta('estado_reporte', 'Actualización de Reporte #{codigo}', 'Tu reporte cambió de estado a: {estado}',
                    { codigo: reporteActualizado.codigo || reporteActualizado.id, estado: nuevoEstado.replace('_', ' ').toUpperCase() });
                if (plantilla) {
                    dispararNotificacionMovil(plantilla.titulo, plantilla.mensaje, { tipo: 'estado' });
                    mostrarToast(`📢 ${plantilla.mensaje}`);
                }
                emitir(EVENTOS.REPORTE_ACTUALIZADO, { id: reporteActualizado.id, tabla });
            })
            .subscribe();
    });

    supabaseClient
        .channel('canal-rutas-ciudadano')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rutas_recoleccion' }, () => emitir(EVENTOS.RUTAS_CAMBIARON))
        .subscribe();

    supabaseClient
        .channel('canal-avisos-generales')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'avisos_institucionales' }, payload => {
            if (payload.new) {
                dispararNotificacionMovil("Aviso Importante - Ciudad Limpia", payload.new.titulo || "Nueva actualización institucional disponible.");
                mostrarToast("📢 Nuevo aviso general publicado.");
            }
        })
        .subscribe();
}

/* ---------- Notificaciones enviadas desde el panel (tabla notificaciones) ---------- */
function notificacionEsParaMi(n) {
    const u = datosUsuarioApp();
    const nm = normalizarTexto(n.municipio), nb = normalizarTexto(n.barrio);
    if (nm && nm !== 'todos' && nm !== normalizarTexto(u.municipio)) return false;
    if (nb && nb !== normalizarTexto(u.barrio)) return false;
    return true;
}

export async function cargarNotificacionesServidor() {
    if (!supabaseClient) return;
    // La primera vez no se marca como pendiente todo el historial anterior
    if (!localStorage.getItem(claveLeidas())) localStorage.setItem(claveLeidas(), new Date().toISOString());
    try {
        const { data } = await supabaseClient.from('notificaciones').select('*').order('created_at', { ascending: false }).limit(30);
        (data || []).filter(notificacionEsParaMi).reverse().forEach(n =>
            registrarNovedadCampana({ id: n.clave_unica || n.id, tipo: n.tipo, titulo: n.titulo, mensaje: n.mensaje, fecha: n.created_at, destino: n.destino || null, url: n.url || null }));
    } catch (e) {}
    actualizarBadgeCampana();
}

export function escucharNotificacionesServidor() {
    if (!supabaseClient) return;
    supabaseClient
        .channel('canal-notificaciones-app')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificaciones' }, payload => {
            const n = payload.new;
            if (!n || !notificacionEsParaMi(n)) return;
            const id = n.clave_unica || n.id;
            if (novedadExiste(id)) return;
            dispararNotificacionMovil(n.titulo, n.mensaje, { id, tipo: n.tipo, fecha: n.created_at });
            mostrarToast(`🔔 ${n.titulo}`);
        })
        .subscribe();
}

export function iniciarCampana() {
    registrarCapaCerrable({ estaAbierta: campanaAbierta, cerrar: cerrarCampana });
    actualizarBadgeCampana();
}

Object.assign(window, { abrirCampana, cerrarCampana, limpiarNovedades, irANovedad, probarPush });
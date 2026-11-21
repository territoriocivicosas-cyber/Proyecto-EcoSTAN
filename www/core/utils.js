/* ==========================================
   core/utils.js
   Utilidades puras y estado compartido. No depende de ningún módulo de negocio:
   todos los módulos pueden importarlo sin crear ciclos.
========================================== */
import { supabaseClient } from './supabaseClient.js';
import { datosUsuarioApp } from './authService.js';

export const APP_VERSION = '1.0.0';

/* ---------- Plugins de Capacitor (undefined cuando corre en el navegador) ---------- */
export const plugins = {
    get Geolocation() { return window.Capacitor?.Plugins?.Geolocation; },
    get Camera() { return window.Capacitor?.Plugins?.Camera; },
    get LocalNotifications() { return window.Capacitor?.Plugins?.LocalNotifications; },
    get PushNotifications() { return window.Capacitor?.Plugins?.PushNotifications; },
    get App() { return window.Capacitor?.Plugins?.App; },
    get Browser() { return window.Capacitor?.Plugins?.Browser; }
};

/* ---------- Estado compartido entre módulos (solo lo que de verdad se comparte) ---------- */
export const estado = {
    gpsLat: null,
    gpsLng: null,
    reporteSeleccionado: null,           // { ...fila, tablaOrigen }
    pantalla: () => 'inicio'             // navigation.js lo reemplaza por la sección real
};

/* ---------- Eventos entre módulos (evita dependencias circulares) ---------- */
export const EVENTOS = {
    ABRIR_REPORTE: 'ecostan:abrir-reporte',            // { id, tabla, pestana? }
    CHAT_NUEVO: 'ecostan:chat-nuevo',                  // { reporteId }
    CHAT_REFRESCAR: 'ecostan:chat-refrescar',          // {}
    REPORTE_ACTUALIZADO: 'ecostan:reporte-actualizado',// { id, tabla }
    RUTAS_CAMBIARON: 'ecostan:rutas-cambiaron'         // {}
};
export const emitir = (nombre, detalle = {}) => window.dispatchEvent(new CustomEvent(nombre, { detail: detalle }));
export const escuchar = (nombre, fn) => window.addEventListener(nombre, e => fn(e.detail));

export function alDOMListo(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
}

/* ---------- Texto y fechas ---------- */
export function escaparHtml(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export const normalizarTexto = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function fechaLocalISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function setTexto(id, valor) {
    const el = document.getElementById(id);
    if (el) el.textContent = valor;
    else console.warn('Elemento no encontrado en la pantalla:', id);
}

export function mostrarToast(mensaje) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    const p = toast.querySelector('p');
    if (p) p.textContent = mensaje;
    toast.classList.add('activo');
    setTimeout(() => {
        toast.classList.remove('activo');
    }, 4000);
}

// "Ver detalles": URL externa -> navegador; nota corta -> sección Avisos de la app
export function abrirEnlaceExterno(url) {
    const Browser = window.Capacitor?.Plugins?.Browser;
    if (Browser && typeof Browser.open === 'function') Browser.open({ url });
    else window.open(url, '_blank', 'noopener');
}

/* ==========================================
   REGISTRO DE ERRORES
   Si algo falla en el celular de un ciudadano, queda guardado en Supabase (tabla errores_app)
   con la versión, la pantalla y el usuario, y se puede revisar en el panel del superadmin.
========================================== */
let erroresRegistrados = 0;
const erroresRecientes = {};

export async function registrarErrorApp(origen, err) {
    try {
        const mensaje = String((err && err.message) || err || 'Error desconocido').slice(0, 300);
        console.error(`[${origen}]`, err);
        const clave = origen + mensaje;
        if (erroresRegistrados >= 8 || (erroresRecientes[clave] && Date.now() - erroresRecientes[clave] < 60000)) return;
        erroresRecientes[clave] = Date.now();
        erroresRegistrados++;
        if (!supabaseClient) return;
        await supabaseClient.from('errores_app').insert([{
            version: APP_VERSION,
            usuario_email: (datosUsuarioApp().email || '').toLowerCase() || null,
            pantalla: estado.pantalla() + ' | ' + origen,
            mensaje,
            detalle: String((err && err.stack) || '').slice(0, 1500),
            dispositivo: (navigator.userAgent || '').slice(0, 200)
        }]);
    } catch (e) { /* el registro de errores nunca debe causar otro error */ }
}

export function iniciarRegistroErrores() {
    console.info('EcoSTAN versión', APP_VERSION);
    window.addEventListener('error', e => registrarErrorApp('error', e.error || e.message));
    window.addEventListener('unhandledrejection', e => registrarErrorApp('promesa', e.reason));
    alDOMListo(() => {
        document.querySelectorAll('footer').forEach(f => f.insertAdjacentHTML('beforeend', `<br><small>Versión ${APP_VERSION}</small>`));
    });
}

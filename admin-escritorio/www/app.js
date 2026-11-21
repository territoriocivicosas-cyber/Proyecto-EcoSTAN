/* ==========================================
   app.js — Inicializador de la app ciudadana (home.html)
   Compone los módulos en el orden correcto y contiene solo la "cáscara" de la pantalla:
   perfil, políticas, compartir y cierre de sesión. Toda la lógica de negocio vive en /modules.
   home.html debe cargarlo como módulo:  <script type="module" src="app.js"></script>
========================================== */
import { datosUsuarioApp, estaLogueado, exigirLogin, irALogin, guardarPerfilUsuario, actualizarPasswordUsuario, cerrarSesionGlobal } from './core/authService.js';
import { alDOMListo, iniciarRegistroErrores, mostrarToast, registrarErrorApp } from './core/utils.js';
import { cargarVistas } from './core/views.js';
import { cerrarMenu, mostrarSeccion, iniciarNavegacion, verificarEstadoUsuarioSidebar } from './core/navigation.js';
import {
    cargarConfigAlertasApp, cargarNotificacionesServidor, escucharAlertasGeneralesYChat, escucharNotificacionesServidor,
    iniciarCampana, solicitarPermisoNotificaciones, registrarNotificacionesPush, desregistrarTokenPush
} from './core/notifications.js';
import { iniciarMapa, obtenerUbicacionGPS } from './modules/map_routing/map.js';
import { iniciarColecciones } from './modules/collections/collections.js';
import { iniciarBanners } from './modules/banners/banners.js';
import { iniciarEducacion, recordarTriviaDiaria } from './modules/education/education.js';
import { sincronizarEcopuntosNovedades } from './modules/rewards/rewards.js';

/* ==========================================
   PERFIL Y SESIÓN
========================================== */
function intentarAccesoPerfil(seccionPerfil) {
    if (!estaLogueado()) {
        cerrarMenu();
        irALogin();
        return;
    }
    abrirSeccionPerfil(seccionPerfil);
}

function abrirSeccionPerfil(seccionPerfil) {
    cerrarMenu();
    mostrarSeccion('perfil-' + seccionPerfil, true);

    if (seccionPerfil === 'datos-personales' && estaLogueado()) {
        const usuario = datosUsuarioApp();
        const poner = (id, valor) => { const el = document.getElementById(id); if (el) el.value = valor || ''; };
        poner('perfilNombre', usuario.nombre);
        poner('perfilEdad', usuario.edad);
        poner('perfilBarrio', usuario.barrio);
        poner('perfilMunicipio', usuario.municipio);
    }
}

function manejarClickHeaderPerfil() {
    if (!estaLogueado()) {
        cerrarMenu();
        irALogin();
    }
}

async function guardarDatosPersonales(event) {
    event.preventDefault();
    const valor = id => document.getElementById(id)?.value;

    const usuario = datosUsuarioApp();
    usuario.nombre = valor('perfilNombre') || '';
    usuario.edad = document.getElementById('perfilEdad') ? parseInt(valor('perfilEdad')) : null;
    usuario.barrio = (valor('perfilBarrio') || '').trim();
    usuario.municipio = valor('perfilMunicipio') || '';

    await guardarPerfilUsuario(usuario);

    mostrarToast("¡Datos personales actualizados correctamente!");
    mostrarSeccion('inicio', true);
}

async function actualizarPassword(event) {
    event.preventDefault();
    const nuevoPassword = document.getElementById('nuevoPassword')?.value || '';

    try {
        const { local } = await actualizarPasswordUsuario(nuevoPassword);
        if (local) {
            mostrarToast("Contraseña actualizada localmente.");
        } else {
            mostrarToast("¡Contraseña actualizada con éxito!");
            document.getElementById('formCambiarPassword')?.reset();
        }
        mostrarSeccion('inicio', true);
    } catch (err) {
        alert("Error al actualizar la contraseña: " + err.message);
    }
}

async function cerrarSesionApp() {
    await desregistrarTokenPush();
    await cerrarSesionGlobal();
    mostrarToast("Has cerrado sesión correctamente.");
    irALogin();
}

function intentarCrearReporte() {
    if (!exigirLogin("Debes iniciar sesión para poder crear un reporte ciudadano.")) return;
    mostrarSeccion('menu-crear-reporte', true);
}

async function compartirApp() {
    const datos = {
        title: 'Ciudad Limpia - Bucaramanga',
        text: '¡Ayuda a mantener limpia nuestra ciudad! Usa esta app para reportar y consultar rutas.',
        url: window.location.href
    };

    if (navigator.share) {
        try { await navigator.share(datos); } catch (e) {}
    } else if (navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(datos.url);
            mostrarToast("Enlace copiado al portapapeles.");
        } catch (err) {
            alert("No se pudo copiar el enlace.");
        }
    } else {
        alert("Tu dispositivo no permite compartir desde aquí.");
    }
}

/* ==========================================
   POLÍTICAS (primera vez)
========================================== */
function verificarPoliticasPrimeraVez() {
    const aceptoPoliticas = localStorage.getItem('politicasAceptadasCiudadLimpia');
    const modal = document.getElementById('modalPoliticas');
    if (!aceptoPoliticas && modal) {
        modal.style.display = 'flex';
        modal.classList.add('activo');
    }
}

function aceptarPoliticasPrimeraVez() {
    localStorage.setItem('politicasAceptadasCiudadLimpia', 'true');
    const modal = document.getElementById('modalPoliticas');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('activo');
    }
}

/* ==========================================
   ARRANQUE (el orden importa: primero se registran los módulos, luego se piden permisos)
========================================== */
alDOMListo(async () => {
    iniciarRegistroErrores();

    // Primero se insertan las pantallas de los módulos en home.html; después se activan.
    try {
        await cargarVistas();
    } catch (e) {
        registrarErrorApp('cargarVistas', e);
        mostrarToast('No se pudieron cargar las pantallas de la app. Revisa tu conexión y reinicia.');
        return;
    }

    iniciarNavegacion();

    verificarEstadoUsuarioSidebar();
    verificarPoliticasPrimeraVez();

    iniciarMapa();
    iniciarBanners();
    iniciarColecciones();
    iniciarEducacion();

    escucharAlertasGeneralesYChat();
    cargarConfigAlertasApp().then(() => {
        cargarNotificacionesServidor();
        sincronizarEcopuntosNovedades();
        recordarTriviaDiaria();
    });
    escucharNotificacionesServidor();
    iniciarCampana();

    await obtenerUbicacionGPS();
    await solicitarPermisoNotificaciones();
    registrarNotificacionesPush();
});

// Funciones que home.html invoca desde atributos onclick/onsubmit
Object.assign(window, {
    intentarAccesoPerfil, manejarClickHeaderPerfil, guardarDatosPersonales, actualizarPassword,
    cerrarSesionApp, intentarCrearReporte, compartirApp, aceptarPoliticasPrimeraVez
});
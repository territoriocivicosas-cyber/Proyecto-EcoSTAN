/* ==========================================
   core/navigation.js
   Estructura de la app: menú lateral, secciones, historial y botón "atrás"
   (navegador y Android). No conoce a los módulos de negocio: ellos se registran con
   alEntrarEnSeccion() y registrarCapaCerrable().
========================================== */
import { datosUsuarioApp, estaLogueado } from './authService.js';
import { estado, mostrarToast, registrarErrorApp, plugins } from './utils.js';

let pilaNavegacion = ['inicio'];
let ignorarPopstateHasta = 0;
let ultimoAtrasEnRaiz = 0;

const hooksSeccion = {};      // nombre de sección -> [funciones a ejecutar al entrar]
const capasCerrables = [];    // paneles superpuestos (campana, QR, etc.) que "atrás" debe cerrar primero

export function alEntrarEnSeccion(nombre, fn) {
    (hooksSeccion[nombre] = hooksSeccion[nombre] || []).push(fn);
}

export function registrarCapaCerrable(capa) {   // { estaAbierta: () => bool, cerrar: () => void }
    capasCerrables.push(capa);
}

function cerrarCapaAbierta() {
    const capa = capasCerrables.find(c => c.estaAbierta());
    if (!capa) return false;
    capa.cerrar();
    return true;
}

/* ==========================================
   CONTROL DEL MENÚ
========================================== */
export function abrirMenu() {
    const menu = document.getElementById('menuPagina');
    if (menu) {
        menu.classList.add('activo');
        menu.setAttribute('aria-hidden', 'false');
        verificarEstadoUsuarioSidebar();
    }
}

export function cerrarMenu() {
    const menu = document.getElementById('menuPagina');
    if (menu) {
        menu.classList.remove('activo');
        menu.setAttribute('aria-hidden', 'true');
    }
}

export function abrirInfo(nombre) {
    cerrarMenu();
    mostrarSeccion('info-' + nombre, true);
}

export function verificarEstadoUsuarioSidebar() {
    const labelNombre = document.getElementById('menuNombreUsuario');
    const seccionCuenta = document.getElementById('seccionCuentaDinamica');
    const separadorCierre = document.getElementById('separadorCierreSesion');
    const botonCerrar = document.getElementById('botonCerrarSesionDinamico');

    if (estaLogueado() && labelNombre) {
        const usuario = datosUsuarioApp();
        labelNombre.textContent = usuario.nombre || usuario.email || 'Mi cuenta';

        if (seccionCuenta) {
            seccionCuenta.innerHTML = `
                <button class="menu-item" onclick="intentarAccesoPerfil('datos-personales')">
                    <span class="menu-ico">👤</span><span class="menu-txt">Datos personales</span><span class="menu-flecha">›</span>
                </button>
                <button class="menu-item" onclick="intentarAccesoPerfil('cambiar-password')">
                    <span class="menu-ico">🔑</span><span class="menu-txt">Cambiar contraseña</span><span class="menu-flecha">›</span>
                </button>
            `;
        }
        if (separadorCierre) separadorCierre.style.display = 'block';
        if (botonCerrar) botonCerrar.style.display = 'flex';
    } else if (labelNombre) {
        labelNombre.textContent = 'Iniciar sesión';
        if (seccionCuenta) seccionCuenta.innerHTML = '';
        if (separadorCierre) separadorCierre.style.display = 'none';
        if (botonCerrar) botonCerrar.style.display = 'none';
    }
}

export function menuLateralAbierto() {
    const menu = document.getElementById('menuPagina');
    return !!(menu && menu.classList.contains('activo'));
}

/* ==========================================
   CAMBIAR SECCIONES Y HISTORIAL (BOTÓN ATRÁS)
========================================== */
export function mostrarSeccion(nombre, registrarHistorial = true) {
    if (menuLateralAbierto()) cerrarMenu();

    if (hayModalObligatorioAbierto()) return;

    document.querySelectorAll(".seccion").forEach(seccion => seccion.classList.remove("activa"));
    const seccionSeleccionada = document.getElementById(nombre);
    if (seccionSeleccionada) seccionSeleccionada.classList.add("activa");

    cambiarTitulo(nombre);

    if (registrarHistorial) {
        // "inicio" siempre es la base de la pila: evita bucles al volver atrás
        if (nombre === 'inicio' && pilaNavegacion.length > 1) pilaNavegacion = ['inicio'];
        const seccionActual = pilaNavegacion[pilaNavegacion.length - 1];
        if (seccionActual !== nombre) {
            if (nombre === 'detalle-solicitud' && seccionActual && seccionActual.indexOf('reporte-') === 0) {
                // Al enviar un formulario, el detalle reemplaza al formulario:
                // "atrás" no devuelve al usuario a un formulario vacío.
                pilaNavegacion[pilaNavegacion.length - 1] = nombre;
                history.replaceState({ seccion: nombre }, "", `#${nombre}`);
            } else {
                pilaNavegacion.push(nombre);
                history.pushState({ seccion: nombre }, "", `#${nombre}`);
            }
        }
    }

    // Cada módulo de negocio engancha aquí lo que necesita al entrar en su pantalla
    (hooksSeccion[nombre] || []).forEach(fn => {
        try { fn(); } catch (e) { registrarErrorApp('seccion:' + nombre, e); }
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
}

export function seccionActualNavegacion() {
    return pilaNavegacion[pilaNavegacion.length - 1] || 'inicio';
}

export function hayModalObligatorioAbierto() {
    const modal = document.getElementById('modalPoliticas');
    return !!(modal && modal.classList.contains('activo'));
}

// Retrocede un solo paso en la pila de pantallas (nunca cierra la app)
function retrocederUnPaso() {
    if (pilaNavegacion.length > 1) pilaNavegacion.pop();
    else pilaNavegacion = ['inicio'];
    mostrarSeccion(seccionActualNavegacion(), false);
}

// Botón "Atrás" de la interfaz: onclick="volverAtras()" en el encabezado de la app
export function volverAtras() {
    if (hayModalObligatorioAbierto()) return;
    if (cerrarCapaAbierta()) return;
    if (menuLateralAbierto()) { cerrarMenu(); return; }
    if (pilaNavegacion.length > 1) {
        ignorarPopstateHasta = Date.now() + 400;
        history.back();
        retrocederUnPaso();
    } else {
        mostrarSeccion('inicio', false);
    }
}

// En la pantalla de inicio se necesitan dos pulsaciones seguidas para salir
function confirmarSalidaDobleAtras() {
    const ahora = Date.now();
    if (ahora - ultimoAtrasEnRaiz < 2000) {
        ultimoAtrasEnRaiz = 0;
        return true;
    }
    ultimoAtrasEnRaiz = ahora;
    mostrarToast("Presiona atrás de nuevo para salir de la app");
    return false;
}

// Botón atrás del navegador / WebView
function manejarPopstate() {
    if (Date.now() < ignorarPopstateHasta) {
        ignorarPopstateHasta = 0;
        return;
    }

    // Menú lateral o políticas abiertas: se cierra el menú y se repone la entrada del historial
    if (menuLateralAbierto() || hayModalObligatorioAbierto()) {
        if (menuLateralAbierto()) cerrarMenu();
        const actual = seccionActualNavegacion();
        history.pushState({ seccion: actual }, "", `#${actual}`);
        return;
    }

    if (pilaNavegacion.length > 1) {
        retrocederUnPaso();
        return;
    }

    // Pantalla de inicio: no salir a la primera
    if (confirmarSalidaDobleAtras()) {
        history.back();
    } else {
        history.pushState({ seccion: 'inicio' }, "", "#inicio");
    }
}

// Botón atrás físico de Android (Capacitor)
function manejarBotonAtrasNativo() {
    if (hayModalObligatorioAbierto()) return;
    if (cerrarCapaAbierta()) return;

    if (menuLateralAbierto()) {
        cerrarMenu();
        return;
    }

    if (pilaNavegacion.length > 1) {
        // Se mantiene sincronizado el historial del WebView sin duplicar el paso
        ignorarPopstateHasta = Date.now() + 400;
        history.back();
        retrocederUnPaso();
        return;
    }

    if (confirmarSalidaDobleAtras() && plugins.App && typeof plugins.App.exitApp === 'function') {
        plugins.App.exitApp();
    }
}

function registrarBotonAtrasNativo() {
    if (!plugins.App || typeof plugins.App.addListener !== 'function') return;
    try {
        plugins.App.addListener('backButton', manejarBotonAtrasNativo);
    } catch (e) {
        console.warn("No se pudo registrar el botón atrás nativo:", e);
    }
}

function cambiarTitulo(nombre) {
    const titulo = document.getElementById("tituloPagina");
    const titulos = {
        "inicio": "Ciudad Limpia",
        "rutas": "Rutas de recolección",
        "avisos": "Avisos",
        "mis-reportes": "Listado",
        "detalle-solicitud": "Solicitud",
        "educacion": "Educación ambiental",
        "perfil-datos-personales": "Datos personales",
        "perfil-cambiar-password": "Cambiar contraseña",
        "menu-crear-reporte": "Crear Reporte",
        "reporte-retirar-residuo": "Retirar Residuo",
        "reporte-residuos-abandonados": "Reportar problemas de la ciudad",
        "reporte-violencia-animal": "Violencia Animal",
        "reporte-reciclaje-ciclogo": "Entregar a Recicladores",
        "reporte-ciudadania-activa": "Ciudadanía Activa"
    };

    if (titulo) {
        titulo.textContent = titulos[nombre] || "Ciudad Limpia";
    }
}

export function iniciarNavegacion() {
    estado.pantalla = seccionActualNavegacion;
    window.addEventListener('popstate', manejarPopstate);
    // Entrada "raíz" + entrada de inicio: así el primer "atrás" en inicio no cierra la app
    history.replaceState({ seccion: 'raiz' }, "", "#raiz");
    history.pushState({ seccion: 'inicio' }, "", "#inicio");
    registrarBotonAtrasNativo();
}

Object.assign(window, { mostrarSeccion, volverAtras, abrirMenu, cerrarMenu, abrirInfo });
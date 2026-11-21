/* ==========================================
   CARGA SEGURA DE MÓDULOS DE CAPACITOR
========================================== */
let Geolocation = window.Capacitor?.Plugins?.Geolocation;
let Camera = window.Capacitor?.Plugins?.Camera;
let LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;
let PushNotifications = window.Capacitor?.Plugins?.PushNotifications;

/* ==========================================
   CONFIGURACIÓN SUPABASE
========================================== */
const SUPABASE_URL = 'https://afwlonmlxzwkmiumpsyt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8C7CKRVixeJmD9BsnTJQ3A_aVzU-wey';

const supabaseClient = (window.supabase && typeof window.supabase.createClient === 'function')
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

window.supabaseClient = supabaseClient;

let gpsLat = null;
let gpsLng = null;
let mapInstance = null;

let mapRetirar = null;
let markerRetirar = null;
let mapAbandonados = null;
let markerAbandonados = null;
let mapViolenciaAnimal = null;
let markerViolenciaAnimal = null;

let mapDetalle = null;

let reporteSeleccionadoActual = null;
let pilaNavegacion = ['inicio'];

// Paginación del listado de reportes y último estado conocido de los reportes del usuario
const LIMITE_REPORTES_INICIAL = 30;
let limiteReportesListado = LIMITE_REPORTES_INICIAL;
let ultimoEstadoReportes = {};
let pushActivo = false;

/* ==========================================
   CONTROL DEL MENÚ Y PERFIL
========================================== */
function abrirMenu() {
    const menu = document.getElementById('menuPagina');
    if (menu) {
        menu.classList.add('activo');
        menu.setAttribute('aria-hidden', 'false');
        verificarEstadoUsuarioSidebar();
    }
}

function cerrarMenu() {
    const menu = document.getElementById('menuPagina');
    if (menu) {
        menu.classList.remove('activo');
        menu.setAttribute('aria-hidden', 'true');
    }
}

function abrirInfo(nombre) {
    cerrarMenu();
    mostrarSeccion('info-' + nombre, true);
}

function intentarAccesoPerfil(seccionPerfil) {
    const usuarioStr = localStorage.getItem('usuarioLogueado');
    if (!usuarioStr) {
        cerrarMenu();
        window.location.href = "login.html";
        return;
    }
    abrirSeccionPerfil(seccionPerfil);
}

function abrirSeccionPerfil(seccionPerfil) {
    cerrarMenu();
    mostrarSeccion('perfil-' + seccionPerfil, true);
    
    if (seccionPerfil === 'datos-personales') {
        const usuarioStr = localStorage.getItem('usuarioLogueado');
        if (usuarioStr) {
            try {
                const usuario = JSON.parse(usuarioStr);
                const inputNombre = document.getElementById('perfilNombre');
                const inputEdad = document.getElementById('perfilEdad');
                const inputBarrio = document.getElementById('perfilBarrio');
                
                if (inputNombre) inputNombre.value = usuario.nombre || '';
                if (inputEdad) inputEdad.value = usuario.edad || '';
                if (inputBarrio) inputBarrio.value = usuario.barrio || '';
            } catch (e) {
                console.error("Error al parsear datos de usuario:", e);
            }
        }
    }
}

function manejarClickHeaderPerfil() {
    const usuarioStr = localStorage.getItem('usuarioLogueado');
    if (!usuarioStr) {
        cerrarMenu();
        window.location.href = 'login.html';
    }
}

function verificarEstadoUsuarioSidebar() {
    const usuarioStr = localStorage.getItem('usuarioLogueado');
    const labelNombre = document.getElementById('menuNombreUsuario');
    const seccionCuenta = document.getElementById('seccionCuentaDinamica');
    const separadorCierre = document.getElementById('separadorCierreSesion');
    const botonCerrar = document.getElementById('botonCerrarSesionDinamico');

    if (usuarioStr && labelNombre) {
        try {
            const usuario = JSON.parse(usuarioStr);
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

        } catch (e) {
            labelNombre.textContent = 'Mi cuenta';
        }
    } else if (labelNombre) {
        labelNombre.textContent = 'Iniciar sesión';

        if (seccionCuenta) {
            seccionCuenta.innerHTML = '';
        }
        if (separadorCierre) separadorCierre.style.display = 'none';
        if (botonCerrar) botonCerrar.style.display = 'none';
    }
}

async function guardarDatosPersonales(event) {
    event.preventDefault();
    const inputNombre = document.getElementById('perfilNombre');
    const inputEdad = document.getElementById('perfilEdad');
    const inputBarrio = document.getElementById('perfilBarrio');

    let usuario = {};
    const usuarioStr = localStorage.getItem('usuarioLogueado');
    if (usuarioStr) {
        try { usuario = JSON.parse(usuarioStr); } catch (e) {}
    }

    usuario.nombre = inputNombre ? inputNombre.value : '';
    usuario.edad = inputEdad ? parseInt(inputEdad.value) : null;
    usuario.barrio = inputBarrio ? inputBarrio.value : '';

    localStorage.setItem('usuarioLogueado', JSON.stringify(usuario));

    if (supabaseClient && usuario.id) {
        try {
            await supabaseClient.from('usuarios_registrados').upsert({
                id: usuario.id,
                email: usuario.email,
                nombre: usuario.nombre,
                edad: usuario.edad,
                barrio: usuario.barrio
            });
        } catch (err) {
            console.error("Error al sincronizar datos de usuario en Supabase:", err);
        }
    }

    mostrarToast("¡Datos personales actualizados correctamente!");
    mostrarSeccion('inicio', true);
}

async function actualizarPassword(event) {
    event.preventDefault();
    const inputPassword = document.getElementById('nuevoPassword');
    const nuevoPassword = inputPassword ? inputPassword.value : '';

    if (!supabaseClient) {
        mostrarToast("Contraseña actualizada localmente.");
        mostrarSeccion('inicio', true);
        return;
    }

    try {
        const { error } = await supabaseClient.auth.updateUser({ password: nuevoPassword });
        if (error) throw error;
        mostrarToast("¡Contraseña actualizada con éxito!");
        const formPassword = document.getElementById('formCambiarPassword');
        if (formPassword) formPassword.reset();
        mostrarSeccion('inicio', true);
    } catch (err) {
        alert("Error al actualizar la contraseña: " + err.message);
    }
}

async function cerrarSesionApp() {
    await desregistrarTokenPush();

    localStorage.removeItem('usuarioLogueado');
    if (supabaseClient) {
        supabaseClient.auth.signOut();
    }
    mostrarToast("Has cerrado sesión correctamente.");
    window.location.href = "login.html";
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

function intentarCrearReporte() {
    const usuarioStr = localStorage.getItem('usuarioLogueado');
    if (!usuarioStr) {
        alert("Debes iniciar sesión para poder crear un reporte ciudadano.");
        window.location.href = "login.html";
        return;
    }
    mostrarSeccion('menu-crear-reporte', true);
}

/* ==========================================
   CAMBIAR SECCIONES DE NAVEGACIÓN Y HISTORIAL (BOTÓN ATRÁS)
========================================== */
function mostrarSeccion(nombre, registrarHistorial = true) {
    const menuAbierto = document.getElementById('menuPagina');
    if (menuAbierto && menuAbierto.classList.contains('activo')) {
        cerrarMenu();
    }

    const modalPoliticasActivo = document.getElementById('modalPoliticas');
    if (modalPoliticasActivo && modalPoliticasActivo.classList.contains('activo')) {
        return;
    }

    const secciones = document.querySelectorAll(".seccion");
    secciones.forEach(function(seccion) {
        seccion.classList.remove("activa");
    });

    const seccionSeleccionada = document.getElementById(nombre);
    if (seccionSeleccionada) {
        seccionSeleccionada.classList.add("activa");
    }

    cambiarTitulo(nombre);

    if (registrarHistorial) {
        if (pilaNavegacion[pilaNavegacion.length - 1] !== nombre) {
            pilaNavegacion.push(nombre);
            history.pushState({ seccion: nombre }, "", `#${nombre}`);
        }
    }

    if (nombre === "mis-reportes") {
        limiteReportesListado = LIMITE_REPORTES_INICIAL;
        cargarReportes();
    }

    if (nombre === "reporte-retirar-residuo") {
        setTimeout(() => inicializarMapaFormulario('retirar'), 250);
    }
    if (nombre === "reporte-residuos-abandonados") {
        setTimeout(() => inicializarMapaFormulario('abandonados'), 250);
    }
    if (nombre === "reporte-violencia-animal") {
        setTimeout(() => inicializarMapaFormulario('violenciaAnimal'), 250);
    }

    if (nombre === "inicio" || nombre === "rutas" || nombre === "mapa") {
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
            if (mapInstance) mapInstance.invalidateSize();
        }, 200);
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
}

window.addEventListener('popstate', (event) => {
    const menuAbierto = document.getElementById('menuPagina');
    if (menuAbierto && menuAbierto.classList.contains('activo')) {
        cerrarMenu();
        history.pushState(null, '', window.location.href);
        return;
    }

    if (pilaNavegacion.length > 1) {
        pilaNavegacion.pop();
        const seccionAnterior = pilaNavegacion[pilaNavegacion.length - 1] || 'inicio';
        mostrarSeccion(seccionAnterior, false);
    } else {
        mostrarSeccion('inicio', false);
    }
});

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
        "reporte-ciudadania-activa": "Ciudadanía Activa"
    };

    if (titulo) {
        titulo.textContent = titulos[nombre] || "Ciudad Limpia";
    }
}

/* ==========================================
   CARRUSEL DE BANNERS
========================================== */
let bannerIndiceActual = 0;
let bannerIntervalo = null;

const BANNER_POR_DEFECTO = [{
    titulo: 'Ayudemos a mantener <strong>Bucaramanga limpia</strong>',
    descripcion: 'Consulta las rutas de recolección, avisos y recibe información de interés ambiental.',
    texto_boton: '🌱 Ver iniciativas'
}];

async function cargarBanners() {
    const track = document.getElementById('bannerTrack');
    const dotsContenedor = document.getElementById('bannerDots');
    if (!track || !dotsContenedor) return;

    let banners = BANNER_POR_DEFECTO;

    try {
        if (supabaseClient) {
            const { data, error } = await supabaseClient.from('banners').select('*');
            if (!error && Array.isArray(data) && data.length > 0) banners = data;
        }
    } catch (e) {}

    track.innerHTML = banners.map((banner) => `
        <div class="banner-slide">
            <div class="banner-texto">
                <span class="badge">PLATAFORMA CIUDADANA</span>
                <h2>${banner.titulo || ''}</h2>
                <p>${banner.descripcion || ''}</p>
                ${banner.texto_boton ? `<button type="button" class="banner-btn" onclick="mostrarSeccion('educacion')">${banner.texto_boton}</button>` : ''}
            </div>
        </div>
    `).join('');

    dotsContenedor.innerHTML = banners.map((_, i) =>
        `<button type="button" class="banner-dot${i === 0 ? ' activo' : ''}" onclick="irABanner(${i})"></button>`
    ).join('');

    bannerIndiceActual = 0;
    if (bannerIntervalo) clearInterval(bannerIntervalo);
    if (banners.length > 1) {
        bannerIntervalo = setInterval(() => {
            irABanner((bannerIndiceActual + 1) % banners.length);
        }, 6000);
    }
}

function irABanner(indice) {
    const track = document.getElementById('bannerTrack');
    if (!track) return;
    bannerIndiceActual = indice;
    track.scrollTo({ left: track.clientWidth * indice, behavior: 'smooth' });
}

/* ==========================================
   INICIALIZACIÓN Y MAPAS
========================================== */
document.addEventListener("DOMContentLoaded", async () => {
    verificarEstadoUsuarioSidebar();
    verificarPoliticasPrimeraVez();
    inicializarMapa();
    cargarBanners();

    escucharAlertasGeneralesYChat();
    history.replaceState({ seccion: 'inicio' }, "", "#inicio");

    await obtenerUbicacionGPS();
    await solicitarPermisoNotificaciones();
    registrarNotificacionesPush();
});

// GPS Nativo Móvil Centrado
async function obtenerUbicacionGPS() {
    return new Promise((resolve) => {
        if (Geolocation) {
            Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 }).then(position => {
                gpsLat = position.coords.latitude;
                gpsLng = position.coords.longitude;
                if (mapInstance && window.L) {
                    mapInstance.setView([gpsLat, gpsLng], 15);
                }
                resolve(true);
            }).catch(() => {
                fallbackNavegadorGPS(resolve);
            });
        } else {
            fallbackNavegadorGPS(resolve);
        }
    });
}

function fallbackNavegadorGPS(resolve) {
    if (!navigator.geolocation) { resolve(false); return; }
    navigator.geolocation.getCurrentPosition(
        (position) => {
            gpsLat = position.coords.latitude;
            gpsLng = position.coords.longitude;
            if (mapInstance && window.L) {
                mapInstance.setView([gpsLat, gpsLng], 15);
            }
            resolve(true);
        },
        () => resolve(false),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

function inicializarMapa() {
    const contenedorMapa = document.getElementById('mapa-container');
    if (contenedorMapa && !contenedorMapa._leaflet_id && window.L) {
        mapInstance = L.map('mapa-container').setView([7.1254, -73.1198], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapInstance);
    }
}

function inicializarMapaFormulario(tipo) {
    let containerId = 'mapaRetirarGPS';
    if (tipo === 'abandonados') containerId = 'mapaAbandonadosGPS';
    if (tipo === 'violenciaAnimal') containerId = 'mapaViolenciaAnimalGPS';

    const contenedor = document.getElementById(containerId);
    if (!contenedor || !window.L) return;

    let centroInicial = (gpsLat && gpsLng) ? [gpsLat, gpsLng] : [7.1254, -73.1198];

    if (tipo === 'retirar') {
        if (!mapRetirar) {
            mapRetirar = L.map(containerId).setView(centroInicial, 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapRetirar);
            markerRetirar = L.marker(centroInicial, { draggable: true }).addTo(mapRetirar);
            markerRetirar.on('dragend', () => {
                const pos = markerRetirar.getLatLng();
                actualizarCamposCoordenadas('retirar', pos.lat, pos.lng);
            });
            mapRetirar.on('click', (e) => {
                markerRetirar.setLatLng(e.latlng);
                actualizarCamposCoordenadas('retirar', e.latlng.lat, e.latlng.lng);
            });
        }
        mapRetirar.invalidateSize();
        actualizarCamposCoordenadas('retirar', centroInicial[0], centroInicial[1]);
    } else if (tipo === 'abandonados') {
        if (!mapAbandonados) {
            mapAbandonados = L.map(containerId).setView(centroInicial, 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapAbandonados);
            markerAbandonados = L.marker(centroInicial, { draggable: true }).addTo(mapAbandonados);
            markerAbandonados.on('dragend', () => {
                const pos = markerAbandonados.getLatLng();
                actualizarCamposCoordenadas('abandonados', pos.lat, pos.lng);
            });
            mapAbandonados.on('click', (e) => {
                markerAbandonados.setLatLng(e.latlng);
                actualizarCamposCoordenadas('abandonados', e.latlng.lat, e.latlng.lng);
            });
        }
        mapAbandonados.invalidateSize();
        actualizarCamposCoordenadas('abandonados', centroInicial[0], centroInicial[1]);
    } else if (tipo === 'violenciaAnimal') {
        if (!mapViolenciaAnimal) {
            mapViolenciaAnimal = L.map(containerId).setView(centroInicial, 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapViolenciaAnimal);
            markerViolenciaAnimal = L.marker(centroInicial, { draggable: true }).addTo(mapViolenciaAnimal);
            markerViolenciaAnimal.on('dragend', () => {
                const pos = markerViolenciaAnimal.getLatLng();
                actualizarCamposCoordenadas('violenciaAnimal', pos.lat, pos.lng);
            });
            mapViolenciaAnimal.on('click', (e) => {
                markerViolenciaAnimal.setLatLng(e.latlng);
                actualizarCamposCoordenadas('violenciaAnimal', e.latlng.lat, e.latlng.lng);
            });
        }
        mapViolenciaAnimal.invalidateSize();
        actualizarCamposCoordenadas('violenciaAnimal', centroInicial[0], centroInicial[1]);
    }
}

function actualizarCamposCoordenadas(tipo, lat, lng) {
    let latInputId = 'latRetirar';
    let lngInputId = 'lngRetirar';
    let txtInfoId = 'txtGpsRetirar';

    if (tipo === 'abandonados') {
        latInputId = 'latAbandonados';
        lngInputId = 'lngAbandonados';
        txtInfoId = 'txtGpsAbandonados';
    } else if (tipo === 'violenciaAnimal') {
        latInputId = 'latViolenciaAnimal';
        lngInputId = 'lngViolenciaAnimal';
        txtInfoId = 'txtGpsViolenciaAnimal';
    }

    const latInput = document.getElementById(latInputId);
    const lngInput = document.getElementById(lngInputId);
    const txtInfo = document.getElementById(txtInfoId);

    if (latInput) latInput.value = lat;
    if (lngInput) lngInput.value = lng;
    if (txtInfo) txtInfo.textContent = `Coordenadas fijadas: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function obtenerUbicacionActual(tipo) {
    const aplicarUbicacion = (lat, lng) => {
        gpsLat = lat;
        gpsLng = lng;
        if (tipo === 'retirar' && mapRetirar && markerRetirar) {
            mapRetirar.setView([lat, lng], 16);
            markerRetirar.setLatLng([lat, lng]);
            actualizarCamposCoordenadas('retirar', lat, lng);
        } else if (tipo === 'abandonados' && mapAbandonados && markerAbandonados) {
            mapAbandonados.setView([lat, lng], 16);
            markerAbandonados.setLatLng([lat, lng]);
            actualizarCamposCoordenadas('abandonados', lat, lng);
        } else if (tipo === 'violenciaAnimal' && mapViolenciaAnimal && markerViolenciaAnimal) {
            mapViolenciaAnimal.setView([lat, lng], 16);
            markerViolenciaAnimal.setLatLng([lat, lng]);
            actualizarCamposCoordenadas('violenciaAnimal', lat, lng);
        }
        mostrarToast("¡Ubicación GPS obtenida y aplicada!");
    };

    if (Geolocation) {
        Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 }).then(pos => {
            aplicarUbicacion(pos.coords.latitude, pos.coords.longitude);
        }).catch(() => {
            navigator.geolocation.getCurrentPosition(
                pos => aplicarUbicacion(pos.coords.latitude, pos.coords.longitude),
                () => alert("No se pudo obtener tu ubicación GPS actual."),
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
            );
        });
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => aplicarUbicacion(pos.coords.latitude, pos.coords.longitude),
            () => alert("No se pudo obtener tu ubicación GPS actual."),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    } else {
        alert("Tu dispositivo no soporta geolocalización.");
    }
}

function activarSeleccionManual(tipo) {
    let mapaObj = mapRetirar;
    let containerId = 'mapaRetirarGPS';
    if (tipo === 'abandonados') {
        mapaObj = mapAbandonados;
        containerId = 'mapaAbandonadosGPS';
    } else if (tipo === 'violenciaAnimal') {
        mapaObj = mapViolenciaAnimal;
        containerId = 'mapaViolenciaAnimalGPS';
    }

    if (mapaObj) {
        mapaObj.invalidateSize();
        mostrarToast("Modo manual activo: Toca el mapa o arrastra el marcador para fijar la ubicación.");
        const elementoMapa = document.getElementById(containerId);
        if (elementoMapa) {
            elementoMapa.style.border = '2px solid #2e7d32';
            setTimeout(() => {
                elementoMapa.style.border = '1px solid var(--borde)';
            }, 1500);
        }
    } else {
        inicializarMapaFormulario(tipo);
        mostrarToast("Mapa activado para seleccionar ubicación manual.");
    }
}

/* ==========================================
   CONVERSIÓN DE IMÁGENES A BASE64
========================================== */
function convertirArchivoABase64(file) {
    return new Promise((resolve, reject) => {
        if (!file) resolve(null);
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

/* ==========================================
   COMPRESIÓN Y OPTIMIZACIÓN DE IMÁGENES
========================================== */
function convertirYComprimirImagenABase64(file, maxLado = 800, calidad = 0.5) {
    return new Promise((resolve, reject) => {
        if (!file) { resolve(null); return; }

        const lector = new FileReader();
        lector.onerror = error => reject(error);
        lector.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
            img.onload = () => {
                let ancho = img.width;
                let alto = img.height;

                if (ancho > maxLado || alto > maxLado) {
                    if (ancho >= alto) {
                        alto = Math.round(alto * (maxLado / ancho));
                        ancho = maxLado;
                    } else {
                        ancho = Math.round(ancho * (maxLado / alto));
                        alto = maxLado;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = ancho;
                canvas.height = alto;

                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, ancho, alto);
                ctx.drawImage(img, 0, 0, ancho, alto);

                resolve(canvas.toDataURL('image/jpeg', calidad));
            };
            img.src = lector.result;
        };
        lector.readAsDataURL(file);
    });
}

/* ==========================================
   VALIDACIÓN VISUAL DE EVIDENCIA POR IA
========================================== */
async function validarImagenConIA(file, imagenBase64 = null) {
    if (!file) return { valida: true, motivo: '' };

    if (!file.type || !file.type.startsWith('image/')) {
        return { valida: false, motivo: "El archivo seleccionado no es una imagen válida." };
    }

    if (!supabaseClient) return { valida: true, motivo: '' };

    try {
        const base64 = imagenBase64 || await convertirYComprimirImagenABase64(file);
        const { data, error } = await Promise.race([
            supabaseClient.functions.invoke('validar-imagen', { body: { imagen: base64 } }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Tiempo de espera agotado")), 8000))
        ]);

        if (error) throw error;

        if (data && data.valida === false) {
            return {
                valida: false,
                motivo: data.motivo || "La imagen no corresponde a una evidencia válida del reporte."
            };
        }
        return { valida: true, motivo: '' };
    } catch (err) {
        console.warn("Validación por IA no disponible, se continúa con el envío:", err);
        return { valida: true, motivo: '' };
    }
}

function mostrarFotoSeleccionada(sufijo, origen) {
    const inputGaleria = document.getElementById('foto' + sufijo);
    const inputCamara = document.getElementById('foto' + sufijo + 'Camara');
    const texto = document.getElementById('txtFoto' + sufijo);

    const elegido = (origen === 'camara') ? inputCamara : inputGaleria;
    const otro = (origen === 'camara') ? inputGaleria : inputCamara;

    if (otro) otro.value = '';

    const archivo = elegido?.files?.[0];
    if (texto) {
        texto.textContent = archivo
            ? `${origen === 'camara' ? '📷 Foto tomada' : '🖼️ Imagen de galería'}: ${archivo.name}`
            : 'Ninguna foto seleccionada.';
    }
}

function reiniciarTextosFotos() {
    ['Retirar', 'Abandonados', 'ViolenciaAnimal'].forEach(sufijo => {
        const texto = document.getElementById('txtFoto' + sufijo);
        if (texto) texto.textContent = 'Ninguna foto seleccionada.';
    });
}

async function prepararFotoReporte(fileInput) {
    const inputCamara = fileInput ? document.getElementById(fileInput.id + 'Camara') : null;
    const archivo = fileInput?.files?.[0] || inputCamara?.files?.[0];
    if (!archivo) return { valida: true, fotoUrl: null };

    const fotoComprimida = await convertirYComprimirImagenABase64(archivo);
    const resultadoIA = await validarImagenConIA(archivo, fotoComprimida);

    if (!resultadoIA.valida) {
        alert("La imagen no fue aceptada: " + resultadoIA.motivo);
        return { valida: false, fotoUrl: null };
    }
    return { valida: true, fotoUrl: fotoComprimida };
}

/* ==========================================
   VERIFICACIÓN DE LISTA NEGRA (USUARIOS BLOQUEADOS)
========================================== */
async function verificarUsuarioBloqueado(email) {
    if (!supabaseClient || !email) return false;

    try {
        const { data, error } = await supabaseClient
            .from('usuarios_bloqueados')
            .select('email')
            .eq('email', email)
            .limit(1);

        if (error) throw error;
        return Array.isArray(data) && data.length > 0;
    } catch (err) {
        console.warn("No se pudo verificar la lista de usuarios bloqueados:", err);
        return false;
    }
}

/* ==========================================
   CARGAR Y NAVEGAR REPORTES
========================================== */
async function cargarReportes() {
    const contenedor = document.getElementById('listaReportes');
    if (!contenedor || !supabaseClient) return;

    try {
        const camposBase = 'id, created_at, codigo, nombre_reporte, estado, usuario_email';
        const [resRetiro, resAbandonados, resViolencia, resCiudadania] = await Promise.all([
            supabaseClient.from('reportes_retiro').select(`${camposBase}, tipo_residuo`).order('created_at', { ascending: false }).limit(limiteReportesListado),
            supabaseClient.from('reportes_abandonados').select(`${camposBase}, tipo_afectacion, lugar_direccion`).order('created_at', { ascending: false }).limit(limiteReportesListado),
            supabaseClient.from('reportes_violencia_animal').select(`${camposBase}, tipo_situacion, lugar_direccion`).order('created_at', { ascending: false }).limit(limiteReportesListado),
            supabaseClient.from('reportes_ciudadania').select(`${camposBase}, tipo_propuesta`).order('created_at', { ascending: false }).limit(limiteReportesListado)
        ]);

        const dataRetiro = (resRetiro.data || []).map(r => ({ ...r, origenTabla: 'reportes_retiro', categoriaNombre: 'Retirar Residuo', icono: '♻️' }));
        const dataAbandonados = (resAbandonados.data || []).map(r => ({ ...r, origenTabla: 'reportes_abandonados', categoriaNombre: 'Problemas de la ciudad', icono: '🗑️' }));
        const dataViolencia = (resViolencia.data || []).map(r => ({ ...r, origenTabla: 'reportes_violencia_animal', categoriaNombre: 'Violencia Animal', icono: '🐾' }));
        const dataCiudadania = (resCiudadania.data || []).map(r => ({ ...r, origenTabla: 'reportes_ciudadania', categoriaNombre: 'Ciudadanía Activa', icono: '💡' }));

        const todosLosReportes = [...dataRetiro, ...dataAbandonados, ...dataViolencia, ...dataCiudadania].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (todosLosReportes.length === 0) {
            contenedor.innerHTML = `
                <div class="empty" style="text-align:center; padding: 40px; color:#666;">
                    <div style="font-size: 40px; margin-bottom: 10px;">📋</div>
                    <h3>No hay reportes registrados todavía</h3>
                </div>
            `;
            return;
        }

        window.cacheReportesLocales = todosLosReportes;

        const hayMasReportes = [resRetiro, resAbandonados, resViolencia, resCiudadania]
            .some(res => (res.data || []).length >= limiteReportesListado);
        const botonVerMas = hayMasReportes ? `
            <div style="text-align:center; padding:16px;">
                <button type="button" class="secondary-btn" onclick="cargarMasReportes()">Ver más reportes</button>
            </div>
        ` : '';

        let miEmail = '';
        try {
            const uStr = localStorage.getItem('usuarioLogueado');
            if (uStr) {
                const uObj = JSON.parse(uStr);
                miEmail = (uObj.email || '').trim().toLowerCase();
            }
        } catch (e) {}

        contenedor.innerHTML = todosLosReportes.map((rep) => {
            const idGenerado = rep.codigo ? `#${rep.codigo}` : `#${rep.id}`;
            const tituloResumen = rep.nombre_reporte || rep.tipo_residuo || rep.tipo_afectacion || rep.tipo_situacion || rep.tipo_propuesta || 'Incidencia reportada';
            const direccionTexto = rep.lugar_direccion || 'Bucaramanga, Santander';
            
            let estadoTexto = rep.estado || 'pendiente';
            let estadoIcono = '⏳';
            let colorEstado = '#ef6c00'; 
            
            if (estadoTexto.toLowerCase() === 'cancelada') {
                estadoIcono = '✕';
                colorEstado = '#c62828';
            } else if (estadoTexto.toLowerCase() === 'en progreso' || estadoTexto.toLowerCase() === 'resuelto') {
                estadoIcono = '✓';
                colorEstado = '#2e7d32';
            }

            const emailRep = (rep.usuario_email || '').trim().toLowerCase();
            const esPropio = (miEmail && emailRep && miEmail === emailRep);
            const etiquetaCreador = esPropio ? '👤 Creada por ti' : '👥 Creada por otros';
            const colorCreador = esPropio ? '#2e7d32' : '#666';

            const imagenHtml = rep.foto_url ? `
                <div style="width:60px; height:60px; border-radius:8px; overflow:hidden; flex-shrink:0; background:#eee;">
                    <img src="${rep.foto_url}" style="width:100%; height:100%; object-fit:cover;" alt="Foto reporte">
                </div>
            ` : `
                <div style="font-size:24px; background:#f0f4f8; padding:8px; border-radius:8px; min-width:40px; height:40px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    ${rep.icono || '📌'}
                </div>
            `;

            return `
                <div class="reporte-card" onclick="abrirDetalleSolicitud('${rep.id}', '${rep.origenTabla}')" style="background:#fff; padding:16px; border-bottom: 1px solid #eee; display:flex; gap:12px; align-items:flex-start; cursor:pointer;">
                    ${imagenHtml}
                    <div style="flex:1;">
                        <h4 style="font-size:15px; color:#111; margin:0 0 4px 0; font-weight:600;">${tituloResumen}</h4>
                        <p style="margin:0 0 4px 0; font-size:13px; color:#555;">${direccionTexto}</p>
                        <p style="margin:0 0 8px 0; font-size:13px; color:#333; font-weight:500;">ID ${idGenerado}</p>
                        
                        <div style="display:flex; gap:15px; font-size:12px; color:#666; align-items:center; flex-wrap:wrap;">
                            <span style="display:flex; align-items:center; gap:4px;">
                                <span>${rep.categoriaNombre}</span>
                            </span>
                            <span style="color: ${colorEstado}; font-weight:600; display:flex; align-items:center; gap:3px;">
                                ${estadoIcono} ${estadoTexto.charAt(0).toUpperCase() + estadoTexto.slice(1)}
                            </span>
                            <span style="color:${colorCreador}; font-weight:600;">
                                ${etiquetaCreador}
                            </span>
                        </div>
                    </div>
                </div>
            `;
        }).join('') + botonVerMas;
    } catch (err) {
        console.error("Error al cargar reportes:", err);
    }
}

function cargarMasReportes() {
    limiteReportesListado += LIMITE_REPORTES_INICIAL;
    cargarReportes();
}

function enviarMensajesAutomaticosReporte(idCreado, tablaOrigen, categoriaReporte) {
    const fechaHora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msg1 = `Desde la Alcaldía de Bucaramanga / Ciudad Limpia hemos recibido tu Aviso sobre ${categoriaReporte}.\n\nTe iremos informando de las novedades durante su gestión.👏`;
    const msg2 = `Tu aviso está siendo revisado y valorado por nuestro equipo técnico.`;

    supabaseClient.from('chat_reportes').insert([
        { reporte_id: idCreado, tabla_origen: tablaOrigen, mensaje: msg1, emisor: 'institucion', hora: fechaHora },
        { reporte_id: idCreado, tabla_origen: tablaOrigen, mensaje: msg2, emisor: 'institucion', hora: fechaHora }
    ]).then(({ error }) => {
        if (error) console.warn("Error enviando mensajes automáticos:", error);
    }).catch(e => {
        console.warn("Error enviando mensajes automáticos:", e);
    });
}

/* ==========================================
   ENVIAR NUEVO REPORTE
========================================== */
async function enviarReporteSupabase(event, categoriaReporte) {
    event.preventDefault();

    if (!supabaseClient) {
        alert("No hay conexión con Supabase.");
        return;
    }

    let emailUsuario = '';
    try {
        const uStr = localStorage.getItem('usuarioLogueado');
        if (uStr) {
            const uObj = JSON.parse(uStr);
            emailUsuario = (uObj.email || '').trim().toLowerCase();
        }
    } catch (e) {}

    if (await verificarUsuarioBloqueado(emailUsuario)) {
        alert("Tu cuenta se encuentra bloqueada y no puede enviar reportes. Si crees que se trata de un error, comunícate con la Alcaldía.");
        return;
    }

    try {
        const codigoAuto = Math.floor(100000 + Math.random() * 900000);
        let idCreado = null;
        let tablaOrigen = '';

        if (categoriaReporte === 'Necesito retirar un residuo') {
            tablaOrigen = 'reportes_retiro';
            const nombreReporte = document.getElementById('nombreRetirar')?.value || '';
            const tipoResiduo = document.getElementById('subtipoRetirar')?.value || '';
            const municipioRetirar = document.getElementById('municipioRetirar')?.value || 'Bucaramanga';
            const latVal = document.getElementById('latRetirar')?.value || gpsLat;
            const lngVal = document.getElementById('lngRetirar')?.value || gpsLng;
            
            const fileInput = document.getElementById('fotoRetirar');
            const resultadoFoto = await prepararFotoReporte(fileInput);
            if (!resultadoFoto.valida) return;
            let fotoUrl = resultadoFoto.fotoUrl;

            const payloadRetiro = {
                codigo: codigoAuto,
                nombre_reporte: nombreReporte,
                tipo_residuo: tipoResiduo,
                municipio: municipioRetirar, 
                lat: latVal ? parseFloat(latVal) : null, 
                lng: lngVal ? parseFloat(lngVal) : null,
                latitud: latVal ? parseFloat(latVal) : null,
                longitud: lngVal ? parseFloat(lngVal) : null,
                foto_url: fotoUrl,
                usuario_email: emailUsuario,
                estado: 'pendiente'
            };

            const { data, error } = await supabaseClient.from('reportes_retiro').insert([payloadRetiro]).select();

            if (error) throw error;
            if (data && data.length > 0) idCreado = data[0].id;

        } else if (categoriaReporte === 'Reportar problemas de la ciudad') {
            tablaOrigen = 'reportes_abandonados';
            const nombreReporte = document.getElementById('nombreAbandonados')?.value || '';
            const tipoAfectacion = document.getElementById('subtipoAbandonados')?.value || '';
            const municipioAbandonados = document.getElementById('municipioAbandonados')?.value || 'Bucaramanga';
            const lugar = document.getElementById('lugarAbandonados')?.value || '';
            const cuando = document.getElementById('cuandoAbandonados')?.value || '';
            const recurrente = document.getElementById('recurrenteAbandonados')?.value || 'No';
            const latVal = document.getElementById('latAbandonados')?.value || gpsLat;
            const lngVal = document.getElementById('lngAbandonados')?.value || gpsLng;

            const fileInput = document.getElementById('fotoAbandonados');
            const resultadoFoto = await prepararFotoReporte(fileInput);
            if (!resultadoFoto.valida) return;
            let fotoUrl = resultadoFoto.fotoUrl;

            const payloadAbandonados = {
                codigo: codigoAuto,
                nombre_reporte: nombreReporte,
                tipo_afectacion: tipoAfectacion,
                municipio: municipioAbandonados, 
                lugar_direccion: lugar, 
                cuando_ocurre: cuando, 
                recurrente: recurrente,
                lat: latVal ? parseFloat(latVal) : null, 
                lng: lngVal ? parseFloat(lngVal) : null,
                latitud: latVal ? parseFloat(latVal) : null,
                longitud: lngVal ? parseFloat(lngVal) : null,
                foto_url: fotoUrl,
                usuario_email: emailUsuario,
                estado: 'pendiente'
            };

            const { data, error } = await supabaseClient.from('reportes_abandonados').insert([payloadAbandonados]).select();

            if (error) throw error;
            if (data && data.length > 0) idCreado = data[0].id;

        } else if (categoriaReporte === 'Violencia Animal') {
            tablaOrigen = 'reportes_violencia_animal';
            const nombreReporte = document.getElementById('nombreViolenciaAnimal')?.value || '';
            const tipoSituacion = document.getElementById('subtipoViolenciaAnimal')?.value || '';
            const municipioViolenciaAnimal = document.getElementById('municipioViolenciaAnimal')?.value || 'Bucaramanga';
            const lugar = document.getElementById('lugarViolenciaAnimal')?.value || '';
            const detalle = document.getElementById('detalleViolenciaAnimal')?.value || '';
            const latVal = document.getElementById('latViolenciaAnimal')?.value || gpsLat;
            const lngVal = document.getElementById('lngViolenciaAnimal')?.value || gpsLng;

            const fileInput = document.getElementById('fotoViolenciaAnimal');
            const resultadoFoto = await prepararFotoReporte(fileInput);
            if (!resultadoFoto.valida) return;
            let fotoUrl = resultadoFoto.fotoUrl;

            const payloadViolencia = {
                codigo: codigoAuto,
                nombre_reporte: nombreReporte,
                tipo_situacion: tipoSituacion,
                municipio: municipioViolenciaAnimal,
                lugar_direccion: lugar,
                detalle_situacion: detalle,
                lat: latVal ? parseFloat(latVal) : null,
                lng: lngVal ? parseFloat(lngVal) : null,
                latitud: latVal ? parseFloat(latVal) : null,
                longitud: lngVal ? parseFloat(lngVal) : null,
                foto_url: fotoUrl,
                usuario_email: emailUsuario,
                estado: 'pendiente'
            };

            const { data, error } = await supabaseClient.from('reportes_violencia_animal').insert([payloadViolencia]).select();

            if (error) throw error;
            if (data && data.length > 0) idCreado = data[0].id;

        } else if (categoriaReporte === 'Ciudadanía Activa') {
            tablaOrigen = 'reportes_ciudadania';
            const nombreReporte = document.getElementById('nombreCiudadania')?.value || '';
            const tipoPropuesta = document.getElementById('subtipoCiudadania')?.value || '';
            const detalle = document.getElementById('detalleCiudadania')?.value || '';

            const payloadCiudadania = {
                codigo: codigoAuto,
                nombre_reporte: nombreReporte,
                tipo_propuesta: tipoPropuesta, 
                detalle_propuesta: detalle,
                usuario_email: emailUsuario,
                estado: 'pendiente'
            };

            const { data, error } = await supabaseClient.from('reportes_ciudadania').insert([payloadCiudadania]).select();

            if (error) throw error;
            if (data && data.length > 0) idCreado = data[0].id;
        }

        if (idCreado) {
            enviarMensajesAutomaticosReporte(idCreado, tablaOrigen, categoriaReporte);
        }

        mostrarToast("¡Reporte enviado con éxito!");
        event.target.reset();
        reiniciarTextosFotos();

        if (idCreado) {
            abrirDetalleSolicitud(idCreado, tablaOrigen);
        } else {
            mostrarSeccion('mis-reportes', true);
        }

    } catch (err) {
        alert("Hubo un error al enviar el reporte: " + err.message);
    }
}

/* ==========================================
   DETALLE DE LA SOLICITUD Y CHAT
========================================== */
async function abrirDetalleSolicitud(id, tablaOrigen) {
    if (!supabaseClient) return;

    try {
        const { data, error } = await supabaseClient.from(tablaOrigen).select('*').eq('id', id).single();
        if (error || !data) throw new Error("No se pudo cargar el reporte.");

        reporteSeleccionadoActual = { ...data, tablaOrigen };

        mostrarSeccion('detalle-solicitud', true);

        let emailUsuarioActual = '';
        try {
            const uStr = localStorage.getItem('usuarioLogueado');
            if (uStr) {
                const uObj = JSON.parse(uStr);
                emailUsuarioActual = (uObj.email || '').trim().toLowerCase();
            }
        } catch (e) {}

        const emailReporte = (data.usuario_email || '').trim().toLowerCase();
        const esMiReporte = (emailUsuarioActual && emailReporte && emailUsuarioActual === emailReporte);

        const btnChatTab = document.getElementById('tabBtnChat');
        if (btnChatTab) {
            if (esMiReporte) {
                btnChatTab.style.display = 'inline-block';
            } else {
                btnChatTab.style.display = 'none';
            }
        }

        cambiarPestanaSolicitud('detalle');

        const codigoTexto = data.codigo ? `#${data.codigo}` : `#${data.id}`;
        document.getElementById('detNombre').textContent = data.nombre_reporte || data.tipo_residuo || data.tipo_afectacion || data.tipo_situacion || 'Aviso Registrado';
        document.getElementById('detReferencia').textContent = `Referencia del aviso: ${codigoTexto}`;
        document.getElementById('detDireccion').textContent = data.lugar_direccion || 'Bucaramanga, Santander';
        
        let estNombre = data.estado || 'pendiente';
        let estIcono = estNombre.toLowerCase() === 'resuelto' ? '✓' : (estNombre.toLowerCase() === 'cancelada' ? '✕' : '⏳');
        document.getElementById('detEstado').textContent = `${estIcono} ${estNombre.charAt(0).toUpperCase() + estNombre.slice(1)}`;
        
        document.getElementById('detCategoria').textContent = data.tipo_residuo || data.tipo_afectacion || data.tipo_situacion || data.tipo_propuesta || 'Gestión Urbana';
        document.getElementById('numApoyos').textContent = data.apoyos || 0;

        const f = new Date(data.created_at);
        document.getElementById('detFechaCreacion').textContent = `${f.getDate()} de ${f.toLocaleString('es-ES', { month: 'long' })} de ${f.getFullYear()} a las ${f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

        const contenedorFoto = document.getElementById('contenedorFotoAdjunta');
        const imgEvidencia = document.getElementById('imgEvidenciaReporte');
        if (data.foto_url) {
            imgEvidencia.src = data.foto_url;
            contenedorFoto.style.display = 'block';
        } else {
            contenedorFoto.style.display = 'none';
        }

        setTimeout(() => {
            let latVal = data.lat !== undefined && data.lat !== null ? data.lat : data.latitud;
            let lngVal = data.lng !== undefined && data.lng !== null ? data.lng : data.longitud;
            let coords = (latVal && lngVal) ? [latVal, lngVal] : [7.1254, -73.1198];

            if (!mapDetalle && window.L) {
                mapDetalle = L.map('mapaDetalleSolicitud').setView(coords, 15);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapDetalle);
            } else if (mapDetalle) {
                mapDetalle.setView(coords, 15);
            }
            mapDetalle.invalidateSize();
        }, 300);

        if (esMiReporte) {
            cargarMensajesChat();
        }

    } catch (err) {
        alert(err.message);
    }
}

function cambiarPestanaSolicitud(pestana) {
    const btnDetalle = document.getElementById('tabBtnDetalle');
    const btnChat = document.getElementById('tabBtnChat');
    const contentDetalle = document.getElementById('tabDetalleContent');
    const contentChat = document.getElementById('tabChatContent');

    if (pestana === 'detalle') {
        btnDetalle.classList.add('activo');
        if (btnChat) btnChat.classList.remove('activo');
        contentDetalle.classList.add('activo');
        contentChat.classList.remove('activo');
        if (mapDetalle) setTimeout(() => mapDetalle.invalidateSize(), 200);
    } else {
        if (btnChat) btnChat.classList.add('activo');
        btnDetalle.classList.remove('activo');
        contentChat.classList.add('activo');
        contentDetalle.classList.remove('activo');
        cargarMensajesChat();
    }
}

async function apoyarSolicitudActual() {
    if (!reporteSeleccionadoActual || !supabaseClient) return;

    try {
        const nuevosApoyos = (reporteSeleccionadoActual.apoyos || 0) + 1;
        const { error } = await supabaseClient
            .from(reporteSeleccionadoActual.tablaOrigen)
            .update({ apoyos: nuevosApoyos })
            .eq('id', reporteSeleccionadoActual.id);

        if (error) throw error;

        reporteSeleccionadoActual.apoyos = nuevosApoyos;
        document.getElementById('numApoyos').textContent = nuevosApoyos;
        mostrarToast("¡Gracias por apoyar esta solicitud comunitaria!");
    } catch (err) {
        alert("No se pudo registrar el apoyo: " + err.message);
    }
}

/* ==========================================
   CHAT Y MENSAJERÍA CON ALERTAS EN TIEMPO REAL
========================================== */
async function cargarMensajesChat() {
    if (!reporteSeleccionadoActual || !supabaseClient) return;

    const contenedor = document.getElementById('chatMensajesList');
    const fechaBadge = document.getElementById('chatFechaBadge');
    
    const fechaCreacion = new Date(reporteSeleccionadoActual.created_at);
    fechaBadge.textContent = fechaCreacion.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

    try {
        const { data, error } = await supabaseClient
            .from('chat_reportes')
            .select('*')
            .eq('reporte_id', reporteSeleccionadoActual.id)
            .order('created_at', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            contenedor.innerHTML = `<p style="text-align:center; color:#888; font-size:13px; margin-top:20px;">Sin mensajes aún.</p>`;
            return;
        }

        contenedor.innerHTML = data.map(m => {
            const esInstitucion = m.emisor === 'institucion';
            return `
                <div class="chat-bubble ${esInstitucion ? 'institucion' : 'usuario'}">
                    <p>${m.mensaje.replace(/\n/g, '<br>')}</p>
                    <span class="chat-hora">${m.hora || '12:00'}</span>
                </div>
            `;
        }).join('');

        contenedor.scrollTop = contenedor.scrollHeight;
    } catch (err) {
        console.error("Error al cargar chat:", err);
    }
}

async function enviarMensajeChat() {
    const input = document.getElementById('inputChatMensaje');
    const texto = input?.value?.trim();

    if (!texto || !reporteSeleccionadoActual || !supabaseClient) return;

    const horaAhora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    try {
        const { error } = await supabaseClient.from('chat_reportes').insert([
            {
                reporte_id: reporteSeleccionadoActual.id,
                tabla_origen: reporteSeleccionadoActual.tablaOrigen,
                mensaje: texto,
                emisor: 'usuario',
                hora: horaAhora
            }
        ]);

        if (error) throw error;

        input.value = '';
        cargarMensajesChat();
    } catch (err) {
        alert("Error al enviar mensaje: " + err.message);
    }
}

/* ==========================================
   ALERTAS Y NOTIFICACIONES MÓVILES (PUSH / LOCALES)
========================================== */
const CANAL_NOTIFICACIONES_ID = 'ciudad-limpia-alertas';
let canalNotificacionesCreado = false;

async function solicitarPermisoNotificaciones() {
    if (LocalNotifications) {
        try { 
            const perm = await LocalNotifications.requestPermissions();
            if (perm.display !== 'granted') {
                console.warn("Permiso de notificaciones locales no concedido en dispositivo nativo.");
            }
        } catch (e) {
            console.warn("Error al solicitar permisos locales de Capacitor:", e);
        }

        try {
            await LocalNotifications.createChannel({
                id: CANAL_NOTIFICACIONES_ID,
                name: 'Alertas Ciudad Limpia',
                description: 'Avisos sobre tus reportes y mensajes de la administración',
                importance: 5,
                visibility: 1,
                vibration: true
            });
            canalNotificacionesCreado = true;
        } catch (e) {
            console.warn("No se pudo crear el canal de notificaciones:", e);
        }
    } else if ("Notification" in window) {
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            try {
                await Notification.requestPermission();
            } catch (e) {}
        }
    }
}

function dispararNotificacionMovil(titulo, mensaje) {
    if (pushActivo && document.visibilityState === 'hidden') return;

    if (LocalNotifications) {
        try {
            LocalNotifications.schedule({
                notifications: [{
                    title: titulo,
                    body: mensaje,
                    id: Math.floor(Math.random() * 100000),
                    ...(canalNotificacionesCreado ? { channelId: CANAL_NOTIFICACIONES_ID } : {})
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

/* ==========================================
   NOTIFICACIONES PUSH (FCM): app cerrada o en segundo plano
========================================== */
async function registrarNotificacionesPush() {
    if (!PushNotifications || !supabaseClient) return;      
    const usuarioStr = localStorage.getItem('usuarioLogueado');
    if (!usuarioStr) return;   

    let emailUsuario = '';
    try {
        const uObj = JSON.parse(usuarioStr);
        emailUsuario = (uObj.email || '').trim().toLowerCase();
    } catch (e) {}

    try {
        await PushNotifications.removeAllListeners();

        await PushNotifications.addListener('registration', async (token) => {
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

        await PushNotifications.addListener('registrationError', (err) => {
            pushActivo = false;
            console.warn("Error de registro push:", err);
        });

        await PushNotifications.addListener('pushNotificationReceived', () => {});

        // Al tocar la notificación se abre el reporte correspondiente y directamente su chat
        await PushNotifications.addListener('pushNotificationActionPerformed', (accion) => {
            const datos = accion?.notification?.data || {};
            if (datos.reporte_id && datos.tabla_origen) {
                abrirDetalleSolicitud(datos.reporte_id, datos.tabla_origen);
                setTimeout(() => {
                    cambiarPestanaSolicitud('chat');
                }, 350);
            }
        });

        let permiso = await PushNotifications.checkPermissions();
        if (permiso.receive === 'prompt' || permiso.receive === 'prompt-with-rationale') {
            permiso = await PushNotifications.requestPermissions();
        }
        if (permiso.receive !== 'granted') {
            console.warn("Permiso de notificaciones push no concedido.");
            return;
        }

        try {
            await PushNotifications.createChannel({
                id: CANAL_NOTIFICACIONES_ID,
                name: 'Alertas Ciudad Limpia',
                description: 'Avisos sobre tus reportes y mensajes de la administración',
                importance: 5,
                visibility: 1,
                vibration: true
            });
        } catch (e) {}

        await PushNotifications.register();
    } catch (e) {
        console.warn("No se pudieron activar las notificaciones push:", e);
    }
}

async function desregistrarTokenPush() {
    const token = localStorage.getItem('pushTokenActual');
    if (!token || !supabaseClient) return;

    try {
        await supabaseClient.rpc('eliminar_token_push', { p_token: token });
    } catch (e) {}

    localStorage.removeItem('pushTokenActual');
    pushActivo = false;
}

async function cargarEstadosBaseReportes(emailUsuario) {
    if (!supabaseClient || !emailUsuario) return;

    const tablas = ['reportes_retiro', 'reportes_abandonados', 'reportes_violencia_animal', 'reportes_ciudadania'];
    try {
        const resultados = await Promise.all(tablas.map(tabla =>
            supabaseClient.from(tabla).select('id, estado').eq('usuario_email', emailUsuario)
        ));
        resultados.forEach((res, i) => {
            (res.data || []).forEach(r => {
                ultimoEstadoReportes[`${tablas[i]}:${r.id}`] = (r.estado || 'pendiente').toLowerCase();
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

function escucharAlertasGeneralesYChat() {
    if (!supabaseClient) return;

    let miEmailUsuario = '';
    try {
        const uStr = localStorage.getItem('usuarioLogueado');
        if (uStr) {
            const uObj = JSON.parse(uStr);
            miEmailUsuario = (uObj.email || '').trim().toLowerCase();
        }
    } catch (e) {}

    cargarEstadosBaseReportes(miEmailUsuario);

    supabaseClient
        .channel('canal-chat-ciudadano-push')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_reportes' }, async payload => {
            const mensajeNuevo = payload.new;
            if (!mensajeNuevo || mensajeNuevo.emisor !== 'institucion') return;

            const esMio = await reporteEsDelUsuario(mensajeNuevo.tabla_origen, mensajeNuevo.reporte_id, miEmailUsuario);
            if (!esMio) return;

            dispararNotificacionMovil("Ciudad Limpia - Respuesta Oficial", mensajeNuevo.mensaje);
            mostrarToast("¡Tienes nueva respuesta de la administración en tu chat!");

            if (reporteSeleccionadoActual && String(reporteSeleccionadoActual.id) === String(mensajeNuevo.reporte_id)) {
                cargarMensajesChat();
            }
        })
        .subscribe();

    const tablasReportes = ['reportes_retiro', 'reportes_abandonados', 'reportes_violencia_animal', 'reportes_ciudadania'];
    tablasReportes.forEach(tabla => {
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

                const nuevoEstadoTexto = nuevoEstado.toUpperCase();
                const tituloNotif = `Actualización de Reporte #${reporteActualizado.codigo || reporteActualizado.id}`;
                const mensajeNotif = `Tu reporte cambió de estado a: ${nuevoEstadoTexto}`;

                dispararNotificacionMovil(tituloNotif, mensajeNotif);
                mostrarToast(`📢 ${mensajeNotif}`);

                const detalleVisible = document.getElementById('detalle-solicitud')?.classList.contains('activa');
                if (detalleVisible && reporteSeleccionadoActual && String(reporteSeleccionadoActual.id) === String(reporteActualizado.id)) {
                    abrirDetalleSolicitud(reporteActualizado.id, tabla);
                }
            })
            .subscribe();
    });

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

function mostrarToast(mensaje) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    const p = toast.querySelector('p');
    if (p) p.textContent = mensaje;
    toast.classList.add('activo');
    setTimeout(() => {
        toast.classList.remove('activo');
    }, 4000);
}

/* ==========================================
   AUTENTICACIÓN SUPABASE
========================================== */
window.iniciarSesionSupabase = async function(email, password) {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) { alert("Error al iniciar sesión: " + error.message); return; }

        const userInfo = { id: data.user.id, nombre: data.user.user_metadata?.nombre || data.user.email, email: data.user.email };
        localStorage.setItem('usuarioLogueado', JSON.stringify(userInfo));
        window.location.href = "index.html";
    } catch (err) { alert("Ocurrió un error inesperado."); }
};

window.registrarUsuarioSupabase = async function(nombre, email, password) {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.auth.signUp({ email, password, options: { data: { nombre } } });
        if (error) { alert("Error en el registro: " + error.message); return; }
        
        if (data && data.user) {
            await supabaseClient.from('usuarios_registrados').insert([{
                id: data.user.id,
                email: email,
                nombre: nombre,
                edad: null,
                barrio: null
            }]);
        }

        alert("¡Cuenta creada con éxito! Revisa tu correo electrónico para confirmar tu cuenta.");
        if (typeof cambiarVista === 'function') cambiarVista('vistaLogin');
    } catch (err) { alert("Error inesperado en el registro."); }
};

window.recuperarPasswordSupabase = async function(email) {
    if (!supabaseClient) return;
    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/login.html' });
        if (error) { alert("Error: " + error.message); return; }
        alert("¡Correo de recuperación enviado!");
    } catch (err) { alert("Error inesperado."); }
};
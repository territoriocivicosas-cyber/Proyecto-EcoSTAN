/* ==========================================
   modules/map_routing/map.js
   Georreferenciación: GPS, municipio por coordenadas, mapa de inicio con reportes
   agrupados, mapas de los formularios, mapa del detalle y rutas del camión.
========================================== */
import { supabaseClient } from '../../core/supabaseClient.js';
import { datosUsuarioApp } from '../../core/authService.js';
import { plugins, estado, escaparHtml, normalizarTexto, fechaLocalISO, mostrarToast, escuchar, EVENTOS } from '../../core/utils.js';
import { alEntrarEnSeccion } from '../../core/navigation.js';
import { plantillaAppAlerta, novedadExiste, dispararNotificacionMovil } from '../../core/notifications.js';

/* ==========================================
   MAPA BASE
   Por defecto usa OpenStreetMap (sin llave). Para un proveedor profesional, escribe aquí tu llave de MapTiler.
========================================== */
const MAPTILER_KEY = '';
const URL_MAPA_BASE = MAPTILER_KEY
    ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`
    : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OPCIONES_MAPA_BASE = { maxZoom: 19, attribution: MAPTILER_KEY ? '© MapTiler © OpenStreetMap' : '© OpenStreetMap' };
const CENTRO_POR_DEFECTO = [7.1254, -73.1198];   // Bucaramanga

const nuevoMapa = (contenedor, centro, zoom) => {
    const mapa = L.map(contenedor).setView(centro, zoom);
    L.tileLayer(URL_MAPA_BASE, OPCIONES_MAPA_BASE).addTo(mapa);
    return mapa;
};

/* ==========================================
   MUNICIPIO AUTOMÁTICO POR GPS
   Se obtiene con los límites administrativos de OpenStreetMap (Nominatim).
   El usuario ya no elige el municipio: se guarda según las coordenadas.
========================================== */
export const MUNICIPIO_NO_DETERMINADO = 'Sin determinar';
const MUNICIPIOS_AREA = ['Bucaramanga', 'Floridablanca', 'Girón', 'Piedecuesta'];
const cacheMunicipios = {};
const temporizadoresMunicipio = {};

// Convierte cualquier variante ("Perímetro Urbano Bucaramanga", "Municipio de Girón", "giron") al nombre oficial
export function canonizarMunicipio(nombre) {
    const limpio = String(nombre || '').replace(/^(municipio de|per[ií]metro urbano)\s+/i, '').trim();
    if (!limpio) return '';
    const n = String(nombre).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const oficial = MUNICIPIOS_AREA.find(m => n.includes(m.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));
    return oficial || limpio;
}

async function detectarMunicipioPorGPS(lat, lng) {
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    if (isNaN(latN) || isNaN(lngN)) return null;

    const clave = `${latN.toFixed(4)},${lngN.toFixed(4)}`;
    if (cacheMunicipios[clave]) return cacheMunicipios[clave];

    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 5000);

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latN}&lon=${lngN}&zoom=10&addressdetails=1&accept-language=es`;
        const respuesta = await fetch(url, { signal: controlador.signal });
        if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);

        const json = await respuesta.json();
        const a = json.address || {};
        let nombre = a.city || a.town || a.municipality || a.village || a.county || '';
        nombre = canonizarMunicipio(nombre);

        if (!nombre) return null;
        cacheMunicipios[clave] = nombre;
        return nombre;
    } catch (e) {
        console.warn("No se pudo detectar el municipio por GPS:", e);
        return null;
    } finally {
        clearTimeout(temporizador);
    }
}

export async function resolverMunicipio(lat, lng) {
    return (await detectarMunicipioPorGPS(lat, lng)) || canonizarMunicipio(datosUsuarioApp().municipio) || MUNICIPIO_NO_DETERMINADO;
}

/* ==========================================
   MAPAS DE LOS FORMULARIOS (retirar, abandonados, violencia animal, reciclaje)
   Una sola configuración: los ids del HTML siguen el patrón <prefijo><Sufijo>.
========================================== */
const FORMULARIOS_MAPA = {
    retirar:         { sufijo: 'Retirar',         seccion: 'reporte-retirar-residuo' },
    abandonados:     { sufijo: 'Abandonados',     seccion: 'reporte-residuos-abandonados' },
    violenciaAnimal: { sufijo: 'ViolenciaAnimal', seccion: 'reporte-violencia-animal' },
    reciclaje:       { sufijo: 'Reciclaje',       seccion: 'reporte-reciclaje-ciclogo' }
};
const idsFormulario = tipo => {
    const s = FORMULARIOS_MAPA[tipo].sufijo;
    return { contenedor: `mapa${s}GPS`, lat: `lat${s}`, lng: `lng${s}`, txtGps: `txtGps${s}`, txtMunicipio: `txtMunicipio${s}` };
};
const mapasFormulario = {};                 // tipo -> { mapa, marcador }
let ubicacionReciclajeFijada = false;       // true cuando el usuario confirmó su ubicación (GPS o punto en el mapa)

export const ubicacionReciclajeConfirmada = () => ubicacionReciclajeFijada;

// Coordenadas del formulario; si el campo está vacío, usa el último GPS conocido
export function leerUbicacionFormulario(tipo) {
    const ids = idsFormulario(tipo);
    return {
        lat: document.getElementById(ids.lat)?.value || estado.gpsLat,
        lng: document.getElementById(ids.lng)?.value || estado.gpsLng
    };
}

function mostrarMunicipioDetectado(tipo, lat, lng) {
    const etiqueta = document.getElementById(idsFormulario(tipo).txtMunicipio);

    clearTimeout(temporizadoresMunicipio[tipo]);
    temporizadoresMunicipio[tipo] = setTimeout(async () => {
        const municipio = await detectarMunicipioPorGPS(lat, lng);
        if (etiqueta) {
            etiqueta.textContent = municipio
                ? `Municipio detectado: ${municipio}`
                : 'El municipio se detectará al enviar el reporte.';
        }
    }, 700);
}

function actualizarCamposCoordenadas(tipo, lat, lng) {
    const ids = idsFormulario(tipo);
    const latInput = document.getElementById(ids.lat);
    const lngInput = document.getElementById(ids.lng);
    const txtInfo = document.getElementById(ids.txtGps);

    if (latInput) latInput.value = lat;
    if (lngInput) lngInput.value = lng;
    if (txtInfo) txtInfo.textContent = `Coordenadas fijadas: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    mostrarMunicipioDetectado(tipo, lat, lng);
}

// El usuario fijó el punto (arrastrando, tocando el mapa o con el GPS): para reciclaje cuenta como ubicación confirmada
function fijarUbicacion(tipo, lat, lng) {
    if (tipo === 'reciclaje') ubicacionReciclajeFijada = true;
    actualizarCamposCoordenadas(tipo, lat, lng);
}

export function inicializarMapaFormulario(tipo) {
    const ids = idsFormulario(tipo);
    const contenedor = document.getElementById(ids.contenedor);
    if (!contenedor || !window.L) return;

    const centroInicial = (estado.gpsLat && estado.gpsLng) ? [estado.gpsLat, estado.gpsLng] : CENTRO_POR_DEFECTO;

    if (!mapasFormulario[tipo]) {
        const mapa = nuevoMapa(ids.contenedor, centroInicial, 15);
        const marcador = L.marker(centroInicial, { draggable: true }).addTo(mapa);
        marcador.on('dragend', () => {
            const pos = marcador.getLatLng();
            fijarUbicacion(tipo, pos.lat, pos.lng);
        });
        mapa.on('click', (e) => {
            marcador.setLatLng(e.latlng);
            fijarUbicacion(tipo, e.latlng.lat, e.latlng.lng);
        });
        mapasFormulario[tipo] = { mapa, marcador };
    }
    mapasFormulario[tipo].mapa.invalidateSize();

    // Solo cuenta como ubicación confirmada si el centro inicial viene de un GPS real (no del centro por defecto)
    if (tipo === 'reciclaje') ubicacionReciclajeFijada = !!(estado.gpsLat && estado.gpsLng);
    actualizarCamposCoordenadas(tipo, centroInicial[0], centroInicial[1]);
}

const ERROR_GPS = "No se pudo obtener tu ubicación GPS actual.";

export function obtenerUbicacionActual(tipo) {
    const aplicarUbicacion = (lat, lng) => {
        estado.gpsLat = lat;
        estado.gpsLng = lng;
        const m = mapasFormulario[tipo];
        if (m) {
            m.mapa.setView([lat, lng], 16);
            m.marcador.setLatLng([lat, lng]);
            fijarUbicacion(tipo, lat, lng);
        }
        mostrarToast("¡Ubicación GPS obtenida y aplicada!");
    };
    const viaNavegador = () => navigator.geolocation.getCurrentPosition(
        pos => aplicarUbicacion(pos.coords.latitude, pos.coords.longitude),
        () => alert(ERROR_GPS),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    if (plugins.Geolocation) {
        plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })
            .then(pos => aplicarUbicacion(pos.coords.latitude, pos.coords.longitude))
            .catch(viaNavegador);
    } else if (navigator.geolocation) {
        viaNavegador();
    } else {
        alert("Tu dispositivo no soporta geolocalización.");
    }
}

export function activarSeleccionManual(tipo) {
    const m = mapasFormulario[tipo];
    if (m) {
        m.mapa.invalidateSize();
        mostrarToast("Modo manual activo: Toca el mapa o arrastra el marcador para fijar la ubicación.");
        const elementoMapa = document.getElementById(idsFormulario(tipo).contenedor);
        if (elementoMapa) {
            elementoMapa.style.border = '2px solid #2e7d32';
            setTimeout(() => { elementoMapa.style.border = '1px solid var(--borde)'; }, 1500);
        }
    } else {
        inicializarMapaFormulario(tipo);
        mostrarToast("Mapa activado para seleccionar ubicación manual.");
    }
}

/* ==========================================
   MAPA DEL DETALLE DE UNA SOLICITUD
========================================== */
let mapDetalle = null;

export function mostrarMapaDetalle(lat, lng) {
    setTimeout(() => {
        const coords = (lat && lng) ? [lat, lng] : CENTRO_POR_DEFECTO;
        if (!mapDetalle && window.L) mapDetalle = nuevoMapa('mapaDetalleSolicitud', coords, 15);
        else if (mapDetalle) mapDetalle.setView(coords, 15);
        if (mapDetalle) mapDetalle.invalidateSize();
    }, 300);
}

export function refrescarMapaDetalle() {
    if (mapDetalle) setTimeout(() => mapDetalle.invalidateSize(), 200);
}

/* ==========================================
   GPS DEL DISPOSITIVO
========================================== */
let mapInstance = null;

function aplicarGPS(position) {
    estado.gpsLat = position.coords.latitude;
    estado.gpsLng = position.coords.longitude;
    if (mapInstance && window.L) mapInstance.setView([estado.gpsLat, estado.gpsLng], 15);
}

function fallbackNavegadorGPS(resolve) {
    if (!navigator.geolocation) { resolve(false); return; }
    navigator.geolocation.getCurrentPosition(
        position => { aplicarGPS(position); resolve(true); },
        () => resolve(false),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

// GPS nativo móvil; si falla, usa el del navegador
export function obtenerUbicacionGPS() {
    return new Promise(resolve => {
        if (plugins.Geolocation) {
            plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })
                .then(position => { aplicarGPS(position); resolve(true); })
                .catch(() => fallbackNavegadorGPS(resolve));
        } else {
            fallbackNavegadorGPS(resolve);
        }
    });
}

/* ==========================================
   MAPA DE INICIO: reportes agrupados por zona
   Alejado: círculos con el número de reportes de la zona.
   Cercano (zoom 17+): cada reporte en su ubicación exacta con su ícono.
========================================== */
let capaReportesMapa = null;
let ultimaCargaMapaInicio = 0;

const TIPOS_MAPA = {
    reportes_reciclaje: { icono: '♻️', clase: 'pin-reciclaje', etiqueta: 'Entrega a recicladores', campo: 'tipo_residuo' },
    reportes_retiro: { icono: '🚛', clase: 'pin-retiro', etiqueta: 'Gestión de residuos', campo: 'tipo_residuo' },
    reportes_abandonados: { icono: '🗑️', clase: 'pin-abandonado', etiqueta: 'Problemas de la ciudad', campo: 'tipo_afectacion' },
    reportes_violencia_animal: { icono: '🐾', clase: 'pin-animal', etiqueta: 'Maltrato animal', campo: 'tipo_situacion' }
};

function inicializarMapa() {
    const contenedorMapa = document.getElementById('mapa-container');
    if (contenedorMapa && !contenedorMapa._leaflet_id && window.L) {
        mapInstance = nuevoMapa('mapa-container', CENTRO_POR_DEFECTO, 12);

        const leyenda = L.control({ position: 'bottomleft' });
        leyenda.onAdd = () => {
            const div = L.DomUtil.create('div', 'leyenda-mapa');
            div.innerHTML = Object.values(TIPOS_MAPA).map(t => `<div>${t.icono} ${t.etiqueta}</div>`).join('') +
                '<div id="leyendaMapaTotal" class="leyenda-total"></div>';
            return div;
        };
        leyenda.addTo(mapInstance);
        cargarReportesMapaInicio(true);
    }
}

async function cargarReportesMapaInicio(forzar) {
    if (!mapInstance || !window.L || !supabaseClient) return;
    if (!forzar && Date.now() - ultimaCargaMapaInicio < 20000) return;
    ultimaCargaMapaInicio = Date.now();
    try {
        const tipos = Object.entries(TIPOS_MAPA);
        const res = await Promise.all(tipos.map(([tabla, t]) =>
            supabaseClient.from(tabla).select(`id, latitud, longitud, estado, created_at, nombre_reporte, ${t.campo}`)
                .order('created_at', { ascending: false }).limit(500)));

        if (capaReportesMapa) mapInstance.removeLayer(capaReportesMapa);
        capaReportesMapa = L.markerClusterGroup ? L.markerClusterGroup({
            maxClusterRadius: 70,
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true,
            disableClusteringAtZoom: 17,
            iconCreateFunction: (cluster) => {
                const n = cluster.getChildCount();
                const nivel = n < 10 ? 'peq' : (n < 50 ? 'med' : 'gra');
                return L.divIcon({ html: `<div><span>${n}</span></div>`, className: `cluster-reporte cluster-${nivel}`, iconSize: L.point(44, 44) });
            }
        }) : L.layerGroup();

        let total = 0;
        res.forEach((r, i) => {
            const t = tipos[i][1];
            (r.data || []).forEach(rep => {
                const lat = parseFloat(rep.latitud), lng = parseFloat(rep.longitud);
                if (isNaN(lat) || isNaN(lng) || rep.estado === 'cancelada') return;
                const resuelto = rep.estado === 'resuelto';
                const icono = L.divIcon({
                    className: '',
                    html: `<div class="pin-reporte ${t.clase}${resuelto ? ' pin-resuelto' : ''}"><span>${t.icono}</span></div>`,
                    iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18]
                });
                const titulo = escaparHtml(rep[t.campo] || rep.nombre_reporte || t.etiqueta);
                const estado = escaparHtml(String(rep.estado || 'pendiente').replace('_', ' '));
                const fecha = rep.created_at ? new Date(rep.created_at).toLocaleDateString() : '';
                L.marker([lat, lng], { icon: icono })
                    .bindPopup(`<strong>${t.icono} ${titulo}</strong><br><small>${t.etiqueta}<br>Estado: ${estado}<br>${fecha}</small>`)
                    .addTo(capaReportesMapa);
                total++;
            });
        });
        capaReportesMapa.addTo(mapInstance);
        const info = document.getElementById('leyendaMapaTotal');
        if (info) info.textContent = `${total} reporte(s) en el mapa`;
    } catch (e) {
        console.warn("No se pudieron cargar los reportes del mapa:", e);
    }
}

/* ==========================================
   RUTAS DE RECOLECCIÓN Y RECORDATORIO DEL CAMIÓN
========================================== */
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const ETIQUETAS_ESTADO_RUTA = { programada: 'Programada', en_curso: 'En curso', completada: 'Completada', incumplida: 'Incumplida', suspendida: 'Suspendida' };
let rutasCiudadano = [];
let miBarrioRuta = '', miMunicipioRuta = '';
let buscadorRutasActivo = false;

const rutaEsMia = r => miBarrioRuta && normalizarTexto(r.barrio) === normalizarTexto(miBarrioRuta) &&
    (!miMunicipioRuta || normalizarTexto(r.municipio) === normalizarTexto(miMunicipioRuta));

function renderizarListaRutas() {
    const cont = document.getElementById('listaRutas');
    if (!cont) return;
    const filtro = normalizarTexto(document.getElementById('buscarRuta')?.value);
    const lista = rutasCiudadano
        .filter(r => !filtro || normalizarTexto(`${r.barrio} ${r.municipio} ${r.tipo_servicio}`).includes(filtro))
        .sort((x, y) => (rutaEsMia(y) ? 1 : 0) - (rutaEsMia(x) ? 1 : 0));

    const faltaPerfil = datosUsuarioApp().email && (!miBarrioRuta || !miMunicipioRuta)
        ? '<p class="aviso-vacio">Completa tu municipio y barrio en "Datos personales" para recibir el aviso cuando el camión pase por tu sector.</p>' : '';

    cont.innerHTML = faltaPerfil + (lista.length ? lista.map(r => `
        <div class="route${rutaEsMia(r) ? ' mi-sector' : ''}">
            <div class="route-icon">🚛</div>
            <div>
                <h3>${escaparHtml(r.barrio)} <small>${escaparHtml(r.municipio)}</small></h3>
                <p>${escaparHtml(r.tipo_servicio || 'Recolección de residuos')}</p>
                <strong>${escaparHtml(String(r.dia_semana || '').split(',').map(d => d.trim()).filter(Boolean).join(' - '))}</strong>
                ${r.hora_estimada ? `<p>🕒 ${escaparHtml(r.hora_estimada)}</p>` : ''}
            </div>
            <span class="route-status estado-${escaparHtml(r.estado_recorrido || 'programada')}">${ETIQUETAS_ESTADO_RUTA[r.estado_recorrido] || 'Programada'}</span>
        </div>`).join('') : '<p class="aviso-vacio">Aún no hay rutas registradas.</p>');
}

export async function cargarRutasCiudadano() {
    if (!supabaseClient) return;
    const u = datosUsuarioApp();
    const email = (u.email || '').trim().toLowerCase();
    miBarrioRuta = u.barrio || '';
    miMunicipioRuta = u.municipio || '';

    if (!buscadorRutasActivo) {
        document.getElementById('buscarRuta')?.addEventListener('input', renderizarListaRutas);
        buscadorRutasActivo = true;
    }

    try {
        if (email) {
            const { data } = await supabaseClient.from('usuarios_registrados').select('barrio, municipio').eq('email', email).limit(1);
            if (data && data[0]) {
                miBarrioRuta = data[0].barrio || miBarrioRuta;
                miMunicipioRuta = data[0].municipio || miMunicipioRuta;
            }
        }
        const { data: rutas, error } = await supabaseClient.from('rutas_recoleccion').select('*');
        if (error || !rutas) return;
        rutasCiudadano = rutas;
        renderizarListaRutas();

        if (email && (!miBarrioRuta || !miMunicipioRuta) && !sessionStorage.getItem('avisoPerfilRutas')) {
            sessionStorage.setItem('avisoPerfilRutas', '1');
            mostrarToast('📍 Completa tu municipio y barrio en "Datos personales" para recibir avisos del camión.');
        }

        // Respaldo en el celular: si hoy pasa el camión por tu sector y el aviso del servidor no llegó, se genera aquí
        const hoy = DIAS_SEMANA[new Date().getDay()];
        const rutaHoy = rutas.find(r => rutaEsMia(r) && r.estado_recorrido !== 'suspendida' &&
            String(r.dia_semana || '').split(',').some(d => normalizarTexto(d) === normalizarTexto(hoy)));
        if (!rutaHoy) return;
        const id = `camion:${rutaHoy.id}:${fechaLocalISO()}`;
        if (novedadExiste(id)) return;
        const plantilla = plantillaAppAlerta('paso_camion', 'Hoy pasa el camión de recolección',
            'Hoy pasa el camión de recolección por tu sector ({barrio}, {municipio}) hacia las {hora}.',
            { barrio: rutaHoy.barrio, municipio: rutaHoy.municipio, hora: rutaHoy.hora_estimada });
        if (plantilla) {
            dispararNotificacionMovil(plantilla.titulo, plantilla.mensaje, { id, tipo: 'camion' });
            mostrarToast('🚛 ' + plantilla.mensaje);
        }
    } catch (e) {
        console.warn("No se pudieron cargar las rutas:", e);
    }
}

/* ==========================================
   INICIO DEL MÓDULO
========================================== */
export function iniciarMapa() {
    inicializarMapa();
    cargarRutasCiudadano();

    alEntrarEnSeccion('inicio', () => cargarReportesMapaInicio());
    alEntrarEnSeccion('rutas', cargarRutasCiudadano);
    Object.entries(FORMULARIOS_MAPA).forEach(([tipo, { seccion }]) => {
        alEntrarEnSeccion(seccion, () => setTimeout(() => inicializarMapaFormulario(tipo), 250));
    });
    ['inicio', 'rutas', 'mapa'].forEach(seccion => alEntrarEnSeccion(seccion, () => setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        if (mapInstance) mapInstance.invalidateSize();
    }, 200)));

    // Tiempo real: si cambian las rutas y el ciudadano está viendo esa pantalla, se recargan
    escuchar(EVENTOS.RUTAS_CAMBIARON, () => {
        if (document.getElementById('rutas')?.classList.contains('activa')) cargarRutasCiudadano();
    });
}

Object.assign(window, { obtenerUbicacionActual, activarSeleccionManual });
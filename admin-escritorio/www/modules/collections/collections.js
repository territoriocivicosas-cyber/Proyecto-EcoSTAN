/* ==========================================
   modules/collections/collections.js
   Solicitudes y reportes ciudadanos: formularios (5 categorías), fotos con validación por IA,
   listado, detalle, apoyos, chat con la institución y calificación del servicio.
   La geolocalización viene de map.js y los puntos/QR de rewards.js.
========================================== */
import { supabaseClient } from '../../core/supabaseClient.js';
import { datosUsuarioApp, emailUsuarioApp, estaLogueado, obtenerSesionActual, irALogin } from '../../core/authService.js';
import { estado, escaparHtml, setTexto, mostrarToast, registrarErrorApp, escuchar, EVENTOS } from '../../core/utils.js';
import { mostrarSeccion, alEntrarEnSeccion } from '../../core/navigation.js';
import {
    canonizarMunicipio, MUNICIPIO_NO_DETERMINADO, resolverMunicipio, leerUbicacionFormulario,
    ubicacionReciclajeConfirmada, mostrarMapaDetalle, refrescarMapaDetalle
} from '../map_routing/map.js';
import { htmlBotonQR } from '../rewards/rewards.js';

// Paginación del listado y bloqueos de doble envío
const REPORTES_POR_PAGINA = 10;
let cursorReportes = null;        // created_at del último reporte mostrado
let cargandoReportes = false;
let finReportes = false;
let observadorReportes = null;
let apoyandoEnCurso = false;
let calificacionEstrellas = 0;

/* ==========================================
   OPCIONES ESTANDARIZADAS: "¿CUÁNDO OCURRE?"
========================================== */
const OPCIONES_CUANDO_OCURRE = [
    'Todo el día (de forma permanente)',
    'Madrugada (12 a. m. a 6 a. m.)',
    'Mañana (6 a. m. a 12 m.)',
    'Tarde (12 m. a 6 p. m.)',
    'Noche (6 p. m. a 12 a. m.)',
    'Solo fines de semana y festivos',
    'Sin horario definido'
];

function poblarOpcionesCuandoOcurre() {
    const select = document.getElementById('cuandoAbandonados');
    if (!select || select.tagName !== 'SELECT' || select.options.length > 1) return;

    select.innerHTML = '<option value="">Selecciona una opción</option>' +
        OPCIONES_CUANDO_OCURRE.map(texto => `<option value="${escaparHtml(texto)}">${escaparHtml(texto)}</option>`).join('');
}

/* ==========================================
   FOTOS: COMPRESIÓN Y VALIDACIÓN VISUAL POR IA
========================================== */
// Comprime la foto al menor peso posible manteniendo el detalle útil (se guarda dentro de la fila del reporte).
// Intenta WebP (≈30 % más liviano que JPEG) y, si el teléfono no lo soporta, JPEG.
// Baja la calidad por pasos y, solo si aún pesa de más, reduce el tamaño un 15 % por vuelta.
const FOTO_MAX_LADO = 960;          // píxeles del lado más largo (se distingue bien el material)
const FOTO_PESO_OBJETIVO = 60000;   // bytes aprox. de la imagen final (~60 KB)

function convertirYComprimirImagenABase64(file, maxLado = FOTO_MAX_LADO) {
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
                const escala = Math.min(1, maxLado / Math.max(ancho, alto));
                ancho = Math.round(ancho * escala);
                alto = Math.round(alto * escala);

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const pesoBytes = dataUrl => Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);

                let resultado = null;
                for (let vuelta = 0; vuelta < 4; vuelta++) {
                    canvas.width = ancho;
                    canvas.height = alto;
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, ancho, alto);
                    ctx.drawImage(img, 0, 0, ancho, alto);

                    for (const calidad of [0.7, 0.6, 0.5, 0.4]) {
                        let url = canvas.toDataURL('image/webp', calidad);
                        if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', calidad);
                        resultado = url;
                        if (pesoBytes(url) <= FOTO_PESO_OBJETIVO) { resolve(url); return; }
                    }
                    ancho = Math.round(ancho * 0.85);
                    alto = Math.round(alto * 0.85);
                }
                resolve(resultado);
            };
            img.src = lector.result;
        };
        lector.readAsDataURL(file);
    });
}

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

export function mostrarFotoSeleccionada(sufijo, origen) {
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
    ['Retirar', 'Abandonados', 'ViolenciaAnimal', 'Reciclaje'].forEach(sufijo => {
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
   LISTA NEGRA Y LISTADO DE REPORTES
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

const TABLAS_REPORTES = [
    { tabla: 'reportes_abandonados', extra: 'tipo_afectacion, lugar_direccion, municipio', categoriaNombre: 'Problemas de la ciudad', icono: '🗑️' },
    { tabla: 'reportes_violencia_animal', extra: 'tipo_situacion, lugar_direccion, municipio', categoriaNombre: 'Violencia Animal', icono: '🐾' },
    { tabla: 'reportes_ciudadania', extra: 'tipo_propuesta', categoriaNombre: 'Ciudadanía Activa', icono: '💡' },
    { tabla: 'reportes_reciclaje', extra: 'tipo_residuo, lugar_direccion, municipio', categoriaNombre: 'Entrega a recicladores', icono: '♻️' }
];

function tarjetaReporte(rep, miEmail) {
            const idGenerado = rep.codigo ? `#${rep.codigo}` : `#${rep.id}`;
            const tituloResumen = escaparHtml(rep.nombre_reporte || rep.tipo_residuo || rep.tipo_afectacion || rep.tipo_situacion || rep.tipo_propuesta || 'Incidencia reportada');
            const direccionTexto = escaparHtml(rep.lugar_direccion || textoUbicacionReporte(rep));
            
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
                    <img src="${escaparHtml(rep.foto_url)}" style="width:100%; height:100%; object-fit:cover;" alt="Foto reporte">
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
}

// Carga la siguiente página (10 reportes, del más reciente al más antiguo) y la agrega al listado
async function cargarReportes(reiniciar) {
    const contenedor = document.getElementById('listaReportes');
    if (!contenedor || !supabaseClient || cargandoReportes) return;

    if (reiniciar) {
        cursorReportes = null;
        finReportes = false;
        window.cacheReportesLocales = [];
        contenedor.innerHTML = '';
    }
    if (finReportes) return;

    cargandoReportes = true;
    try {
        const camposBase = 'id, created_at, codigo, nombre_reporte, estado, usuario_email';
        const respuestas = await Promise.all(TABLAS_REPORTES.map(t => {
            let q = supabaseClient.from(t.tabla).select(`${camposBase}, ${t.extra}`).order('created_at', { ascending: false }).limit(REPORTES_POR_PAGINA);
            if (cursorReportes) q = q.lt('created_at', cursorReportes);
            return q;
        }));

        const unidos = [];
        respuestas.forEach((res, i) => {
            const t = TABLAS_REPORTES[i];
            (res.data || []).forEach(r => unidos.push({ ...r, origenTabla: t.tabla, categoriaNombre: t.categoriaNombre, icono: t.icono }));
        });
        unidos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const pagina = unidos.slice(0, REPORTES_POR_PAGINA);

        if (pagina.length === 0 && !cursorReportes) {
            contenedor.innerHTML = `
                <div class="empty" style="text-align:center; padding: 40px; color:#666;">
                    <div style="font-size: 40px; margin-bottom: 10px;">📋</div>
                    <h3>No hay reportes registrados todavía</h3>
                </div>
            `;
            finReportes = true;
            return;
        }

        if (pagina.length < REPORTES_POR_PAGINA) finReportes = true;
        if (pagina.length) cursorReportes = pagina[pagina.length - 1].created_at;
        window.cacheReportesLocales = (window.cacheReportesLocales || []).concat(pagina);

        const miEmail = emailUsuarioApp();
        contenedor.querySelector('#centinelaReportes')?.remove();
        contenedor.insertAdjacentHTML('beforeend', pagina.map(rep => tarjetaReporte(rep, miEmail)).join(''));

        if (!finReportes) {
            contenedor.insertAdjacentHTML('beforeend', '<div id="centinelaReportes" style="text-align:center; padding:16px; color:#888; font-size:13px;">Cargando más…</div>');
            observarCentinelaReportes();
        }
    } catch (err) {
        console.error("Error al cargar reportes:", err);
    } finally {
        cargandoReportes = false;
    }
}

// Scroll infinito: cuando el aviso "Cargando más…" entra en pantalla se piden otros 10
function observarCentinelaReportes() {
    const centinela = document.getElementById('centinelaReportes');
    if (!centinela) return;
    if (observadorReportes) observadorReportes.disconnect();
    if (!('IntersectionObserver' in window)) { cargarReportes(); return; }
    observadorReportes = new IntersectionObserver((entradas) => {
        if (entradas.some(e => e.isIntersecting)) {
            observadorReportes.disconnect();
            cargarReportes();
        }
    }, { rootMargin: '200px' });
    observadorReportes.observe(centinela);
}

// Ubicación a mostrar cuando el reporte no trae dirección escrita: municipio real del reporte
function textoUbicacionReporte(rep) {
    const mun = canonizarMunicipio(rep && rep.municipio);
    return mun && mun !== MUNICIPIO_NO_DETERMINADO ? `${mun}, Santander` : 'Ubicación registrada por GPS';
}

function enviarMensajesAutomaticosReporte(idCreado, tablaOrigen, categoriaReporte, codigoReporte, extra) {
    const fechaHora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const numero = codigoReporte || idCreado;

    const esReciclable = tablaOrigen === 'reportes_reciclaje';
    const esRetiro = tablaOrigen === 'reportes_retiro';
    const zona = (extra && extra.municipio) ? `${extra.municipio} / Área Metropolitana` : 'tu zona / Área Metropolitana';

    const msgReciclaje =
        `[Sistema - EcoSTAN] ¡Hola! Tu solicitud #${numero} de entrega a recicladores (${(extra && extra.tipoResiduo) || 'material reciclable'}) ha sido publicada con éxito en la red CicloGo de economía circular de ${zona}.\n\n` +
        `♻️ ¿Qué sigue ahora? Tu reporte ya es visible en tiempo real para los recicladores formales y verificados de la zona. ` +
        `En cuanto uno de ellos acepte el servicio, te notificaremos por este medio su nombre, su vehículo y el tiempo estimado de llegada ` +
        `para la recolección gratuita en tu puerta.\n\n` +
        `¡Gracias por separar en la fuente y darle una nueva vida a tus residuos!`;

    const msgRetiro =
        `Hola, tu solicitud #${numero} de retiro de residuos (${(extra && extra.tipoResiduo) || 'residuo'}) ha sido registrada.\n\n` +
        `🚛 ¿Qué sigue ahora? Tu solicitud fue enviada a la entidad encargada del servicio de aseo en ${(extra && extra.municipio) || 'tu municipio'} para su programación. ` +
        `Te avisaremos por este medio cuando sea atendida.\n\nGracias por ayudarnos a mantener la ciudad limpia.`;

    const msgInstitucional = esReciclable ? msgReciclaje : esRetiro ? msgRetiro :
        `Hola, tu reporte #${numero} ha sido recibido en nuestro sistema de veeduría y gestión comunitaria.\n\n` +
        `ℹ️ ¿Qué pasa ahora? Tu reporte no se queda en el olvido. Lo estamos agrupando en el Expediente Semanal de la Comuna/Barrio ` +
        `para radicar una petición formal (PQRSD) ante la entidad competente (Alcaldía de Bucaramanga / EMAB / Policía Ambiental). ` +
        `Te avisaremos tan pronto tengamos el número de radicado oficial.\n\n` +
        `¡Gracias por proteger el espacio público de nuestra ciudad!`;

    supabaseClient.from('chat_reportes').insert([
        { reporte_id: idCreado, tabla_origen: tablaOrigen, mensaje: msgInstitucional, emisor: 'institucion', hora: fechaHora }
    ]).then(({ error }) => {
        if (error) console.warn("Error enviando mensaje automático:", error);
    }).catch(e => {
        console.warn("Error enviando mensaje automático:", e);
    });
}

/* ==========================================
   ENVIAR NUEVO REPORTE
   Cada categoría arma su propia fila (tabla + campos propios); el resto del flujo es común.
========================================== */
const campo = id => document.getElementById(id)?.value || '';

// Coordenadas en las dos variantes de columnas que usa la base de datos (lat/lng y latitud/longitud)
const coordenadas = (lat, lng) => ({
    lat: lat ? parseFloat(lat) : null,
    lng: lng ? parseFloat(lng) : null,
    latitud: lat ? parseFloat(lat) : null,
    longitud: lng ? parseFloat(lng) : null
});

// Ubicación del formulario + municipio detectado + foto validada. Devuelve null si la foto fue rechazada.
async function ubicacionYFoto(tipoMapa, sufijoFoto) {
    const { lat, lng } = leerUbicacionFormulario(tipoMapa);
    const municipio = await resolverMunicipio(lat, lng);
    const foto = await prepararFotoReporte(document.getElementById('foto' + sufijoFoto));
    if (!foto.valida) return null;
    return { lat, lng, municipio, fotoUrl: foto.fotoUrl };
}

// categoría -> async () => { tabla, payload, extraChat? } | null (si la validación falló y ya se avisó al usuario)
const CONSTRUCTORES_REPORTE = {
    'Necesito retirar un residuo': async () => {
        const base = await ubicacionYFoto('retirar', 'Retirar');
        if (!base) return null;
        const tipoResiduo = campo('subtipoRetirar');
        return {
            tabla: 'reportes_retiro',
            payload: {
                nombre_reporte: campo('nombreRetirar'),
                tipo_residuo: tipoResiduo,
                municipio: base.municipio,
                ...coordenadas(base.lat, base.lng),
                foto_url: base.fotoUrl
            },
            extraChat: { tipoResiduo, municipio: base.municipio }
        };
    },

    'Reportar problemas de la ciudad': async () => {
        const cuando = campo('cuandoAbandonados');
        if (!cuando) { alert("Selecciona cuándo ocurre el problema."); return null; }

        const base = await ubicacionYFoto('abandonados', 'Abandonados');
        if (!base) return null;
        return {
            tabla: 'reportes_abandonados',
            payload: {
                nombre_reporte: campo('nombreAbandonados'),
                tipo_afectacion: campo('subtipoAbandonados'),
                municipio: base.municipio,
                lugar_direccion: campo('lugarAbandonados'),
                cuando_ocurre: cuando,
                recurrente: campo('recurrenteAbandonados') || 'No',
                ...coordenadas(base.lat, base.lng),
                foto_url: base.fotoUrl
            }
        };
    },

    'Violencia Animal': async () => {
        const base = await ubicacionYFoto('violenciaAnimal', 'ViolenciaAnimal');
        if (!base) return null;
        return {
            tabla: 'reportes_violencia_animal',
            payload: {
                nombre_reporte: campo('nombreViolenciaAnimal'),
                tipo_situacion: campo('subtipoViolenciaAnimal'),
                municipio: base.municipio,
                lugar_direccion: campo('lugarViolenciaAnimal'),
                detalle_situacion: campo('detalleViolenciaAnimal'),
                ...coordenadas(base.lat, base.lng),
                foto_url: base.fotoUrl
            }
        };
    },

    'Entregar a Recicladores': async () => {
        const tipoMaterial = campo('subtipoReciclaje');
        const cantidad = campo('cantidadReciclaje');
        const franja = campo('franjaReciclaje');
        const materialLimpio = !!document.getElementById('materialLimpioReciclaje')?.checked;
        const { lat, lng } = leerUbicacionFormulario('reciclaje');

        if (!tipoMaterial || !cantidad || !franja) {
            alert("Completa el tipo de material, la cantidad y el horario de recogida.");
            return null;
        }
        if (!materialLimpio) {
            alert("Confirma que el material está limpio, seco y separado para poder entregarlo al reciclador.");
            return null;
        }
        if (!ubicacionReciclajeConfirmada() || !lat || !lng) {
            alert("Confirma tu ubicación: toca \"Enviar mi ubicación actual\" o marca el punto exacto en el mapa para que el reciclador pueda llegar.");
            return null;
        }

        const base = await ubicacionYFoto('reciclaje', 'Reciclaje');
        if (!base) return null;
        return {
            tabla: 'reportes_reciclaje',
            payload: {
                // Sin título escrito por el ciudadano: se arma solo (Material · Municipio)
                nombre_reporte: `${tipoMaterial.split(' (')[0]}${base.municipio ? ' · ' + base.municipio : ''}`.slice(0, 80),
                tipo_residuo: tipoMaterial,
                cantidad_aproximada: cantidad,
                franja_recogida: franja,
                lugar_direccion: campo('lugarReciclaje'),
                material_limpio: materialLimpio,
                municipio: base.municipio,
                ...coordenadas(base.lat, base.lng),
                foto_url: base.fotoUrl
            },
            extraChat: { tipoResiduo: tipoMaterial, municipio: base.municipio }
        };
    },

    'Ciudadanía Activa': async () => ({
        tabla: 'reportes_ciudadania',
        payload: {
            nombre_reporte: campo('nombreCiudadania'),
            tipo_propuesta: campo('subtipoCiudadania'),
            detalle_propuesta: campo('detalleCiudadania')
        }
    })
};

export async function enviarReporteSupabase(event, categoriaReporte) {
    event.preventDefault();

    if (!supabaseClient) {
        alert("No hay conexión con Supabase.");
        return;
    }

    const emailUsuario = emailUsuarioApp();

    if (await verificarUsuarioBloqueado(emailUsuario)) {
        alert("Tu cuenta se encuentra bloqueada y no puede enviar reportes. Si crees que se trata de un error, comunícate con la Alcaldía.");
        return;
    }

    try {
        const construir = CONSTRUCTORES_REPORTE[categoriaReporte];
        if (!construir) throw new Error(`Categoría de reporte desconocida: ${categoriaReporte}`);

        const armado = await construir();
        if (!armado) return;   // validación fallida: ya se avisó al usuario

        const codigoAuto = Math.floor(100000 + Math.random() * 900000);
        const { data, error } = await supabaseClient.from(armado.tabla)
            .insert([{ codigo: codigoAuto, ...armado.payload, usuario_email: emailUsuario, estado: 'pendiente' }])
            .select();
        if (error) throw error;

        const idCreado = (data && data.length > 0) ? data[0].id : null;
        if (idCreado) {
            enviarMensajesAutomaticosReporte(idCreado, armado.tabla, categoriaReporte, codigoAuto, armado.extraChat || {});
        }

        mostrarToast("¡Reporte enviado con éxito!");
        event.target.reset();
        reiniciarTextosFotos();

        if (idCreado) abrirDetalleSolicitud(idCreado, armado.tabla);
        else mostrarSeccion('mis-reportes', true);

    } catch (err) {
        alert("Hubo un error al enviar el reporte: " + err.message);
    }
}

/* ==========================================
   DETALLE DE LA SOLICITUD
========================================== */
export async function abrirDetalleSolicitud(id, tablaOrigen) {
    if (!supabaseClient) return;

    try {
        const { data, error } = await supabaseClient.from(tablaOrigen).select('*').eq('id', id).single();
        if (error || !data) throw new Error("No se pudo cargar el reporte.");

        estado.reporteSeleccionado = { ...data, tablaOrigen };

        mostrarSeccion('detalle-solicitud', true);

        const emailUsuarioActual = emailUsuarioApp();

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
        setTexto('detNombre', data.nombre_reporte || data.tipo_residuo || data.tipo_afectacion || data.tipo_situacion || 'Aviso Registrado');
        setTexto('detReferencia', `Referencia del aviso: ${codigoTexto}`);
        setTexto('detDireccion', data.lugar_direccion || textoUbicacionReporte(data));
        
        let estNombre = data.estado || 'pendiente';
        let estIcono = estNombre.toLowerCase() === 'resuelto' ? '✓' : (estNombre.toLowerCase() === 'cancelada' ? '✕' : '⏳');
        setTexto('detEstado', `${estIcono} ${estNombre.charAt(0).toUpperCase() + estNombre.slice(1)}`);
        
        setTexto('detCategoria', data.tipo_residuo || data.tipo_afectacion || data.tipo_situacion || data.tipo_propuesta || 'Gestión Urbana');
        const permiteApoyo = tablaOrigen !== 'reportes_reciclaje';
        const botonApoyo = document.getElementById('btnApoyar');
        if (botonApoyo) botonApoyo.style.display = permiteApoyo ? '' : 'none';
        setTexto('numApoyos', data.apoyos || 0);
        if (permiteApoyo) cargarEstadoApoyos();

        const f = new Date(data.created_at);
        setTexto('detFechaCreacion', `${f.getDate()} de ${f.toLocaleString('es-ES', { month: 'long' })} de ${f.getFullYear()} a las ${f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);

        const contenedorFoto = document.getElementById('contenedorFotoAdjunta');
        const imgEvidencia = document.getElementById('imgEvidenciaReporte');
        if (contenedorFoto) {
            if (data.foto_url && imgEvidencia) {
                imgEvidencia.src = data.foto_url;
                contenedorFoto.style.display = 'block';
            } else {
                contenedorFoto.style.display = 'none';
            }
        }

        mostrarMapaDetalle(data.lat ?? data.latitud, data.lng ?? data.longitud);

        if (esMiReporte) {
            cargarMensajesChat();
        }

    } catch (err) {
        registrarErrorApp('abrirDetalleSolicitud', err);
        mostrarToast('No se pudo abrir la solicitud. Intenta de nuevo.');
    }
}

export function cambiarPestanaSolicitud(pestana) {
    const btnDetalle = document.getElementById('tabBtnDetalle');
    const btnChat = document.getElementById('tabBtnChat');
    const contentDetalle = document.getElementById('tabDetalleContent');
    const contentChat = document.getElementById('tabChatContent');

    if (pestana === 'detalle') {
        btnDetalle.classList.add('activo');
        if (btnChat) btnChat.classList.remove('activo');
        contentDetalle.classList.add('activo');
        contentChat.classList.remove('activo');
        refrescarMapaDetalle();
    } else {
        if (btnChat) btnChat.classList.add('activo');
        btnDetalle.classList.remove('activo');
        contentChat.classList.add('activo');
        contentDetalle.classList.remove('activo');
        cargarMensajesChat();
    }
}

/* ==========================================
   APOYAR SOLICITUD (solo usuarios registrados, un voto por usuario)
   Requiere la tabla apoyos_reportes (ver apoyos_reportes.sql)
========================================== */
function actualizarBotonApoyo(yaApoyo) {
    const boton = document.getElementById('btnApoyarSolicitud') || document.querySelector('[onclick*="apoyarSolicitudActual"]');
    if (!boton) return;
    if (!boton.dataset.textoOriginal) boton.dataset.textoOriginal = boton.textContent;
    boton.textContent = yaApoyo ? '✓ Ya apoyaste esta solicitud' : boton.dataset.textoOriginal;
    boton.disabled = !!yaApoyo;
}

async function cargarEstadoApoyos() {
    const reporte = estado.reporteSeleccionado;
    if (!reporte || !supabaseClient) return;

    const idReporte = String(reporte.id);
    const tabla = reporte.tablaOrigen;

    let total = reporte.apoyos || 0;
    try {
        const { data, error } = await supabaseClient.rpc('contar_apoyos', { p_tabla: tabla, p_reporte_id: idReporte });
        if (!error && data !== null && data !== undefined) total = Number(data);
    } catch (e) {
        console.warn("No se pudo contar los apoyos:", e);
    }

    const contador = document.getElementById('numApoyos');
    if (contador && estado.reporteSeleccionado === reporte) contador.textContent = total;

    let yaApoyo = false;
    const sesion = await obtenerSesionActual();
    if (sesion) {
        try {
            const { data } = await supabaseClient
                .from('apoyos_reportes')
                .select('id')
                .eq('tabla_origen', tabla)
                .eq('reporte_id', idReporte)
                .eq('usuario_id', sesion.user.id)
                .limit(1);
            yaApoyo = Array.isArray(data) && data.length > 0;
        } catch (e) {}
    }
    if (estado.reporteSeleccionado === reporte) actualizarBotonApoyo(yaApoyo);
}

export async function apoyarSolicitudActual() {
    if (!estado.reporteSeleccionado || !supabaseClient || apoyandoEnCurso) return;

    const sesion = await obtenerSesionActual();
    if (!estaLogueado() || !sesion) {
        alert("Debes iniciar sesión para apoyar una solicitud.");
        irALogin();
        return;
    }

    apoyandoEnCurso = true;
    try {
        const { error } = await supabaseClient.from('apoyos_reportes').insert([{
            tabla_origen: estado.reporteSeleccionado.tablaOrigen,
            reporte_id: String(estado.reporteSeleccionado.id),
            usuario_id: sesion.user.id,
            usuario_email: (sesion.user.email || '').trim().toLowerCase()
        }]);

        if (error) {
            if (error.code === '23505') {
                mostrarToast("Ya habías apoyado esta solicitud.");
            } else {
                throw error;
            }
        } else {
            mostrarToast("¡Gracias por apoyar esta solicitud comunitaria!");
        }

        await cargarEstadoApoyos();
    } catch (err) {
        alert("No se pudo registrar el apoyo: " + err.message);
    } finally {
        apoyandoEnCurso = false;
    }
}

/* ==========================================
   CHAT CON LA INSTITUCIÓN Y CALIFICACIÓN DEL SERVICIO
========================================== */
export async function cargarMensajesChat() {
    if (!estado.reporteSeleccionado || !supabaseClient) return;

    const contenedor = document.getElementById('chatMensajesList');
    const fechaBadge = document.getElementById('chatFechaBadge');
    
    const fechaCreacion = new Date(estado.reporteSeleccionado.created_at);
    if (fechaBadge) fechaBadge.textContent = fechaCreacion.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

    try {
        const { data, error } = await supabaseClient
            .from('chat_reportes')
            .select('*')
            .eq('reporte_id', estado.reporteSeleccionado.id)
            .order('created_at', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            contenedor.innerHTML = `<p style="text-align:center; color:#888; font-size:13px; margin-top:20px;">Sin mensajes aún.</p>`;
            return;
        }

        // Si hay una tarjeta de calificación, se consulta si ya fue respondida
        let estrellasDadas = null;
        if (data.some(m => m.tipo === 'calificacion')) {
            try {
                const { data: cal } = await supabaseClient.rpc('consultar_calificacion', { p_reporte_id: String(estado.reporteSeleccionado.id) });
                estrellasDadas = cal || null;
            } catch (e) {}
        }

        contenedor.innerHTML = data.map(m => {
            const esInstitucion = m.emisor === 'institucion' || m.emisor === 'reciclador';
            const tarjeta = m.tipo === 'calificacion' ? (estrellasDadas
                ? `<div class="calificacion-card"><p>Calificaste este servicio con ${'⭐'.repeat(estrellasDadas)}. ¡Gracias!</p></div>`
                : `<div class="calificacion-card">
                        <div class="calificacion-estrellas">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-estrella="${n}" onclick="seleccionarEstrellas(${n})">☆</button>`).join('')}</div>
                        <p>¿El reciclador fue puntual y respetuoso?</p>
                        <div class="calificacion-botones">
                            <button type="button" onclick="enviarCalificacion(true)">Sí, excelente</button>
                            <button type="button" class="secundario" onclick="enviarCalificacion(false)">Hubo un inconveniente</button>
                        </div>
                   </div>`) : '';
            return `
                <div class="chat-bubble ${esInstitucion ? 'institucion' : 'usuario'}">
                    ${m.emisor === 'reciclador' ? '<strong style="font-size:11px;">♻️ Reciclador</strong>' : ''}
                    <p>${escaparHtml(m.mensaje).replace(/\n/g, '<br>')}</p>
                    ${tarjeta}
                    <span class="chat-hora">${escaparHtml(m.hora || '12:00')}</span>
                </div>
            `;
        }).join('');

        contenedor.insertAdjacentHTML('beforeend', await htmlBotonQR());
        contenedor.scrollTop = contenedor.scrollHeight;
    } catch (err) {
        console.error("Error al cargar chat:", err);
    }
}

export function seleccionarEstrellas(n) {
    calificacionEstrellas = n;
    document.querySelectorAll('.calificacion-estrellas button').forEach(b => {
        b.textContent = Number(b.dataset.estrella) <= n ? '⭐' : '☆';
    });
}

export async function enviarCalificacion(puntualRespetuoso) {
    if (!calificacionEstrellas) { mostrarToast("Selecciona primero las estrellas."); return; }
    if (!estado.reporteSeleccionado || !supabaseClient) return;
    let comentario = '';
    if (!puntualRespetuoso) comentario = prompt("Cuéntanos qué ocurrió (opcional):") || '';
    const email = (datosUsuarioApp().email || '').trim().toLowerCase();
    try {
        const { data, error } = await supabaseClient.rpc('calificar_servicio', {
            p_reporte_id: String(estado.reporteSeleccionado.id), p_email: email,
            p_estrellas: calificacionEstrellas, p_puntual: puntualRespetuoso, p_comentario: comentario
        });
        if (error) throw error;
        mostrarToast("¡Gracias por calificar el servicio!");
        calificacionEstrellas = 0;
        cargarMensajesChat();
    } catch (err) {
        alert("No se pudo enviar la calificación: " + (err.message || err));
    }
}

export async function enviarMensajeChat() {
    const input = document.getElementById('inputChatMensaje');
    const texto = input?.value?.trim();

    if (!texto || !estado.reporteSeleccionado || !supabaseClient) return;

    const horaAhora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    try {
        const { error } = await supabaseClient.from('chat_reportes').insert([
            {
                reporte_id: estado.reporteSeleccionado.id,
                tabla_origen: estado.reporteSeleccionado.tablaOrigen,
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

export function iniciarColecciones() {
    poblarOpcionesCuandoOcurre();

    alEntrarEnSeccion('mis-reportes', () => {
        cargarReportes(true);
    });

    // Eventos que llegan desde notifications.js / rewards.js (esos módulos no nos importan)
    escuchar(EVENTOS.ABRIR_REPORTE, ({ id, tabla, pestana }) => {
        abrirDetalleSolicitud(id, tabla);
        if (pestana) setTimeout(() => cambiarPestanaSolicitud(pestana), 350);
    });
    escuchar(EVENTOS.CHAT_NUEVO, ({ reporteId }) => {
        if (estado.reporteSeleccionado && String(estado.reporteSeleccionado.id) === String(reporteId)) cargarMensajesChat();
    });
    escuchar(EVENTOS.CHAT_REFRESCAR, () => cargarMensajesChat());
    escuchar(EVENTOS.REPORTE_ACTUALIZADO, ({ id, tabla }) => {
        const detalleVisible = document.getElementById('detalle-solicitud')?.classList.contains('activa');
        if (detalleVisible && estado.reporteSeleccionado && String(estado.reporteSeleccionado.id) === String(id)) {
            abrirDetalleSolicitud(id, tabla);
        }
    });
}

Object.assign(window, {
    enviarReporteSupabase, mostrarFotoSeleccionada, cambiarPestanaSolicitud, apoyarSolicitudActual,
    enviarMensajeChat, abrirDetalleSolicitud, seleccionarEstrellas, enviarCalificacion
});
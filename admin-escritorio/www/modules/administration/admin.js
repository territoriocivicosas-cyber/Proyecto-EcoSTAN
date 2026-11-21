/* ==========================================
   modules/administration/admin.js
   Panel de gestión (superadmin y dependencias): bandejas de reportes, chat con ciudadanos,
   usuarios bloqueados, banners y métricas, rutas, KPIs, mapa de calor, usuarios del panel,
   configuración de dependencias y alertas.
   La sesión, el cliente de Supabase y las rutas vienen de /core.
========================================== */
import { supabaseClient, crearClienteSinSesion } from '../../core/supabaseClient.js';
import { RUTAS, datosAdminApp, guardarDependenciaAdmin, cerrarSesionGlobal } from '../../core/authService.js';
import { crearAnalitica } from './analitica.js';
import { crearTerritorios } from './territorios.js';
import { escaparHtml as escaparHTML, normalizarTexto as normTxt, fechaLocalISO as hoyLocal, alDOMListo } from '../../core/utils.js';

let dependenciaUsuario = datosAdminApp().dependencia;
let datosOriginales = [];
let datosFiltrados = [];
let reporteActivoChat = null;

let colaReportesNuevos = [];
let alertaEnProceso = false;
let alertaChatPendiente = null;

/* ==========================================
   FUNCIÓN PARA COMPRIMIR IMÁGENES
========================================== */
async function comprimirImagen(file, maxWidth = 800, quality = 0.75) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(blob => {
                    if (!blob) {
                        reject(new Error("Falló la compresión"));
                        return;
                    }
                    const archivoComprimido = new File([blob], file.name, {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    });
                    resolve(archivoComprimido);
                }, 'image/jpeg', quality);
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
}

/* ==========================================
   LÓGICA PARA PUBLICAR BANNERS CON COMPRESIÓN
========================================== */
function inicializarFormularioBanners() {
    const formBanner = document.getElementById('formPublicarBanner');
    if (!formBanner) return;

    formBanner.addEventListener('submit', async (e) => {
        e.preventDefault();
        const badge = document.getElementById('bannerBadge').value;
        const municipioDestino = document.getElementById('bannerMunicipio').value;
        const titulo = document.getElementById('bannerTitulo').value.trim();
        const descripcion = document.getElementById('bannerDescripcion').value.trim();
        const fileInput = document.getElementById('bannerImagenFile');
        let archivo = fileInput.files[0];

        if (!archivo) {
            alert("Por favor selecciona una imagen para el banner.");
            return;
        }

        try {
            // Comprimir antes de subir para ahorrar memoria
            archivo = await comprimirImagen(archivo, 800, 0.75);

            const nombreArchivo = `${Date.now()}_${archivo.name}`;
            const { error: uploadError } = await supabaseClient.storage
                .from('banners')
                .upload(nombreArchivo, archivo);

            if (uploadError) throw uploadError;

            const { data: urlData } = supabaseClient.storage
                .from('banners')
                .getPublicUrl(nombreArchivo);

            const imagenUrl = urlData.publicUrl;

            const tipoEnlace = document.getElementById('bannerTipoEnlace').value;
            const urlExterna = document.getElementById('bannerUrlExterna').value.trim();
            const notaAviso = document.getElementById('bannerNotaAviso').value.trim();
            if (tipoEnlace === 'url' && !/^https?:\/\//i.test(urlExterna)) throw new Error("Escribe una URL válida que empiece por http:// o https://");
            if (tipoEnlace === 'aviso' && !notaAviso) throw new Error("Redacta la nota corta / aviso que verá el ciudadano.");

            const { error: insertError } = await supabaseClient.from('banners').insert([{
                badge: badge,
                titulo: titulo,
                descripcion: descripcion,
                imagen_fondo: imagenUrl,
                municipio: municipioDestino,
                texto_boton: 'Ver detalles',
                enlace_boton: tipoEnlace === 'url' ? urlExterna : 'avisos',
                tipo_enlace: tipoEnlace,
                url_externa: tipoEnlace === 'url' ? urlExterna : null,
                nota_aviso: tipoEnlace === 'aviso' ? notaAviso : null,
                origen: document.getElementById('bannerOrigen').value,
                importante: document.getElementById('bannerImportante').checked,
                activo: true
            }]);

            if (insertError) throw insertError;

            if (document.getElementById('bannerImportante').checked && alertaActiva('banner_importante')) {
                const p = plantillaAlerta('banner_importante', { titulo: titulo, origen: document.getElementById('bannerOrigen').value });
                await crearNotificacion({ tipo: 'banner', ...p, municipio: municipioDestino, origen: document.getElementById('bannerOrigen').value });
            }
            alert("¡Banner comprimido y publicado con éxito!");
            formBanner.reset();
            alternarTipoEnlaceBanner();
            prepararOrigenBanner();
            cargarMetricasBanners();
        } catch (err) {
            console.error("Error al publicar banner:", err);
            alert("Ocurrió un error al publicar el banner: " + err.message);
        }
    });
}

/* ==========================================
   CARGAR MÉTRICAS Y BOTÓN DE ELIMINAR
========================================== */
async function cargarMetricasBanners() {
    const cuerpoMetricas = document.getElementById('cuerpoTablaMetricasBanners');
    if (!cuerpoMetricas) return;

    try {
        const { data: banners, error: errBanners } = await supabaseClient.from('banners').select('*').order('created_at', { ascending: false });
        if (errBanners) throw errBanners;
        const { data: eventos, error: errVistas } = await supabaseClient.from('banner_vistas').select('banner_id, user_email, tipo');
        if (errVistas) throw errVistas;

        if (!banners || banners.length === 0) {
            cuerpoMetricas.innerHTML = `<tr><td colspan="8" style="text-align:center;">No hay banners publicados registrados.</td></tr>`;
            return;
        }

        const m = {};
        (eventos || []).forEach(ev => {
            const k = String(ev.banner_id);
            m[k] = m[k] || { vistas: 0, clics: 0, unicos: new Set() };
            if (ev.tipo === 'clic') m[k].clics++;
            else { m[k].vistas++; m[k].unicos.add((ev.user_email || 'anonimo').toLowerCase()); }
        });

        const etiquetaOrigen = { alcaldia: '🏛️ Alcaldía', aseo: '🚛 Aseo', recicladores: '♻️ Recicladores' };
        cuerpoMetricas.innerHTML = banners.map(b => {
            const x = m[String(b.id)] || { vistas: 0, clics: 0, unicos: new Set() };
            const activo = b.activo !== false;
            return `
                <tr>
                    <td><strong>${b.importante ? '⭐ ' : ''}${escaparHTML(b.titulo || 'Sin título')}</strong></td>
                    <td>${escaparHTML(b.badge || '---')}<br><small style="color:#777;">${etiquetaOrigen[b.origen] || ''}</small></td>
                    <td>${escaparHTML(b.municipio || 'Todos')}</td>
                    <td><span class="status-badge ${activo ? 'status-resuelto' : 'status-cancelada'}">${activo ? 'Habilitado' : 'Deshabilitado'}</span></td>
                    <td><span class="pct-badge pct-alto">👁️ ${x.vistas}</span></td>
                    <td>👤 ${x.unicos.size}</td>
                    <td>🖱️ ${x.clics}${x.vistas ? ` <small style="color:#777;">(${(x.clics / x.vistas * 100).toFixed(1)}%)</small>` : ''}</td>
                    <td>
                        <button class="btn-chat-admin" onclick="alternarBannerActivo('${b.id}', ${!activo})">${activo ? '⏸️ Deshabilitar' : '▶️ Habilitar'}</button>
                        <button class="btn-logout" style="padding: 5px 10px; font-size: 11px;" onclick="eliminarBanner('${b.id}', '${b.imagen_fondo || ''}')">🗑️</button>
                    </td>
                </tr>`;
        }).join('');
    } catch (err) {
        console.error("Error al cargar métricas:", err);
        cuerpoMetricas.innerHTML = `<tr><td colspan="8" style="text-align:center; color:red;">Error al cargar las métricas: ${escaparHTML(err.message)} (¿ejecutaste cambios_supabase.sql?)</td></tr>`;
    }
}

async function alternarBannerActivo(id, activo) {
    const { error } = await supabaseClient.from('banners').update({ activo }).eq('id', id);
    if (error) alert("Error: " + error.message); else cargarMetricasBanners();
}

/* ==========================================
   FUNCIÓN PARA ELIMINAR BANNERS (TABLA Y STORAGE)
========================================== */
async function eliminarBanner(id, urlImagen) {
    if (!confirm("¿Estás seguro de eliminar este banner? Se borrará el anuncio y su imagen del sistema.")) return;

    try {
        // 1. Borrar archivo del Storage si existe
        if (urlImagen) {
            const partesUrl = urlImagen.split('/');
            const nombreArchivo = partesUrl[partesUrl.length - 1];
            if (nombreArchivo) {
                await supabaseClient.storage.from('banners').remove([nombreArchivo]);
            }
        }

        // 2. Borrar registro de la tabla banners
        const { error } = await supabaseClient.from('banners').delete().eq('id', id);
        if (error) throw error;

        alert("¡Banner eliminado correctamente!");
        cargarMetricasBanners();
    } catch (err) {
        console.error("Error al eliminar el banner:", err);
        alert("No se pudo eliminar el banner: " + err.message);
    }
}

function cambiarBandeja() {
    limpiarFiltros();
    cargarDatosBandeja();
}

async function cargarDatosBandeja() {
    const tabla = document.getElementById('selectBandeja').value;
    const panelBanners = document.getElementById('panelGestionBanners');
    const filtrosCard = document.getElementById('contenedorFiltrosGenerales');
    const cardSecundaria = document.getElementById('cardSecundariaBox');
    const cardTotal = document.querySelector('.cards-grid');
    const tablaContainer = document.getElementById('contenedorTablaPrincipal');
    const panelBloqueo = document.getElementById('panelBloqueoUsuarios');
    construirMenuLateral();   // mantiene el menú lateral sincronizado con la bandeja activa

    if (panelBloqueo) panelBloqueo.style.display = (tabla === 'usuarios_bloqueados') ? 'flex' : 'none';

    // Filtros avanzados: se muestran solo los que aplican a cada bandeja
    const esUsuariosTab = (tabla === 'usuarios_registrados' || tabla === 'usuarios_bloqueados');
    const grpEstado = document.getElementById('filtroEstadoContainer');
    const grpMunicipio = document.getElementById('grupoFiltroMunicipio');
    if (grpEstado) grpEstado.style.display = (esUsuariosTab || tabla === 'analitica_kpi' || tabla === 'plan_premium') ? 'none' : 'flex';
    if (grpMunicipio) grpMunicipio.style.display = (esUsuariosTab || tabla === 'reportes_ciudadania') ? 'none' : 'flex';

    const panelRutas = document.getElementById('panelRutas');
    const panelAnalitica = document.getElementById('panelAnalitica');
    const panelPremium = document.getElementById('panelPremium');
    const panelSuper = document.getElementById('panelSuperadmin');
    const panelInicio = document.getElementById('panelInicio');
    const panelOperacion = document.getElementById('panelOperacion');
    const esOperacion = String(tabla).startsWith('operacion_');
    if (panelOperacion) panelOperacion.style.display = esOperacion ? 'block' : 'none';
    if (panelInicio) panelInicio.style.display = (tabla === 'inicio_resumen') ? 'block' : 'none';
    if (panelSuper) panelSuper.style.display = (tabla === 'superadmin_panel') ? 'block' : 'none';
    if (panelRutas) panelRutas.style.display = (tabla === 'gestion_rutas') ? 'block' : 'none';
    if (panelAnalitica) panelAnalitica.style.display = (tabla === 'analitica_kpi') ? 'block' : 'none';
    if (panelPremium) panelPremium.style.display = (tabla === 'plan_premium') ? 'block' : 'none';

    if (tabla === 'gestion_rutas' || tabla === 'analitica_kpi' || tabla === 'plan_premium' || tabla === 'superadmin_panel' || tabla === 'inicio_resumen' || esOperacion) {
        panelBanners.style.display = 'none';
        if (cardTotal) cardTotal.style.display = 'none';
        if (tablaContainer) tablaContainer.style.display = 'none';
        if (filtrosCard) filtrosCard.style.display = (tabla === 'analitica_kpi' || tabla === 'plan_premium') ? 'flex' : 'none';
        if (tabla === 'gestion_rutas') cargarRutas();
        else if (tabla === 'superadmin_panel') { cargarSuperadmin(); mostrarSeccionSuper(seccionSuper); }
        else if (tabla === 'inicio_resumen') cargarResumen();
        else if (esOperacion) cargarOperacion(tabla);
        else if (tabla === 'plan_premium') cargarPremium();
        else cargarAnalitica();
        return;
    }

    if (tabla === 'gestion_banners') {
        panelBanners.style.display = 'block';
        if (filtrosCard) filtrosCard.style.display = 'none';
        if (cardTotal) cardTotal.style.display = 'none';
        if (tablaContainer) tablaContainer.style.display = 'none';
        document.getElementById('tituloTabla').textContent = 'Gestión de Banners y Publicidad';
        cargarMetricasBanners();
        return;
    } else {
        panelBanners.style.display = 'none';
        if (cardTotal) cardTotal.style.display = 'grid';
        if (tablaContainer) tablaContainer.style.display = 'block';
    }

    const titulos = {
        'reportes_retiro': 'Solicitudes de Gestión de Residuos',
        'reportes_abandonados': 'Reportes de Problemas de la Ciudad',
        'reportes_violencia_animal': 'Reportes de Violencia Animal',
        'reportes_ciudadania': 'Propuestas y Veeduría - Ciudadanía Activa',
        'usuarios_registrados': 'Listado de Usuarios Registrados',
        'usuarios_bloqueados': 'Gestión de Usuarios Bloqueados (Lista Negra)'
    };
    document.getElementById('tituloTabla').textContent = titulos[tabla] || 'Listado';

    if (tabla === 'usuarios_registrados' || tabla === 'usuarios_bloqueados') {
        if (filtrosCard) filtrosCard.style.display = 'flex';
        if (cardSecundaria) cardSecundaria.style.display = 'none';
        document.getElementById('labelCardTotal').textContent = (tabla === 'usuarios_bloqueados') ? 'Total Usuarios Bloqueados' : 'Total Usuarios Registrados';
    } else {
        if (filtrosCard) filtrosCard.style.display = 'flex';
        if (cardSecundaria) cardSecundaria.style.display = 'block';
        document.getElementById('labelCardTotal').textContent = 'Total de Registros Visibles';
    }

    try {
        const consulta = supabaseClient.from(tabla).select('*').order('created_at', { ascending: false });
        const limite = new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('La consulta tardó demasiado. Cierra otras pestañas de la app, recarga con Ctrl+F5 y vuelve a iniciar sesión.')), 15000));
        const { data, error } = await Promise.race([consulta, limite]);
        if (error) throw error;
        datosOriginales = filtrarPorCompetencia(tabla, data || []);
        aplicarFiltros();
    } catch (err) {
        document.getElementById('cuerpoTabla').innerHTML = `<tr><td colspan="7" style="text-align:center; color:red;">Error: ${err.message}</td></tr>`;
    }
}

function iniciarEscuchaRealtimeAdmin() {
    const tablasMonitoreadas = ['reportes_abandonados', 'reportes_violencia_animal', 'reportes_ciudadania', 'usuarios_registrados'];

    tablasMonitoreadas.forEach(tabla => {
        supabaseClient
            .channel(`admin-realtime-enterprise-${tabla}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: tabla }, payload => {
                if (tabla !== 'usuarios_registrados' && bandejaDisponible(tabla)) {
                    if (alertaActiva('nuevo_reporte')) colaReportesNuevos.push({ tipo: 'reporte', tabla: tabla, data: payload.new });
                    if (document.getElementById('panelAnalitica')?.style.display === 'block') cargarMapaCalor();
                    refrescarContadores();
                    procesarColaAlertas();
                }
            })
            .subscribe();
    });

    supabaseClient
        .channel('admin-realtime-enterprise-chat')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_reportes' }, payload => {
            manejarMensajeCiudadano(payload.new);
        })
        .subscribe();
}

function procesarColaAlertas() {
    if (alertaEnProceso || colaReportesNuevos.length === 0) return;

    alertaEnProceso = true;
    const itemActual = colaReportesNuevos.shift();
    mostrarPopupEmpresarial(itemActual.tabla, itemActual.data, itemActual.tipo);
}

function bandejaDisponible(tabla) {
    const select = document.getElementById('selectBandeja');
    return Array.from(select.options).some(op => op.value === tabla);
}

async function manejarMensajeCiudadano(mensaje) {
    if (!mensaje || mensaje.emisor !== 'usuario') return;
    if (!bandejaDisponible(mensaje.tabla_origen)) return;

    if (reporteActivoChat && String(reporteActivoChat.id) === String(mensaje.reporte_id)) {
        cargarMensajesModalAdmin();
        reproducirBeepEmpresarial();
        return;
    }

    let codigoMostrar = `#${String(mensaje.reporte_id).substring(0, 6)}`;
    try {
        const { data } = await supabaseClient.from(mensaje.tabla_origen).select('codigo').eq('id', mensaje.reporte_id).single();
        if (data && data.codigo) codigoMostrar = `#${data.codigo}`;
    } catch (e) {}

    colaReportesNuevos.push({ tipo: 'chat', tabla: mensaje.tabla_origen, data: { ...mensaje, codigoMostrar: codigoMostrar } });
    procesarColaAlertas();
}

function solicitarPermisoNotificacionesEscritorio() {
    if ('Notification' in window && Notification.permission === 'default') {
        try { Notification.requestPermission(); } catch (e) {}
    }
}

function notificarEscritorio(titulo, cuerpo) {
    if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification(titulo, { body: cuerpo }); } catch (e) {}
    }
}

function mostrarPopupEmpresarial(tabla, nuevoItem, tipo = 'reporte') {
    const popup = document.getElementById('adminPopupAlerta');
    const titulo = document.getElementById('popupTitulo');
    const msg = document.getElementById('popupMensaje');
    const btnVer = document.getElementById('btnPopupVer');

    const nombresTablas = {
        'reportes_retiro': '♻️ Retiro de Residuos',
        'reportes_abandonados': '🗑️ Problema Ciudadano',
        'reportes_violencia_animal': '🐾 Violencia Animal',
        'reportes_ciudadania': '💡 Ciudadanía Activa'
    };

    if (bandejaDisponible(tabla)) {
        document.getElementById('selectBandeja').value = tabla;
    }

    const totalPendientesCola = colaReportesNuevos.length;
    const badgeCola = totalPendientesCola > 0 ? ` <span style="background:#c62828; color:#fff; padding:2px 6px; border-radius:10px; font-size:11px;">+${totalPendientesCola} en cola</span>` : '';

    if (tipo === 'ruta') {
        alertaChatPendiente = null;
        titulo.innerHTML = `⚠️ Baja eficiencia logística${badgeCola}`;
        msg.innerHTML = `<strong>${escaparHTML(nuevoItem.barrio)} (${escaparHTML(nuevoItem.municipio)})</strong><br>Cumplimiento: ${Number(nuevoItem.cumplimiento)}%, por debajo del umbral de ${UMBRAL_EFICIENCIA}%`;
        btnVer.textContent = 'Ver rutas';
        notificarEscritorio('Baja eficiencia en ruta', `${nuevoItem.barrio}: ${nuevoItem.cumplimiento}%`);
    } else if (tipo === 'chat') {
        alertaChatPendiente = { id: nuevoItem.reporte_id, tabla: tabla, codigo: nuevoItem.codigoMostrar };
        const vistaPrevia = String(nuevoItem.mensaje || '').substring(0, 80);

        titulo.innerHTML = `Nuevo Mensaje de Ciudadano 💬${badgeCola}`;
        msg.innerHTML = `<strong>${nombresTablas[tabla] || 'Incidencia'}</strong><br>Reporte ${escaparHTML(nuevoItem.codigoMostrar)}<br><small style="color:#666;">"${escaparHTML(vistaPrevia)}"</small>`;
        btnVer.textContent = 'Abrir chat';
        notificarEscritorio('Nuevo mensaje de ciudadano', `${nuevoItem.codigoMostrar}: ${vistaPrevia}`);
    } else {
        alertaChatPendiente = null;

        titulo.innerHTML = `Nuevo Reporte Entrante${badgeCola}`;
        msg.innerHTML = `<strong>${nombresTablas[tabla] || 'Incidencia'}</strong><br>Código: #${nuevoItem.codigo || nuevoItem.id}<br><small style="color:#666;">Municipio: ${nuevoItem.municipio || 'No especificado'}</small>`;
        btnVer.textContent = 'Actualizar y Ver';
        notificarEscritorio('Nuevo reporte entrante', `${nombresTablas[tabla] || 'Incidencia'} - #${nuevoItem.codigo || nuevoItem.id}`);
    }

    popup.classList.add('activo');
    reproducirBeepEmpresarial();
}

function reproducirBeepEmpresarial() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 587.33;
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.5);
    } catch(e) {}
}

function refrescarYVerAlerta() {
    const popup = document.getElementById('adminPopupAlerta');
    popup.classList.remove('activo');
    alertaEnProceso = false;

    const chatPendiente = alertaChatPendiente;
    alertaChatPendiente = null;

    cargarDatosBandeja().then(() => {
        if (chatPendiente) {
            abrirChatModal(chatPendiente.id, chatPendiente.tabla, chatPendiente.codigo);
        }
        setTimeout(() => {
            procesarColaAlertas();
        }, 400);
    });
}

function aplicarFiltros() {
    const tabla = document.getElementById('selectBandeja').value;

    if (tabla === 'gestion_banners' || tabla === 'gestion_rutas' || tabla === 'superadmin_panel' || tabla === 'inicio_resumen' || String(tabla).startsWith('operacion_')) return;
    if (tabla === 'analitica_kpi') { cargarAnalitica(); return; }
    if (tabla === 'plan_premium') { cargarPremium(); return; }
    const esUsuarios = (tabla === 'usuarios_registrados' || tabla === 'usuarios_bloqueados');

    const estadoSel = document.getElementById('filtroEstado').value;
    const municipioSel = document.getElementById('filtroMunicipio').value;
    const fechaIni = document.getElementById('filtroFechaInicio').value;
    const fechaFin = document.getElementById('filtroFechaFin').value;

    datosFiltrados = datosOriginales.filter(item => {
        if (!esUsuarios && estadoSel !== 'todos' && (item.estado || 'pendiente').toLowerCase() !== estadoSel) return false;
        if (!esUsuarios && tabla !== 'reportes_ciudadania' && municipioSel !== 'todos' && (item.municipio || '').toLowerCase() !== municipioSel.toLowerCase()) return false;

        if (fechaIni) {
            const fechaItem = new Date(item.created_at).toISOString().split('T')[0];
            if (fechaItem < fechaIni) return false;
        }
        if (fechaFin) {
            const fechaItem = new Date(item.created_at).toISOString().split('T')[0];
            if (fechaItem > fechaFin) return false;
        }
        return true;
    });

    renderizarTabla();
}

function renderizarTabla() {
    const tabla = document.getElementById('selectBandeja').value;
    if (tabla === 'gestion_banners' || tabla === 'gestion_rutas' || tabla === 'analitica_kpi' || tabla === 'plan_premium' || tabla === 'superadmin_panel' || tabla === 'inicio_resumen' || String(tabla).startsWith('operacion_')) return;

    const cuerpo = document.getElementById('cuerpoTabla');
    const encabezado = document.getElementById('encabezadoTabla');
    const esListaUsuarios = (tabla === 'usuarios_registrados' || tabla === 'usuarios_bloqueados');

    const btnCerrados = document.getElementById('btnEliminarCerrados');
    if (btnCerrados) btnCerrados.style.display = (puedeEliminarReportes() && ['reportes_abandonados', 'reportes_violencia_animal', 'reportes_ciudadania'].includes(tabla)) ? 'inline-block' : 'none';
    document.getElementById('totalRegistros').textContent = datosFiltrados.length;
    if (!esListaUsuarios) {
        document.getElementById('casosPendientes').textContent = datosFiltrados.filter(r => (r.estado || '').toLowerCase() === 'pendiente').length;
    }

    if (tabla === 'reportes_retiro') {
        encabezado.innerHTML = `<th>Código / Fecha</th><th>Tipo Residuo</th><th>Foto y Descarga</th><th>Ubicación GPS / Ruta</th><th>Municipio</th><th>Estado Actual</th><th>Cambiar Estado</th><th>Acciones</th>`;
    } else if (tabla === 'reportes_abandonados') {
        encabezado.innerHTML = `<th>Código / Fecha</th><th>Afectación</th><th>Foto y Descarga</th><th>Ubicación GPS / Ruta</th><th>Municipio</th><th>Lugar</th><th>Estado Actual</th><th>Cambiar Estado</th><th>Acciones</th>`;
    } else if (tabla === 'reportes_violencia_animal') {
        encabezado.innerHTML = `<th>Código / Fecha</th><th>Tipo Situación</th><th>Foto y Descarga</th><th>Ubicación GPS</th><th>Municipio</th><th>Lugar / Detalle</th><th>Estado Actual</th><th>Cambiar Estado</th><th>Acciones</th>`;
    } else if (tabla === 'reportes_ciudadania') {
        encabezado.innerHTML = `<th>Código / Fecha</th><th>Tipo Propuesta</th><th>Detalle</th><th>Estado Actual</th><th>Cambiar Estado</th><th>Acciones</th>`;
    } else if (tabla === 'usuarios_registrados') {
        encabezado.innerHTML = `<th>Fecha Registro</th><th>Nombre Completo</th><th>Correo Electrónico</th><th>Edad</th><th>Municipio</th><th>Barrio de Residencia</th>`;
    } else if (tabla === 'usuarios_bloqueados') {
        encabezado.innerHTML = `<th>Fecha de Bloqueo</th><th>Correo Electrónico</th><th>Motivo</th><th>Acciones</th>`;
    }

    if (datosFiltrados.length === 0) {
        cuerpo.innerHTML = `<tr><td colspan="9" style="text-align:center;">No hay registros.</td></tr>`;
        return;
    }

    cuerpo.innerHTML = datosFiltrados.map(item => {
        const fecha = new Date(item.created_at).toLocaleString();

        if (tabla === 'usuarios_registrados') {
            return `
                <tr>
                    <td>${fecha}</td>
                    <td><strong>${item.nombre || 'No registrado'}</strong></td>
                    <td>${item.email || 'Sin correo'}</td>
                    <td>${item.edad !== null && item.edad !== undefined ? item.edad : '---'}</td>
                    <td>${item.municipio || '---'}</td>
                    <td>${item.barrio || '---'}</td>
                </tr>
            `;
        }

        if (tabla === 'usuarios_bloqueados') {
            return `
                <tr>
                    <td>${fecha}</td>
                    <td><strong>${escaparHTML(item.email)}</strong></td>
                    <td>${escaparHTML(item.motivo) || '---'}</td>
                    <td><button class="btn-chat-admin" onclick="desbloquearUsuario('${item.id}')">✅ Desbloquear</button></td>
                </tr>
            `;
        }

        const codigo = item.codigo ? `#${item.codigo}` : `#${String(item.id).substring(0,6)}`;
        const estado = (item.estado || 'pendiente').toLowerCase();
        const municipioTexto = item.municipio || 'No especificado';

        let fotoHtml = 'Sin foto';
        if (item.foto_url) {
            const nombreArchivo = `foto_${item.codigo || item.id}.jpg`;
            fotoHtml = `
                <div style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
                    <a href="${item.foto_url}" target="_blank">
                        <img src="${item.foto_url}" style="width:45px; height:45px; object-fit:cover; border-radius:4px; border:1px solid #ccc;">
                    </a>
                    <a href="${item.foto_url}" download="${nombreArchivo}" target="_blank" class="btn-accion-tabla">📥 Descargar</a>
                </div>
            `;
        }

        let gpsHtml = 'No disponible';
        if (item.latitud && item.longitud) {
            const urlMaps = `https://www.google.com/maps/search/?api=1&query=${item.latitud},${item.longitud}`;
            gpsHtml = `
                <div style="font-size:11px; color:#555;">
                    Lat: ${item.latitud}<br>Lon: ${item.longitud}<br>
                    <a href="${urlMaps}" target="_blank" class="gps-link">📍 Ver en Mapa / Ruta</a>
                </div>
            `;
        } else if (item.lugar_gps) {
            gpsHtml = `<span style="font-size:11px; color:#666;">${item.lugar_gps}</span>`;
        }

        let detalleEspecifico = '';
        if (tabla === 'reportes_retiro') {
            detalleEspecifico = `<td>${item.tipo_residuo || item.nombre_reporte || 'Varios'}</td><td>${fotoHtml}</td><td>${gpsHtml}</td><td>${municipioTexto}</td>`;
        } else if (tabla === 'reportes_abandonados') {
            detalleEspecifico = `<td>${item.tipo_afectacion || 'General'}</td><td>${fotoHtml}</td><td>${gpsHtml}</td><td>${municipioTexto}</td><td>${item.lugar_direccion || 'No registrada'}</td>`;
        } else if (tabla === 'reportes_violencia_animal') {
            detalleEspecifico = `<td>${item.tipo_situacion || 'Maltrato'}</td><td>${fotoHtml}</td><td>${gpsHtml}</td><td>${municipioTexto}</td><td>${item.lugar_direccion || ''}<br><small>${item.detalle_situacion || ''}</small></td>`;
        } else {
            detalleEspecifico = `<td>${item.tipo_propuesta || 'Sugerencia'}</td><td>${item.detalle_propuesta || ''}</td>`;
        }

        return `
            <tr>
                <td><strong>${codigo}</strong><br><small style="color:#777">${fecha}</small></td>
                ${detalleEspecifico}
                <td><span class="status-badge status-${estado}">${estado}</span></td>
                <td>
                    <select class="select-estado" onchange="actualizarEstado('${tabla}', '${item.id}', this.value, '${item.codigo || ''}')">
                        <option value="pendiente" ${estado === 'pendiente' ? 'selected' : ''}>Pendiente</option>
                        <option value="en_proceso" ${estado === 'en_proceso' ? 'selected' : ''}>En Proceso</option>
                        <option value="resuelto" ${estado === 'resuelto' ? 'selected' : ''}>Resuelto</option>
                        <option value="cancelada" ${estado === 'cancelada' ? 'selected' : ''}>Cancelada</option>
                    </select>
                </td>
                <td>
                    <button class="btn-chat-admin" onclick="abrirChatModal('${item.id}', '${tabla}', '${codigo}')">💬 Chat</button>
                    ${puedeEliminarReportes() && tabla !== 'reportes_reciclaje' ? `<button class="btn-chat-admin" style="background:#c62828; margin-top:4px;" onclick="eliminarReporte('${tabla}', '${item.id}', '${codigo}')">🗑️ Eliminar</button>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

function limpiarFiltros() {
    document.getElementById('filtroEstado').value = 'todos';
    document.getElementById('filtroMunicipio').value = 'todos';
    document.getElementById('filtroFechaInicio').value = '';
    document.getElementById('filtroFechaFin').value = '';
    aplicarFiltros();
}

/* ==========================================
   ELIMINAR REPORTES + BITÁCORA ANÓNIMA
   Al borrar, el reporte, su foto y su chat desaparecen; queda una fila estadística
   (tipo, municipio, barrio, zona aproximada y tiempos) en reportes_bitacora para KPIs y el Asistente IA.
   El permiso se valida en la base de datos (superadmin y Alcaldía).
   ========================================== */
function puedeEliminarReportes() {
    return !!esSuperadmin || dependenciaUsuario === 'alcaldia';
}

async function eliminarReporte(tabla, id, codigo) {
    if (!confirm(`¿Eliminar el reporte ${codigo}?\n\nSe borrarán el reporte, su foto y su chat.\nSolo quedará el registro estadístico anónimo (tipo, lugar aproximado y tiempos) para los KPIs.`)) return;
    const { error } = await supabaseClient.rpc('eco_eliminar_reporte', { p_tabla: tabla, p_id: String(id) });
    if (error) { alert('No se pudo eliminar: ' + error.message); return; }
    datosOriginales = datosOriginales.filter(r => String(r.id) !== String(id));
    aplicarFiltros();
}

async function eliminarCerradosBandeja() {
    const tabla = document.getElementById('selectBandeja').value;
    const n = datosOriginales.filter(r => ['resuelto', 'cancelada'].includes((r.estado || '').toLowerCase())).length;
    if (!n) { alert('No hay reportes resueltos o cancelados en esta bandeja.'); return; }
    if (!confirm(`¿Eliminar los ${n} reportes resueltos/cancelados de esta bandeja?\n\nSe borran con su chat. Queda la bitácora anónima para los KPIs.`)) return;
    const { data, error } = await supabaseClient.rpc('eco_eliminar_cerrados', { p_tabla: tabla });
    if (error) { alert('No se pudo eliminar: ' + error.message); return; }
    alert(`Se eliminaron ${data} reportes.`);
    datosOriginales = datosOriginales.filter(r => !['resuelto', 'cancelada'].includes((r.estado || '').toLowerCase()));
    aplicarFiltros();
}

async function actualizarEstado(tabla, id, nuevoEstado, codigoItem) {
    try {
        const { error } = await supabaseClient.from(tabla).update({ estado: nuevoEstado }).eq('id', id);
        if (error) throw error;

        if (nuevoEstado === 'resuelto') {
            const horaHora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const msgResuelto = `Hola,\n\nTu aviso ${codigoItem ? 'nº ' + codigoItem : ''} ha sido atendido y resuelto por el personal de la Alcaldía de Bucaramanga / Ciudad Limpia.\n\nGracias por reportar y ayudar a proteger nuestra ciudad y bienestar animal 🐾`;

            await supabaseClient.from('chat_reportes').insert([
                { reporte_id: id, tabla_origen: tabla, mensaje: msgResuelto, emisor: 'institucion', hora: horaHora }
            ]);
        }

        alert("¡Estado actualizado correctamente!");
        const item = datosOriginales.find(r => String(r.id) === String(id));
        if (item) item.estado = nuevoEstado;
        aplicarFiltros();
    } catch (err) {
        alert("Error al actualizar estado: " + err.message);
    }
}

async function bloquearUsuario() {
    const email = (document.getElementById('bloqueoEmail').value || '').trim().toLowerCase();
    const motivo = (document.getElementById('bloqueoMotivo').value || '').trim();

    if (!email || !email.includes('@')) {
        alert("Escribe un correo electrónico válido.");
        return;
    }

    try {
        const { data: existente, error: errorBusqueda } = await supabaseClient
            .from('usuarios_bloqueados')
            .select('email')
            .eq('email', email)
            .limit(1);
        if (errorBusqueda) throw errorBusqueda;

        if (existente && existente.length > 0) {
            alert("Este usuario ya se encuentra bloqueado.");
            return;
        }

        const { error } = await supabaseClient.from('usuarios_bloqueados').insert([{ email: email, motivo: motivo }]);
        if (error) throw error;

        document.getElementById('bloqueoEmail').value = '';
        document.getElementById('bloqueoMotivo').value = '';
        alert("Usuario bloqueado correctamente.");
        await cargarDatosBandeja();
    } catch (err) {
        alert("Error al bloquear usuario: " + err.message);
    }
}

async function desbloquearUsuario(id) {
    const usuario = datosOriginales.find(r => String(r.id) === String(id));
    const etiqueta = usuario && usuario.email ? usuario.email : 'este usuario';
    if (!confirm(`¿Deseas desbloquear a ${etiqueta}?`)) return;

    try {
        const { error } = await supabaseClient.from('usuarios_bloqueados').delete().eq('id', id);
        if (error) throw error;

        alert("Usuario desbloqueado correctamente.");
        await cargarDatosBandeja();
    } catch (err) {
        alert("Error al desbloquear usuario: " + err.message);
    }
}

async function abrirChatModal(id, tablaOrigen, codigo) {
    reporteActivoChat = { id, tablaOrigen, codigo };
    document.getElementById('chatModalTitulo').textContent = `Chat - Reporte ${codigo}`;
    document.getElementById('modalChatAdmin').classList.add('activo');
    await cargarMensajesModalAdmin();
}

function cerrarChatModal() {
    document.getElementById('modalChatAdmin').classList.remove('activo');
    reporteActivoChat = null;
}

async function cargarMensajesModalAdmin() {
    if (!reporteActivoChat) return;
    const body = document.getElementById('chatModalBody');

    try {
        const { data, error } = await supabaseClient
            .from('chat_reportes')
            .select('*')
            .eq('reporte_id', String(reporteActivoChat.id))
            .eq('tabla_origen', reporteActivoChat.tablaOrigen)
            .order('created_at', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            body.innerHTML = `<p style="text-align:center; color:#888; font-size:13px; margin-top:20px;">Sin mensajes registrados en este chat.</p>`;
            return;
        }

        body.innerHTML = data.map(m => `
            <div class="chat-msg ${m.emisor === 'institucion' ? 'institucion' : 'usuario'}">
                <strong>${m.emisor === 'institucion' ? 'Administrador' : 'Ciudadano'}:</strong>
                <p style="margin-top:4px;">${m.mensaje.replace(/\n/g, '<br>')}</p>
                <span class="msg-time">${m.hora || ''}</span>
            </div>
        `).join('');

        body.scrollTop = body.scrollHeight;
    } catch (err) {
        body.innerHTML = `<p style="color:red; text-align:center;">Error al cargar mensajes: ${err.message}</p>`;
    }
}

async function enviarMensajeAdmin() {
    const input = document.getElementById('inputChatAdmin');
    const mensaje = input.value.trim();
    if (!mensaje || !reporteActivoChat) return;

    const horaAhora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    try {
        const { error } = await supabaseClient.from('chat_reportes').insert([
            {
                reporte_id: String(reporteActivoChat.id),
                tabla_origen: reporteActivoChat.tablaOrigen,
                mensaje: mensaje,
                emisor: 'institucion',
                hora: horaAhora
            }
        ]);

        if (error) throw error;

        input.value = '';
        await cargarMensajesModalAdmin();
    } catch (err) {
        alert("Error al enviar mensaje: " + err.message);
    }
}

function exportarExcel() {
    if (!datosFiltrados.length) { alert("No hay datos para exportar."); return; }
    const tabla = document.getElementById('selectBandeja').value;
    if (tabla === 'gestion_banners') return;

    if (tabla === 'gestion_rutas' || tabla === 'analitica_kpi' || tabla === 'plan_premium' || tabla === 'superadmin_panel' || tabla === 'inicio_resumen' || String(tabla).startsWith('operacion_')) return;
    let columnas = ["Código", "Fecha", "Nombre Reporte", "Estado", "Latitud", "Longitud"];
    let claveCampos = ["codigo", "created_at", "nombre_reporte", "estado", "latitud", "longitud"];

    if (tabla === 'usuarios_registrados') {
        columnas = ["Fecha Registro", "Nombre Completo", "Correo Electrónico", "Edad", "Municipio", "Barrio de Residencia"];
        claveCampos = ["created_at", "nombre", "email", "edad", "municipio", "barrio"];
    } else if (tabla === 'usuarios_bloqueados') {
        columnas = ["Fecha de Bloqueo", "Correo Electrónico", "Motivo"];
        claveCampos = ["created_at", "email", "motivo"];
    } else if (tabla !== 'reportes_ciudadania') {
        columnas.push("Municipio");
        claveCampos.push("municipio");
    }

    let contenidoCSV = "\uFEFF" + columnas.join(";") + "\n";
    datosFiltrados.forEach(row => {
        let fila = claveCampos.map(clave => `"${String(row[clave] || '').replace(/"/g, '""')}"`);
        contenidoCSV += fila.join(";") + "\n";
    });

    const blob = new Blob([contenidoCSV], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${tabla}_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
}

/* ==========================================
   RUTAS, LOGÍSTICA, KPIs Y ASISTENTE IA
========================================== */
let UMBRAL_EFICIENCIA = 70;
const TABLAS_REPORTES = ['reportes_abandonados', 'reportes_violencia_animal', 'reportes_ciudadania'];
const NOMBRES_TABLAS = { reportes_abandonados: 'Problemas de la ciudad', reportes_violencia_animal: 'Violencia animal', reportes_ciudadania: 'Ciudadanía activa' };
let rutasDatos = [];
const alertasRutaRecientes = {};

function alternarTipoEnlaceBanner() {
    const esUrl = document.getElementById('bannerTipoEnlace').value === 'url';
    document.getElementById('grupoBannerUrl').style.display = esUrl ? 'flex' : 'none';
    document.getElementById('grupoBannerNota').style.display = esUrl ? 'none' : 'flex';
}

function claseCumplimiento(p) { return p < UMBRAL_EFICIENCIA ? 'pct-bajo' : (p < 90 ? 'pct-medio' : 'pct-alto'); }
function claseEstadoRuta(e) { return { programada: 'pendiente', en_curso: 'en_proceso', completada: 'resuelto', incumplida: 'cancelada', suspendida: 'cancelada' }[e] || 'pendiente'; }

async function cargarRutas() {
    try {
        const { data, error } = await supabaseClient.from('rutas_recoleccion').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        rutasDatos = data || [];
        renderizarRutas();
        iniciarMapaRutas();
        cargarPlanesGuardados();
    } catch (err) {
        document.getElementById('cuerpoTablaRutas').innerHTML = `<tr><td colspan="7" style="text-align:center; color:red;">Error: ${escaparHTML(err.message)} (¿ejecutaste cambios_supabase.sql?)</td></tr>`;
    }
}

function renderizarRutas() {
    const mun = document.getElementById('filtroRutaMunicipio').value;
    const est = document.getElementById('filtroRutaEstado').value;
    const d1 = document.getElementById('filtroRutaDesde').value;
    const d2 = document.getElementById('filtroRutaHasta').value;
    const lista = rutasDatos.filter(r => (mun === 'todos' || r.municipio === mun) && (est === 'todos' || r.estado_recorrido === est)
        && (!d1 || (r.created_at || '').slice(0, 10) >= d1) && (!d2 || (r.created_at || '').slice(0, 10) <= d2));
    const bajas = lista.filter(r => Number(r.cumplimiento) < UMBRAL_EFICIENCIA).length;
    document.getElementById('rutasResumen').innerHTML = `${lista.length} ruta(s) visibles` + (bajas ? ` · <strong style="color:#b71c1c;">⚠️ ${bajas} por debajo del ${UMBRAL_EFICIENCIA}%</strong>` : '');
    document.getElementById('cuerpoTablaRutas').innerHTML = lista.length ? lista.map(r => {
        const p = Number(r.cumplimiento) || 0;
        return `<tr>
            <td><strong>${escaparHTML(r.barrio)}</strong><br><small style="color:#777;">${escaparHTML(r.tipo_servicio || '')}</small></td><td>${escaparHTML(r.municipio)}</td><td>${escaparHTML(r.dia_semana)}</td><td>${escaparHTML(r.hora_estimada)}</td>
            <td><span class="pct-badge ${claseCumplimiento(p)}">${p}%</span>${p < UMBRAL_EFICIENCIA ? ' ⚠️' : ''}</td>
            <td><span class="status-badge status-${claseEstadoRuta(r.estado_recorrido)}">${escaparHTML((r.estado_recorrido || '').replace('_', ' '))}</span></td>
            <td><button class="btn-chat-admin" onclick="avisarPasoCamion('${r.id}')">🔔 Avisar paso</button>
                ${r.plan_id ? `<button class="btn-chat-admin" onclick="editarPlan('${r.plan_id}')">🗺️ Ver ruta</button>` : ''}
                <button class="btn-logout" style="padding:6px 10px; font-size:12px;" onclick="eliminarRuta('${r.id}')">🗑️</button></td>
        </tr>`;
    }).join('') : `<tr><td colspan="7" style="text-align:center;">No hay rutas registradas.</td></tr>`;
}

async function eliminarRuta(id) {
    if (!confirm("¿Eliminar esta ruta?")) return;
    try {
        const { error } = await supabaseClient.from('rutas_recoleccion').delete().eq('id', id);
        if (error) throw error;
        await cargarRutas();
    } catch (err) {
        alert("No se pudo eliminar: " + err.message);
    }
}

// Alerta automática de baja eficiencia (< umbral)
function encolarAlertaRuta(ruta) {
    if (!ruta || !alertaActiva('baja_eficiencia') || Number(ruta.cumplimiento) >= UMBRAL_EFICIENCIA) return;
    const k = `${ruta.id}:${ruta.cumplimiento}`;
    if (alertasRutaRecientes[k] && Date.now() - alertasRutaRecientes[k] < 10000) return;
    alertasRutaRecientes[k] = Date.now();
    colaReportesNuevos.push({ tipo: 'ruta', tabla: 'gestion_rutas', data: ruta });
    procesarColaAlertas();
}

function escucharRutasAdmin() {
    supabaseClient.channel('admin-realtime-rutas')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rutas_recoleccion' }, payload => {
            if (payload.eventType !== 'DELETE') encolarAlertaRuta(payload.new);
            if (document.getElementById('selectBandeja').value === 'gestion_rutas') cargarRutas();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rutas_planes' }, () => {
            if (document.getElementById('selectBandeja').value === 'gestion_rutas') cargarPlanesGuardados();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rutas_novedades' }, () => {
            if (document.getElementById('selectBandeja').value === 'gestion_rutas') cargarPlanesGuardados();
        })
        .subscribe();
}

function formatoHoras(h) {
    if (h === null) return 'N/D';
    if (h < 1) return Math.round(h * 60) + ' min';
    return h < 48 ? h.toFixed(1) + ' h' : (h / 24).toFixed(1) + ' días';
}

// KPIs: ICLR, Tasa de Resolución y TPR + recomendaciones del Asistente IA
async function cargarAnalitica() {
    cargarMapaCalor();
    analitica.cargarPanorama();
}

async function cargarPremium() {
    const nota = document.getElementById('notaPremiumAdmin');
    if (nota) nota.style.display = esSuperadmin ? '' : 'none';
    const premium = await planPremiumActivo(true);
    document.getElementById('bloquePremium').style.display = premium ? 'block' : 'none';
    document.getElementById('avisoPremium').style.display = premium ? 'none' : 'block';
    if (premium) analitica.cargarPremium();
}

/* ==========================================
   BITÁCORA HISTÓRICA (KPIs de casos ya cerrados o depurados) + recomendaciones IA
   ========================================== */
function formatoMin(m) {
    if (m === null || m === undefined) return 'N/D';
    return formatoHoras(Number(m) / 60);
}

function recomendacionesBitacora(r) {
    const recs = [];
    const cats = (r.por_categoria || []).filter(c => c.prom_cierre_min !== null && c.total >= 3);
    const lenta = cats.slice().sort((a, b) => b.prom_cierre_min - a.prom_cierre_min)[0];
    if (lenta && lenta.prom_cierre_min > 72 * 60)
        recs.push({ t: 'alerta', m: `🐢 <b>${escaparHTML(lenta.categoria)}</b> tarda en promedio ${formatoMin(lenta.prom_cierre_min)} en cerrarse (${lenta.total} casos). Revisar recursos y protocolo de esa bandeja.` });
    const muns = (r.por_municipio || []);
    if (muns.length > 1 && r.total >= 10 && muns[0].total / r.total >= 0.5)
        recs.push({ t: '', m: `📍 <b>${escaparHTML(muns[0].municipio)}</b> concentra el ${Math.round(muns[0].total / r.total * 100)}% de los casos históricos. Evaluar presencia permanente de cuadrilla allí.` });
    const bar = (r.por_barrio || [])[0];
    if (bar && bar.total >= 3)
        recs.push({ t: '', m: `🏘️ El barrio con más casos históricos es <b>${escaparHTML(bar.barrio)}</b> (${escaparHTML(bar.municipio || '')}, ${bar.total}). Candidato a ruta o campaña de cultura ciudadana.` });
    const tipo = (r.por_tipo || [])[0];
    if (tipo && tipo.total >= 5 && r.total && tipo.total / r.total >= 0.3)
        recs.push({ t: '', m: `♻️ El tipo de novedad más repetido es <b>${escaparHTML(tipo.tipo)}</b> (${Math.round(tipo.total / r.total * 100)}% del histórico). Reforzar la prevención y la información sobre ese caso.` });
    const meses = r.por_mes || [];
    if (meses.length >= 2) {
        const ult = meses[meses.length - 1].total, ant = meses[meses.length - 2].total;
        if (ant >= 5 && ult >= ant * 1.3)
            recs.push({ t: 'alerta', m: `📈 Los reportes del último mes (${ult}) subieron ${Math.round((ult / ant - 1) * 100)}% frente al mes anterior (${ant}). Anticipar capacidad operativa.` });
    }
    return recs;
}

async function renderBitacora(iaCont) {
    const cont = document.getElementById('bitacoraContenido');
    if (!cont) return;
    const mun = document.getElementById('filtroMunicipio').value;
    const d1 = document.getElementById('filtroFechaInicio').value || null;
    const d2 = document.getElementById('filtroFechaFin').value || null;
    const { data: r, error } = await supabaseClient.rpc('eco_bitacora_resumen', { p_desde: d1, p_hasta: d2, p_municipio: mun });
    if (error || !r) {
        cont.innerHTML = `<p style="color:#b91c1c; font-size:13px;">${escaparHTML(error ? error.message : 'Sin datos')} (¿ejecutaste 22_ECOSTAN_bitacora_reportes.sql?)</p>`;
        return;
    }
    const tarjeta = (t, v, n) => `<div class="kpi-card"><h4>${t}</h4><div class="kpi-valor">${v}</div><small>${n}</small></div>`;
    const tabla = (cab, filas) => `<div style="overflow-x:auto; margin:8px 0 14px;"><table><thead><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas.join('') || `<tr><td colspan="${cab.length}" style="text-align:center;">Sin datos</td></tr>`}</tbody></table></div>`;
    const maxMes = Math.max(1, ...(r.por_mes || []).map(m => m.total));
    cont.innerHTML = `
        <div class="kpi-grid">
            ${tarjeta('Casos archivados', r.total, 'Cerrados o depurados')}
            ${tarjeta('Resueltos', r.resueltos, `${r.cancelados} cancelados · ${r.eliminados_sin_cerrar} borrados sin cerrar`)}
            ${tarjeta('Tiempo medio de 1ª respuesta', formatoMin(r.prom_primera_respuesta_min), 'Desde que se reporta')}
            ${tarjeta('Tiempo medio de cierre', formatoMin(r.prom_cierre_min), 'Solo casos resueltos')}
        </div>
        <h4 style="margin:10px 0 4px;">Por categoría</h4>
        ${tabla(['Categoría', 'Casos', '1ª respuesta', 'Cierre'], (r.por_categoria || []).map(c => `<tr><td>${escaparHTML(c.categoria)}</td><td>${c.total}</td><td>${formatoMin(c.prom_resp_min)}</td><td>${formatoMin(c.prom_cierre_min)}</td></tr>`))}
        <h4 style="margin:10px 0 4px;">Por municipio</h4>
        ${tabla(['Municipio', 'Casos', 'Cierre medio'], (r.por_municipio || []).map(c => `<tr><td>${escaparHTML(c.municipio)}</td><td>${c.total}</td><td>${formatoMin(c.prom_cierre_min)}</td></tr>`))}
        <h4 style="margin:10px 0 4px;">Barrios con más casos</h4>
        ${tabla(['Barrio', 'Municipio', 'Casos'], (r.por_barrio || []).map(c => `<tr><td>${escaparHTML(c.barrio)}</td><td>${escaparHTML(c.municipio || '')}</td><td>${c.total}</td></tr>`))}
        <h4 style="margin:10px 0 4px;">Tipos de novedad más frecuentes</h4>
        ${tabla(['Tipo', 'Casos'], (r.por_tipo || []).map(c => `<tr><td>${escaparHTML(c.tipo)}</td><td>${c.total}</td></tr>`))}
        <h4 style="margin:10px 0 4px;">Casos por mes</h4>
        <div>${(r.por_mes || []).map(m => `<div style="display:flex; align-items:center; gap:8px; font-size:12px; margin:3px 0;"><span style="width:70px;">${escaparHTML(m.mes)}</span><div style="background:#2e7d32; height:12px; border-radius:6px; width:${Math.max(4, Math.round(m.total / maxMes * 70))}%;"></div><span>${m.total}</span></div>`).join('') || '<p style="font-size:12px; color:#888;">Sin datos</p>'}</div>`;

    const recs = recomendacionesBitacora(r);
    if (iaCont && recs.length) {
        iaCont.insertAdjacentHTML('beforeend', `<p style="font-size:11px; color:#777; margin:14px 0 8px;">Con base en el histórico archivado (${r.total} casos):</p>` +
            recs.map(x => `<div class="ia-item ${x.t}">${x.m}</div>`).join(''));
    }
}

async function exportarBitacora() {
    const mun = document.getElementById('filtroMunicipio').value;
    const d1 = document.getElementById('filtroFechaInicio').value || null;
    const d2 = document.getElementById('filtroFechaFin').value || null;
    const { data, error } = await supabaseClient.rpc('eco_bitacora_listar', { p_desde: d1, p_hasta: d2, p_municipio: mun, p_solo_borrados: false });
    if (error) { alert('No se pudo exportar: ' + error.message); return; }
    const cols = ['creado_at', 'categoria', 'tipo', 'municipio', 'barrio', 'zona_lat', 'zona_lng', 'estado_final', 'min_primera_respuesta', 'min_cierre', 'cerrado_at', 'eliminado_at', 'motivo_eliminacion'];
    const celda = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
    const csv = '\uFEFF' + cols.join(',') + '\n' + (data || []).map(f => cols.map(c => celda(f[c])).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = 'bitacora_reportes_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
}

/* ==========================================
   SUPERADMIN, PERMISOS POR DEPENDENCIA, PLAN PREMIUM Y MAPA DE CALOR
========================================== */
const BANDEJAS_CONFIG = { reportes_abandonados: 'Problemas de la ciudad', reportes_violencia_animal: 'Violencia animal', reportes_ciudadania: 'Ciudadanía activa', usuarios_registrados: 'Usuarios registrados', usuarios_bloqueados: 'Usuarios bloqueados', gestion_banners: 'Banners', gestion_rutas: 'Rutas y logística', operacion_recicladores: 'Recicladores (CicloGo)', operacion_pesajes: 'Báscula y pesajes (CicloGo)', operacion_ecas: 'Empresas ECA (CicloGo)', analitica_kpi: 'Analítica ejecutiva' };
const SUPERADMIN_EMAILS = ['superadmin@ecostan.com']; // solo muestra el menú; la seguridad real la dan las políticas RLS
// Permisos por defecto: se usan mientras el superadmin no haya guardado una configuración propia
const DEFECTO_BANDEJAS = {
    alcaldia: Object.keys(BANDEJAS_CONFIG),
    aseo: ['gestion_rutas', 'operacion_pesajes'],
    recicladores: ['operacion_recicladores', 'operacion_pesajes'],
    publicidad: ['gestion_banners'],
    marketing: ['gestion_banners']
};
let alcanceActual = { limitado: false }, esSuperadmin = false, configDependencia = null, usuariosPanel = [], emailActual = '', permisosPromesa = null;
let mapaCalor = null, capaCalor = null;
const listaCSV = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

// Cuenta activa + dependencia + bandejas permitidas
async function aplicarPermisosDependencia() {
    try {
        // El correo se toma de la sesión de Supabase o, si el login no la usa, de lo guardado en el navegador
        const { data: ses } = await supabaseClient.auth.getUser();
        let email = ((ses && ses.user && ses.user.email) || '').toLowerCase();
        if (!email) { window.location.href = RUTAS.loginAdmin; return; }
        emailActual = email;
        if (email) {
            const { data: fila } = await supabaseClient.from('usuarios_panel').select('*').eq('email', email).maybeSingle();
            if (fila) {
                if (fila.activo === false) { alert("Tu cuenta está desactivada. Contacta al administrador del sistema."); cerrarSesion(); return; }
                dependenciaUsuario = (fila.dependencia || '').toLowerCase();
                guardarDependenciaAdmin(dependenciaUsuario);
            }
        }
        // Dueño del sistema: por dependencia, por rol guardado o por correo de arranque
        esSuperadmin = (dependenciaUsuario === 'superadmin' || datosAdminApp().rol === 'superadmin' || SUPERADMIN_EMAILS.includes(email));
        if (esSuperadmin) dependenciaUsuario = 'superadmin';
        console.info('[Panel] correo:', email || '(sin sesión)', '| dependencia:', dependenciaUsuario, '| superadmin:', esSuperadmin);
        const { data: cfg } = await supabaseClient.from('config_dependencias').select('*').eq('dependencia', dependenciaUsuario).maybeSingle();
        configDependencia = cfg || null;

        alcanceActual = { limitado: false };
        if (!esSuperadmin) { const { data: al } = await supabaseClient.rpc('eco_mi_alcance'); if (al) alcanceActual = al; }
        if (alcanceActual.limitado && alcanceActual.organizacion && alcanceActual.organizacion.activo === false) { alert("La organización de tu cuenta está suspendida. Contacta al administrador."); cerrarSesion(); return; }
        let permitidas = (cfg && Array.isArray(cfg.bandejas) && cfg.bandejas.length) ? cfg.bandejas : DEFECTO_BANDEJAS[dependenciaUsuario];
        if (!esSuperadmin && Array.isArray(alcanceActual.modulos) && alcanceActual.modulos.length) permitidas = alcanceActual.modulos;   // módulos fijados por el superadmin
        limitarMunicipios();
        const select = document.getElementById('selectBandeja');
        Array.from(select.options).forEach(op => {
            if (op.value === 'inicio_resumen' || op.value === 'plan_premium') return;   // el resumen general y el Plan Premium (con aviso si no lo tiene) los ve todo el personal
            if (op.value === 'superadmin_panel') { if (!esSuperadmin) op.remove(); return; }
            if (esSuperadmin) return;
            if (permitidas && !permitidas.includes(op.value)) op.remove();
        });
        if (!Array.from(select.options).some(o => o.value === select.value)) select.selectedIndex = 0;
        actualizarChipUsuario();
        construirMenuLateral();
        await cargarConfigAlertas();
        prepararOrigenBanner();
        cargarDatosBandeja();
        refrescarContadores();
    } catch (e) { console.warn("No se pudieron aplicar los permisos:", e); }
}

// Deja en los selectores solo los municipios de la organización
function limitarMunicipios() {
    if (!alcanceActual.limitado) return;
    const permitidos = (alcanceActual.municipios || []).map(normTxt);
    ['filtroMunicipio', 'bannerMunicipio', 'mapaRutaMun', 'filtroRutaMunicipio'].forEach(id => {
        const s = document.getElementById(id); if (!s) return;
        Array.from(s.options).forEach(o => { const v = o.value || o.textContent; if (['todos', 'Todos'].includes(v)) return; if (!permitidos.includes(normTxt(v))) o.remove(); });
        const hay = Array.from(s.options).filter(o => !['todos', 'Todos'].includes(o.value));
        if (hay.length === 1) { s.value = hay[0].value || hay[0].textContent; }
        else if (!hay.length) s.innerHTML = '<option value="todos">Sin municipios asignados</option>';
    });
}

// Solo muestra los tipos de reporte de competencia de la dependencia
function filtrarPorCompetencia(tabla, lista) {
    if (esSuperadmin || !configDependencia) return lista;
    const mapa = { reportes_retiro: ['tipos_residuo', ['tipo_residuo', 'nombre_reporte']], reportes_abandonados: ['tipos_afectacion', ['tipo_afectacion']], reportes_violencia_animal: ['tipos_afectacion', ['tipo_situacion']] };
    const def = mapa[tabla];
    if (!def) return lista;
    const permitidos = (configDependencia[def[0]] || []).map(normTxt);
    if (!permitidos.length) return lista;
    return lista.filter(r => {
        const t = normTxt(def[1].map(k => r[k]).find(Boolean));
        return permitidos.some(p => t.includes(p) || (t && p.includes(t)));
    });
}

// Premium = superadmin, o la dependencia lo tiene activo, o el usuario lo tiene activo
async function planPremiumActivo() {
    try { if (permisosPromesa) await permisosPromesa; } catch (e) {}
    if (esSuperadmin) return true;
    try {
        const [dep, usr] = await Promise.all([
            supabaseClient.from('config_dependencias').select('premium').eq('dependencia', dependenciaUsuario).maybeSingle(),
            supabaseClient.from('usuarios_panel').select('premium').eq('email', emailActual).maybeSingle()
        ]);
        return !!(dep.data && dep.data.premium) || !!(usr.data && usr.data.premium);
    } catch (e) { return false; }
}

// Mapa de calor general (todas las dependencias)
async function cargarMapaCalor() {
    const cont = document.getElementById('mapaCalor');
    const info = document.getElementById('mapaCalorInfo');
    if (!cont || !window.L || !L.heatLayer) { if (info) info.textContent = 'No se pudo cargar la librería del mapa.'; return; }
    if (!mapaCalor) {
        mapaCalor = L.map('mapaCalor').setView([7.1193, -73.1227], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(mapaCalor);
    }
    setTimeout(() => mapaCalor.invalidateSize(), 200);
    const mun = document.getElementById('filtroMunicipio').value;
    const d1 = document.getElementById('filtroFechaInicio').value;
    const d2 = document.getElementById('filtroFechaFin').value;
    try {
        const res = await Promise.all(['reportes_abandonados', 'reportes_violencia_animal'].map(t => supabaseClient.from(t).select('latitud,longitud,estado,municipio,created_at')));
        const puntos = [];
        res.forEach(r => (r.data || []).forEach(p => {
            const lat = parseFloat(p.latitud), lng = parseFloat(p.longitud), f = (p.created_at || '').slice(0, 10);
            if (isNaN(lat) || isNaN(lng)) return;
            if (mun !== 'todos' && p.municipio !== mun) return;
            if ((d1 && f < d1) || (d2 && f > d2)) return;
            puntos.push([lat, lng, p.estado === 'resuelto' ? 0.4 : 1]);
        }));
        if (capaCalor) mapaCalor.removeLayer(capaCalor);
        capaCalor = L.heatLayer(puntos, { radius: 25, blur: 20, maxZoom: 15 }).addTo(mapaCalor);
        if (puntos.length) mapaCalor.fitBounds(puntos.map(p => [p[0], p[1]]), { padding: [30, 30], maxZoom: 15 });
        info.textContent = `${puntos.length} reporte(s) georreferenciados. Las zonas más intensas concentran más reportes pendientes.`;
    } catch (err) { info.textContent = 'Error al cargar el mapa: ' + err.message; }
}

/* ---------- Panel Superadministrador ---------- */
function cargarSuperadmin() { territorios.cargar(); territorios.montarFormUsuario(); cargarUsuariosPanel(); renderConfigDependencias(); renderConfigAlertas(); renderHistorialNotificaciones(); renderErroresApp(); cargarMantenimiento(); }

async function cargarUsuariosPanel() {
    const c = document.getElementById('cuerpoUsuariosPanel');
    const { data, error } = await supabaseClient.from('usuarios_panel').select('*').order('created_at', { ascending: false });
    if (error) { c.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center;">Error: ${escaparHTML(error.message)} (¿ejecutaste cambios_supabase.sql?)</td></tr>`; return; }
    usuariosPanel = data || [];
    c.innerHTML = usuariosPanel.length ? usuariosPanel.map(u => `<tr>
        <td><strong>${escaparHTML(u.nombre)}</strong></td><td>${escaparHTML(u.email)}</td><td>${escaparHTML(u.dependencia)}</td>
        <td><span class="status-badge ${u.activo ? 'status-resuelto' : 'status-cancelada'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td><button class="btn-chat-admin" onclick="alternarUsuarioPanel('${u.id}', ${!u.activo})">${u.activo ? '⏸️ Desactivar' : '▶️ Activar'}</button>
            <button class="btn-chat-admin" onclick="editarUsuarioPanel('${u.id}')">✏️ Editar</button>
            <button class="btn-chat-admin" onclick="restablecerClaveUsuario('${escaparHTML(u.email)}')">📧 Restablecer clave</button>
            <button class="btn-chat-admin" style="background:${u.premium ? '#f9a825' : '#888'};" onclick="alternarPremiumUsuario('${u.id}', ${!u.premium})">${u.premium ? '💎 Premium: Sí' : '💎 Premium: No'}</button></td>
    </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;">Sin usuarios registrados.</td></tr>`;
}

async function crearUsuarioPanel(e) {
    e.preventDefault();
    const nombre = document.getElementById('usrNombre').value.trim();
    const email = document.getElementById('usrEmail').value.trim().toLowerCase();
    const clave = document.getElementById('usrClave').value;
    const dependencia = document.getElementById('usrDependencia').value;
    const errOrg = territorios.validarFormUsuario(); if (errOrg) { alert(errOrg); return; }
    try {
        let userId = null;
        if (!document.getElementById('usrYaExiste').checked) {
            if (clave.length < 6) throw new Error("La clave debe tener al menos 6 caracteres.");
            // Cliente auxiliar: no reemplaza la sesión del superadministrador
            const aux = crearClienteSinSesion();
            const { data: alta, error: eAuth } = await aux.auth.signUp({ email, password: clave, options: { data: { nombre } } });
            if (eAuth) throw eAuth;
            if (!alta.user || (alta.user.identities && alta.user.identities.length === 0)) throw new Error("Ese correo ya tiene una cuenta. Usa la casilla \"La cuenta ya existe\".");
            userId = alta.user.id;
            // El login exige una fila en profiles para permitir el acceso al panel
            const { error: eProf } = await supabaseClient.from('profiles').upsert([{ id: userId, email, rol: dependencia === 'superadmin' ? 'superadmin' : 'admin', dependencia }]);
            if (eProf) throw new Error("La cuenta se creó pero no se pudo registrar su perfil: " + eProf.message);
        }
        const { data: filaU, error } = await supabaseClient.from('usuarios_panel').insert([{ nombre, email, dependencia, activo: true, user_id: userId }]).select().single();
        if (error) throw error;
        const orgCreada = await territorios.vincularUsuario(filaU.id);
        document.getElementById('formUsuarioPanel').reset();
        await cargarUsuariosPanel();
        alert("Usuario registrado" + (orgCreada ? " y vinculado a " + orgCreada.nombre + " con sus módulos por defecto" : "") + ". Si tu proyecto exige confirmación por correo, deberá confirmarlo antes de ingresar.");
        territorios.cargar(); territorios.montarFormUsuario();
    } catch (err) { alert("Error al registrar el usuario: " + err.message); }
}

async function alternarUsuarioPanel(id, activo) {
    const u = usuariosPanel.find(x => String(x.id) === String(id));
    if (!u || (!activo && !confirm(`¿Desactivar la cuenta de ${u.email}? No podrá usar el panel.`))) return;
    const { error } = await supabaseClient.from('usuarios_panel').update({ activo }).eq('id', id);
    if (error) alert("Error: " + error.message); else cargarUsuariosPanel();
}

async function editarUsuarioPanel(id) {
    const u = usuariosPanel.find(x => String(x.id) === String(id));
    if (!u) return;
    const nombre = prompt("Nombre / Entidad:", u.nombre);
    if (nombre === null) return;
    const dependencia = (prompt("Dependencia (alcaldia, aseo, recicladores, publicidad, superadmin):", u.dependencia) || '').trim().toLowerCase();
    if (!['alcaldia', 'aseo', 'recicladores', 'publicidad', 'superadmin'].includes(dependencia)) { alert("Dependencia no válida."); return; }
    const { error } = await supabaseClient.from('usuarios_panel').update({ nombre: nombre.trim(), dependencia }).eq('id', id);
    if (error) alert("Error: " + error.message); else cargarUsuariosPanel();
}

async function restablecerClaveUsuario(email) {
    if (!confirm(`¿Enviar a ${email} un correo para restablecer su clave?`)) return;
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: RUTAS.login });
    alert(error ? "Error: " + error.message : "Correo de restablecimiento enviado.");
}

async function renderConfigDependencias() {
    const cont = document.getElementById('configDependencias');
    const { data } = await supabaseClient.from('config_dependencias').select('*');
    const porDep = {};
    (data || []).forEach(c => { porDep[c.dependencia] = c; });
    let detectados = '';
    try {
        detectados = '';
    } catch (e) {}
    cont.innerHTML = ['alcaldia', 'aseo', 'recicladores', 'publicidad'].map(dep => {
        const c = porDep[dep] || {};
        const marcadas = (c.bandejas && c.bandejas.length) ? c.bandejas : DEFECTO_BANDEJAS[dep];
        return `<div class="cfg-dependencia" id="cfg-${dep}">
            <h4>${dep} ${porDep[dep] ? '<small style="color:#2e7d32;">✅ guardado</small>' : '<small style="color:#c62828;">⚠️ sin guardar (valores por defecto)</small>'}</h4>
            <div class="chk-grid">${Object.entries(BANDEJAS_CONFIG).map(([k, n]) => `<label><input type="checkbox" class="cfg-bandeja" value="${k}" ${marcadas.includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}</div>
            <label style="font-size:13px; display:block; margin-bottom:12px;"><input type="checkbox" class="cfg-premium" ${c.premium ? 'checked' : ''}> 💎 Módulo Premium (KPIs + Asistente IA) para toda la dependencia</label>
            <div class="form-banner-grid">
                <div class="form-banner-group"><label>Tipos de residuo permitidos (separados por coma):</label><input type="text" class="cfg-residuos" value="${escaparHTML((c.tipos_residuo || []).join(', '))}" placeholder="Ej: ordinarios, escombros"></div>
                <div class="form-banner-group"><label>Tipos de afectación / situación permitidos:</label><input type="text" class="cfg-afectacion" value="${escaparHTML((c.tipos_afectacion || []).join(', '))}" placeholder="Vacío = todos"></div>
            </div>
            ${detectados ? `<p style="font-size:11px; color:#777; margin-bottom:8px;">Tipos de residuo detectados: ${escaparHTML(detectados)}</p>` : ''}
            <button type="button" class="btn-publicar-banner" onclick="guardarConfigDependencia('${dep}')">💾 Guardar ${dep}</button>
        </div>`;
    }).join('');
}

async function guardarConfigDependencia(dep) {
    const card = document.getElementById('cfg-' + dep);
    const fila = {
        dependencia: dep,
        bandejas: [...card.querySelectorAll('.cfg-bandeja:checked')].map(i => i.value),
        tipos_residuo: listaCSV(card.querySelector('.cfg-residuos').value),
        tipos_afectacion: listaCSV(card.querySelector('.cfg-afectacion').value),
        premium: card.querySelector('.cfg-premium').checked
    };
    const { error } = await supabaseClient.from('config_dependencias').upsert([fila], { onConflict: 'dependencia' });
    alert(error ? "Error: " + error.message : `Configuración de "${dep}" guardada. Los usuarios de esa dependencia la verán al recargar el panel.`);
    if (!error) renderConfigDependencias();
}

async function alternarPremiumUsuario(id, premium) {
    const { error } = await supabaseClient.from('usuarios_panel').update({ premium }).eq('id', id);
    if (error) alert("Error: " + error.message); else cargarUsuariosPanel();
}

/* ==========================================
   ALERTAS, NOTIFICACIONES Y RUTAS (días múltiples)
========================================== */
let configAlertas = {};
const ALERTAS_BASE = [
    { clave: 'estado_reporte', nombre: 'Cambio de estado de un reporte', donde: 'Celular del ciudadano', titulo: 'Actualización de Reporte #{codigo}', mensaje: 'Tu reporte cambió de estado a: {estado}', variables: '{codigo} {estado}' },
    { clave: 'cambio_ruta', nombre: 'Cambio en una ruta de recolección', donde: 'Campana de los ciudadanos del barrio', titulo: 'Cambio en la ruta de recolección', mensaje: '{barrio} ({municipio}): {detalle}', variables: '{barrio} {municipio} {detalle}' },
    { clave: 'paso_camion', nombre: 'Aviso de paso del camión por el sector', donde: 'Campana y celular de los ciudadanos del barrio', titulo: 'Hoy pasa el camión de recolección', mensaje: 'Hoy pasa el camión de recolección por tu sector ({barrio}, {municipio}) hacia las {hora}.', variables: '{barrio} {municipio} {hora}', valor: 60, etiquetaValor: 'Minutos de antelación del aviso automático' },
    { clave: 'banner_importante', nombre: 'Banner marcado como importante', donde: 'Campana de los ciudadanos', titulo: '⭐ Aviso importante', mensaje: '{titulo}', variables: '{titulo} {origen}' },
    { clave: 'reciclaje_asignado', nombre: 'Reciclador asignado a una entrega', donde: 'Chat y celular del ciudadano' },
    { clave: 'ecopuntos', nombre: 'EcoPuntos acreditados o canjeados', donde: 'Campana y celular del ciudadano' },
    { clave: 'recordatorio_trivia', nombre: 'Recordatorio del desafío diario', donde: 'Campana del ciudadano' },
    { clave: 'nuevo_reporte', nombre: 'Pop-up y sonido por nuevo reporte', donde: 'Panel administrativo' },
    { clave: 'baja_eficiencia', nombre: 'Alerta por baja eficiencia de una ruta', donde: 'Panel administrativo', valor: 70, etiquetaValor: 'Umbral de cumplimiento (%)' }
];

async function cargarConfigAlertas() {
    configAlertas = {};
    try {
        const { data } = await supabaseClient.from('config_alertas').select('*');
        (data || []).forEach(f => { configAlertas[f.clave] = f; });
    } catch (e) {}
    const u = configAlertas.baja_eficiencia;
    if (u && u.valor !== null && u.valor !== undefined) UMBRAL_EFICIENCIA = Number(u.valor);
}
function alertaActiva(clave) { return configAlertas[clave] ? configAlertas[clave].activa !== false : true; }
function aplicarVars(texto, vars) { return String(texto || '').replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m)); }
function plantillaAlerta(clave, vars) {
    const base = ALERTAS_BASE.find(x => x.clave === clave) || {};
    const cfg = configAlertas[clave] || {};
    return { titulo: aplicarVars(cfg.titulo || base.titulo, vars), mensaje: aplicarVars(cfg.mensaje || base.mensaje, vars) };
}

async function crearNotificacion(n) {
    try {
        const { error } = await supabaseClient.from('notificaciones').insert([{
            tipo: n.tipo, titulo: n.titulo, mensaje: n.mensaje,
            municipio: (n.municipio && n.municipio !== 'Todos') ? n.municipio : null,
            barrio: n.barrio || null, origen: n.origen || null, clave_unica: n.clave_unica || null
        }]);
        if (error) throw error;
        return true;
    } catch (e) { console.warn("No se pudo crear la notificación:", e); return false; }
}

async function notificarCambioRuta(ant, r) {
    if (!r || !alertaActiva('cambio_ruta')) return;
    const cambios = [];
    if (!ant) cambios.push(`nueva ruta: ${r.dia_semana} hacia las ${r.hora_estimada}`);
    else {
        if (ant.dia_semana !== r.dia_semana) cambios.push(`nuevos días de paso: ${r.dia_semana}`);
        if (ant.hora_estimada !== r.hora_estimada) cambios.push(`nueva hora estimada: ${r.hora_estimada}`);
        if (ant.estado_recorrido !== r.estado_recorrido && ['incumplida', 'suspendida'].includes(r.estado_recorrido)) cambios.push(`el recorrido quedó ${r.estado_recorrido}`);
    }
    if (!cambios.length) return;
    const p = plantillaAlerta('cambio_ruta', { barrio: r.barrio, municipio: r.municipio, detalle: cambios.join('; ') });
    await crearNotificacion({ tipo: 'ruta', ...p, municipio: r.municipio, barrio: r.barrio, origen: dependenciaUsuario });
}

async function avisarPasoCamion(id) {
    const r = rutasDatos.find(x => String(x.id) === String(id));
    if (!r) return;
    if (!confirm(`¿Avisar ahora a los ciudadanos de ${r.barrio} (${r.municipio}) que el camión va a pasar?`)) return;
    const p = plantillaAlerta('paso_camion', { barrio: r.barrio, municipio: r.municipio, hora: r.hora_estimada });
    const ok = await crearNotificacion({ tipo: 'camion', ...p, municipio: r.municipio, barrio: r.barrio, origen: dependenciaUsuario, clave_unica: `camion:${r.id}:${hoyLocal()}` });
    alert(ok ? "Aviso enviado a los ciudadanos del sector." : "No se pudo enviar. Es posible que ya se haya avisado hoy esta ruta, o que falte ejecutar cambios_supabase.sql.");
}

function diasSeleccionadosRuta() { return [...document.querySelectorAll('#rutaDias input:checked')].map(i => i.value).join(', '); }
function marcarDiasRuta(texto) {
    const dias = String(texto || '').split(',').map(d => d.trim());
    document.querySelectorAll('#rutaDias input').forEach(i => { i.checked = dias.includes(i.value); });
}

// Cada empresa solo publica banners a nombre de su dependencia (el superadmin elige libremente)
function prepararOrigenBanner() {
    const sel = document.getElementById('bannerOrigen');
    if (!sel) return;
    const dep = (dependenciaUsuario || '').toLowerCase();
    // El origen ya no se pregunta: se toma de la dependencia de quien publica (superadmin = alcaldía)
    sel.value = ['alcaldia', 'aseo', 'recicladores'].includes(dep) ? dep : 'alcaldia';
}

/* ---------- Panel superadmin: alertas ---------- */
async function renderConfigAlertas() {
    const cont = document.getElementById('configAlertas');
    const { data, error } = await supabaseClient.from('config_alertas').select('*');
    (data || []).forEach(f => { configAlertas[f.clave] = f; });
    const aviso = error ? `<p style="color:#c62828; font-size:12px;">No se pudo leer config_alertas (${escaparHTML(error.message)}). Ejecuta cambios_supabase.sql.</p>` : '';
    const automatico = {
        estado_reporte: 'Se envía solo cuando un funcionario cambia el estado de un reporte.',
        cambio_ruta: 'Se envía solo cuando se crea o modifica una ruta (días, hora o recorrido incumplido).',
        paso_camion: 'Se envía solo antes de la hora estimada de paso del camión por el barrio.',
        banner_importante: 'Se envía solo cuando se publica un banner marcado como importante.',
        reciclaje_asignado: 'Mensaje automático en el chat cuando un reciclador de CicloGo acepta la entrega.',
        ecopuntos: 'Aviso cuando se acreditan EcoPuntos (trivia, módulos, QR, pesaje) o se canjean en CicloGo.',
        recordatorio_trivia: 'Aviso en la campana si el ciudadano aún no ha jugado la trivia del día.',
        nuevo_reporte: 'Pop-up y sonido en el panel cuando llega un reporte nuevo.',
        baja_eficiencia: 'Pop-up en el panel cuando una ruta baja del umbral de cumplimiento.'
    };
    cont.innerHTML = aviso + ALERTAS_BASE.map(al => `
        <label class="alerta-fila">
            <span><strong>${al.nombre}</strong><br><small>${al.donde} · ${automatico[al.clave] || ''}</small></span>
            <span class="alerta-control"><span id="estado-al-${al.clave}" class="alerta-estado"></span>
                <input type="checkbox" ${alertaActiva(al.clave) ? 'checked' : ''} onchange="guardarConfigAlerta('${al.clave}', this.checked)"></span>
        </label>`).join('');
}

// Guarda al instante; conserva los textos y valores que ya tenía la alerta
async function guardarConfigAlerta(clave, activa) {
    const base = ALERTAS_BASE.find(x => x.clave === clave);
    const actual = configAlertas[clave] || {};
    const fila = {
        clave, nombre: base.nombre, activa,
        titulo: actual.titulo ?? base.titulo ?? null,
        mensaje: actual.mensaje ?? base.mensaje ?? null,
        valor: actual.valor ?? base.valor ?? null
    };
    const estado = document.getElementById('estado-al-' + clave);
    const { error } = await supabaseClient.from('config_alertas').upsert([fila], { onConflict: 'clave' });
    if (error) { alert("Error: " + error.message); renderConfigAlertas(); return; }
    configAlertas[clave] = fila;
    if (estado) { estado.textContent = activa ? '✔ Activada' : '✔ Desactivada'; setTimeout(() => { estado.textContent = ''; }, 2500); }
}

async function renderErroresApp() {
    const c = document.getElementById('cuerpoErroresApp');
    const { data, error } = await supabaseClient.from('errores_app').select('*').order('created_at', { ascending: false }).limit(30);
    if (error) { c.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center;">${escaparHTML(error.message)} (¿ejecutaste errores_app_supabase.sql?)</td></tr>`; return; }
    c.innerHTML = (data || []).length ? data.map(e => `<tr><td>${new Date(e.created_at).toLocaleString()}</td><td>${escaparHTML(e.version)}</td><td>${escaparHTML(e.usuario_email || 'anónimo')}</td><td>${escaparHTML(e.pantalla)}</td><td>${escaparHTML(e.mensaje)}<br><small style="color:#777;">${escaparHTML((e.dispositivo || '').slice(0, 90))}</small></td></tr>`).join('') : `<tr><td colspan="5" style="text-align:center;">Sin errores registrados. ✅</td></tr>`;
}

async function renderHistorialNotificaciones() {
    const c = document.getElementById('cuerpoHistorialNotif');
    const { data, error } = await supabaseClient.from('notificaciones').select('*').order('created_at', { ascending: false }).limit(15);
    if (error) { c.innerHTML = `<tr><td colspan="4" style="color:red; text-align:center;">${escaparHTML(error.message)}</td></tr>`; return; }
    c.innerHTML = (data || []).length ? data.map(n => `<tr><td>${new Date(n.created_at).toLocaleString()}</td><td>${escaparHTML(n.tipo)}</td><td>${escaparHTML(n.titulo)}<br><small style="color:#777;">${escaparHTML(n.mensaje)}</small></td><td>${escaparHTML([n.municipio, n.barrio].filter(Boolean).join(' · ') || 'Todos')}</td></tr>`).join('') : `<tr><td colspan="4" style="text-align:center;">Aún no se han enviado notificaciones.</td></tr>`;
}


/* ============================================================
   MANTENIMIENTO (superadmin): tamaño de la base y limpieza segura.
   Todo pasa por funciones SQL (eco_mant_*) que validan en la base que seas superadmin.
   ============================================================ */
function mantFormatoBytes(b) {
    b = Number(b) || 0;
    if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
}

async function cargarMantenimiento() {
    const uso = document.getElementById('mantUso');
    if (!uso) return;
    const { data, error } = await supabaseClient.rpc('eco_mant_resumen');
    if (error) {
        uso.innerHTML = `<span style="color:red;">${escaparHTML(error.message)} (¿ejecutaste 21_ECOSTAN_mantenimiento.sql?)</span>`;
        return;
    }
    const usado = Number(data.bytes_db) || 0, limite = Number(data.limite_bytes) || 524288000;
    const pct = Math.min(100, Math.round(usado * 100 / limite));
    const color = pct >= 85 ? '#c62828' : (pct >= 60 ? '#f9a825' : '#2e7d32');
    uso.innerHTML = `<div style="font-size:14px; margin-bottom:6px;"><strong>${mantFormatoBytes(usado)}</strong> usados de ${mantFormatoBytes(limite)} (${pct} %)</div>
        <div style="background:#e0e0e0; border-radius:8px; height:14px; overflow:hidden;"><div style="width:${pct}%; background:${color}; height:100%;"></div></div>`;

    document.getElementById('cuerpoMantTablas').innerHTML = (data.tablas || []).map(t =>
        `<tr><td>${escaparHTML(t.tabla)}</td><td>${Number(t.filas) > 0 ? Number(t.filas).toLocaleString() : '—'}</td><td>${mantFormatoBytes(t.bytes)}</td></tr>`).join('')
        || '<tr><td colspan="3" style="text-align:center;">Sin datos</td></tr>';

    document.getElementById('cuerpoMantTareas').innerHTML = (data.tareas || []).map(t => `<tr>
        <td>${escaparHTML(t.titulo)}</td><td>${escaparHTML(t.detalle)}</td>
        <td><strong>${Number(t.filas).toLocaleString()}</strong></td>
        <td><button type="button" class="btn-publicar-banner btn-mant" data-tarea="${escaparHTML(t.tarea)}" data-filas="${Number(t.filas)}"
            style="margin:0; padding:6px 12px; background:#c62828;" disabled onclick="ejecutarMantenimiento('${escaparHTML(t.tarea)}')">🧹 Limpiar</button></td></tr>`).join('');

    document.getElementById('cuerpoMantHistorial').innerHTML = (data.historial || []).length
        ? data.historial.map(h => `<tr><td>${new Date(h.created_at).toLocaleString()}</td><td>${escaparHTML(h.email || '')}</td><td>${escaparHTML(h.tarea)}</td><td>${Number(h.filas_borradas).toLocaleString()}</td></tr>`).join('')
        : '<tr><td colspan="4" style="text-align:center;">Sin limpiezas todavía</td></tr>';
    mantRevisarConfirmacion();
}

function mantRevisarConfirmacion() {
    const ok = ((document.getElementById('mantConfirmar') || {}).value || '').trim() === 'BORRAR';
    document.querySelectorAll('.btn-mant').forEach(b => { b.disabled = !(ok && Number(b.dataset.filas) > 0); b.style.opacity = b.disabled ? '0.5' : '1'; });
}

async function ejecutarMantenimiento(tarea) {
    const msg = document.getElementById('mantMensaje');
    if (((document.getElementById('mantConfirmar') || {}).value || '').trim() !== 'BORRAR') return;
    document.querySelectorAll('.btn-mant').forEach(b => { b.disabled = true; });
    msg.style.color = '#555'; msg.textContent = 'Limpiando...';
    const { data, error } = await supabaseClient.rpc('eco_mant_ejecutar', { p_tarea: tarea });
    if (error) { msg.style.color = 'red'; msg.textContent = 'Error: ' + error.message; mantRevisarConfirmacion(); return; }
    msg.style.color = '#2e7d32'; msg.textContent = `✔ Listo: se borraron ${Number(data).toLocaleString()} filas.`;
    document.getElementById('mantConfirmar').value = '';
    cargarMantenimiento();
}

async function cerrarSesion() {
    await cerrarSesionGlobal();
    window.location.href = RUTAS.loginAdmin;
}


/* ============================================================
   ESTRUCTURA EMPRESARIAL: menú lateral por áreas, barra superior, Resumen general
   El selector #selectBandeja (oculto) sigue siendo la fuente de verdad: el menú solo lo controla,
   así se conservan todos los permisos por dependencia y la lógica existente.
   ============================================================ */
const MENU_AREAS = [
    { area: 'General', items: [{ v: 'inicio_resumen', ico: '🏠', t: 'Resumen general' }] },
    { area: 'Atención ciudadana', items: [
        { v: 'reportes_abandonados', ico: '🗑️', t: 'Problemas de la ciudad' },
        { v: 'reportes_violencia_animal', ico: '🐾', t: 'Violencia animal' },
        { v: 'reportes_ciudadania', ico: '💡', t: 'Ciudadanía activa' }] },
    { area: 'Logística y operación', items: [{ v: 'gestion_rutas', ico: '🚛', t: 'Rutas de recolección' }] },
    { area: 'Operación de recicladores', items: [
        { v: 'operacion_recicladores', ico: '🚚', t: 'Recicladores' },
        { v: 'operacion_pesajes', ico: '⚖️', t: 'Báscula y pesajes' },
        { v: 'operacion_ecas', ico: '🏢', t: 'Empresas ECA' }] },
    { area: 'Comunicación', items: [{ v: 'gestion_banners', ico: '📢', t: 'Banners y publicidad' }] },
    { area: 'Analítica', items: [
        { v: 'analitica_kpi', ico: '📈', t: 'Analítica' },
        { v: 'plan_premium', ico: '💎', t: 'Plan Premium (KPIs e IA)' }] },
    { area: 'Usuarios de la app', items: [
        { v: 'usuarios_registrados', ico: '👥', t: 'Usuarios registrados' },
        { v: 'usuarios_bloqueados', ico: '🚫', t: 'Usuarios bloqueados' }] },
    { area: 'Administración', items: [
        { v: 'superadmin_panel', sec: 'territorios', ico: '🗺️', t: 'Territorios (municipios)' },
        { v: 'superadmin_panel', sec: 'organizaciones', ico: '🏢', t: 'Organizaciones' },
        { v: 'superadmin_panel', sec: 'accesos', ico: '🔑', t: 'Accesos y módulos' },
        { v: 'superadmin_panel', sec: 'usuarios', ico: '🛡️', t: 'Usuarios del panel' },
        { v: 'superadmin_panel', sec: 'dependencias', ico: '🧭', t: 'Dependencias y casos' },
        { v: 'superadmin_panel', sec: 'alertas', ico: '🔔', t: 'Alertas y notificaciones' },
        { v: 'superadmin_panel', sec: 'errores', ico: '🛠️', t: 'Errores de la app' },
        { v: 'superadmin_panel', sec: 'mantenimiento', ico: '🧹', t: 'Mantenimiento' }] }
];
const COLUMNAS_RESUMEN = {
    reportes_abandonados: 'id,codigo,estado,created_at,municipio,tipo_afectacion,nombre_reporte',
    reportes_violencia_animal: 'id,codigo,estado,created_at,municipio,tipo_situacion,nombre_reporte',
    reportes_ciudadania: 'id,codigo,estado,created_at,tipo_propuesta'
};
let seccionSuper = 'usuarios', contadores = {}, ultimosReportes = [], temporizadorContadores = null;

function etiquetaRol() {
    if (esSuperadmin) return 'Superadministrador';
    const mapa = { alcaldia: 'Alcaldía', aseo: 'Empresa de aseo', recicladores: 'Recicladores', publicidad: 'Publicidad', marketing: 'Publicidad' };
    return mapa[dependenciaUsuario] || dependenciaUsuario || 'Personal';
}

function actualizarChipUsuario() {
    const e = emailActual || '';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('sbUserEmail', e || 'Sin sesión');
    set('sbAvatar', (e[0] || '?'));
    set('sbUserRol', etiquetaRol());
    set('chipRol', etiquetaRol());
}

function construirMenuLateral() {
    const nav = document.getElementById('sbNav');
    const sel = document.getElementById('selectBandeja');
    if (!nav || !sel) return;
    const disponibles = new Set(Array.from(sel.options).map(o => o.value));
    const actual = sel.value;
    nav.innerHTML = MENU_AREAS.map(a => {
        const items = a.items.filter(i => disponibles.has(i.v));
        if (!items.length) return '';
        return `<div class="sb-area"><div class="sb-area-t">${escaparHTML(a.area)}</div>` + items.map(i => {
            const activo = i.v === actual && (!i.sec || i.sec === seccionSuper);
            const n = contadores[i.v] ? contadores[i.v].pend : 0;
            return `<button type="button" class="sb-item${activo ? ' activo' : ''}" onclick="irAModulo('${i.v}'${i.sec ? `, '${i.sec}'` : ''})">
                <span class="sb-ico">${i.ico}</span><span class="sb-txt">${escaparHTML(i.t)}</span>${n ? `<span class="sb-badge">${n}</span>` : ''}</button>`;
        }).join('') + '</div>';
    }).join('');
    actualizarTituloModulo();
}

function actualizarTituloModulo() {
    const sel = document.getElementById('selectBandeja');
    if (!sel) return;
    let area = 'General', titulo = 'Resumen general';
    MENU_AREAS.forEach(a => a.items.forEach(i => {
        if (i.v === sel.value && (!i.sec || i.sec === seccionSuper)) { area = a.area; titulo = i.t; }
    }));
    const c = document.getElementById('crumb'), t = document.getElementById('tituloModulo');
    if (c) c.textContent = area;
    if (t) t.textContent = titulo;
}

function mostrarSeccionSuper(sec) {
    seccionSuper = sec || 'usuarios';
    document.querySelectorAll('#panelSuperadmin > [data-sec]').forEach(c => { c.style.display = (c.dataset.sec === seccionSuper) ? '' : 'none'; });
    actualizarTituloModulo();
}

function irAModulo(valor, sec) {
    const sel = document.getElementById('selectBandeja');
    if (!sel || !Array.from(sel.options).some(o => o.value === valor)) return;
    if (valor === 'superadmin_panel') seccionSuper = sec || seccionSuper || 'usuarios';
    sel.value = valor;
    cambiarBandeja();
    if (valor === 'superadmin_panel') mostrarSeccionSuper(seccionSuper);
    construirMenuLateral();
    alternarSidebar(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function alternarSidebar(forzar) {
    const sb = document.getElementById('sidebar'), ov = document.getElementById('sidebarOverlay');
    if (!sb) return;
    const abrir = (typeof forzar === 'boolean') ? forzar : !sb.classList.contains('abierto');
    sb.classList.toggle('abierto', abrir);
    if (ov) ov.classList.toggle('visible', abrir);
}

// Contadores por bandeja (solo columnas livianas: las fotos van dentro de la tabla y pesan mucho)
async function cargarContadores() {
    const sel = document.getElementById('selectBandeja');
    if (!sel) return contadores;
    const disp = new Set(Array.from(sel.options).map(o => o.value));
    const tablas = TABLAS_REPORTES.filter(t => disp.has(t));
    const out = {}, filas = [];
    await Promise.all(tablas.map(async t => {
        let r = await supabaseClient.from(t).select(COLUMNAS_RESUMEN[t]).order('created_at', { ascending: false }).limit(500);
        if (r.error) r = await supabaseClient.from(t).select('id,estado,created_at').order('created_at', { ascending: false }).limit(500);
        const lista = filtrarPorCompetencia(t, r.data || []);
        const est = x => String(x.estado || 'pendiente').toLowerCase();
        out[t] = { total: lista.length, pend: lista.filter(x => est(x) === 'pendiente').length,
                   proc: lista.filter(x => est(x) === 'en_proceso').length, res: lista.filter(x => est(x) === 'resuelto').length };
        lista.slice(0, 8).forEach(x => filas.push({ ...x, _tabla: t }));
    }));
    contadores = out;
    ultimosReportes = filas.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8);
    return out;
}

function refrescarContadores() {
    clearTimeout(temporizadorContadores);
    temporizadorContadores = setTimeout(async () => {
        try {
            await cargarContadores();
            construirMenuLateral();
            const sel = document.getElementById('selectBandeja');
            if (sel && sel.value === 'inicio_resumen') pintarResumen();
        } catch (e) { console.warn('No se pudieron actualizar los contadores', e); }
    }, 1200);
}

async function cargarResumen() {
    const h = new Date().getHours();
    const saludo = h < 12 ? 'Buenos días' : (h < 19 ? 'Buenas tardes' : 'Buenas noches');
    const nombre = (emailActual || '').split('@')[0];
    const g = document.getElementById('saludoInicio'), s = document.getElementById('subSaludo');
    if (g) g.textContent = `${saludo}${nombre ? ', ' + nombre : ''}`;
    if (s) s.textContent = `${etiquetaRol()} · ${new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
    try { await cargarContadores(); } catch (e) { console.warn(e); }
    construirMenuLateral();
    pintarResumen();
}

async function pintarResumen() {
    const kpi = document.getElementById('kpiInicio');
    if (!kpi) return;
    const sel = document.getElementById('selectBandeja');
    const disp = new Set(Array.from(sel.options).map(o => o.value));
    const tarjeta = (titulo, valor, nota, destino, alerta) =>
        `<div class="kpi-card clicable${alerta ? ' alerta' : ''}" onclick="irAModulo('${destino}')"><h4>${escaparHTML(titulo)}</h4><div class="kpi-valor">${valor}</div><small>${nota}</small></div>`;
    let html = Object.keys(contadores).map(t => {
        const c = contadores[t];
        return tarjeta(NOMBRES_TABLAS[t] || t, c.pend, `pend. · ${c.proc} en proceso · ${c.res} resueltos`, t, c.pend > 0);
    }).join('');
    if (disp.has('usuarios_registrados')) {
        try {
            const { count } = await supabaseClient.from('usuarios_registrados').select('id', { count: 'exact', head: true });
            html += tarjeta('Usuarios registrados', count === null || count === undefined ? 'N/D' : count.toLocaleString(), 'Ciudadanos en la app', 'usuarios_registrados', false);
        } catch (e) {}
    }
    if (disp.has('gestion_rutas')) {
        try {
            const { data } = await supabaseClient.from('rutas_recoleccion').select('estado_recorrido,cumplimiento');
            const rutas = data || [];
            const alerta = rutas.filter(r => ['incumplida', 'suspendida'].includes(r.estado_recorrido)).length;
            const prom = rutas.length ? Math.round(rutas.reduce((a, r) => a + (Number(r.cumplimiento) || 0), 0) / rutas.length) : null;
            html += tarjeta('Rutas con novedad', alerta, `${rutas.length} ruta(s) · cumplimiento medio ${prom === null ? 'N/D' : prom + '%'}`, 'gestion_rutas', alerta > 0);
        } catch (e) {}
    }
    if (disp.has('operacion_recicladores')) {
        const r = await puenteCiclo('resumen');
        if (r) html += tarjeta('Recicladores en línea', r.en_linea, `${r.recicladores} registrados · ${r.sin_verificar} sin verificar · ${Math.round(r.kg_30d).toLocaleString()} kg en 30 días`, 'operacion_recicladores', false);
    }
    kpi.innerHTML = html || '<p style="color:#888;">No hay indicadores disponibles para tu perfil.</p>';

    const cuerpo = document.getElementById('cuerpoUltimosReportes');
    if (cuerpo) {
        cuerpo.innerHTML = ultimosReportes.length ? ultimosReportes.map(r => {
            const est = String(r.estado || 'pendiente').toLowerCase();
            const detalle = r.tipo_residuo || r.tipo_afectacion || r.tipo_situacion || r.tipo_propuesta || r.nombre_reporte || '—';
            return `<tr><td>${new Date(r.created_at).toLocaleString()}</td><td>${escaparHTML(NOMBRES_TABLAS[r._tabla] || r._tabla)}</td>
                <td>${escaparHTML(detalle)}</td><td>${escaparHTML(r.municipio || '—')}</td>
                <td><span class="status-badge status-${est}">${est}</span></td>
                <td><button class="btn-chat-admin" onclick="irAModulo('${r._tabla}')">Abrir</button></td></tr>`;
        }).join('') : '<tr><td colspan="6" style="text-align:center;">Sin reportes recientes.</td></tr>';
    }
    const acc = document.getElementById('accesosRapidos');
    if (acc) {
        acc.innerHTML = MENU_AREAS.flatMap(a => a.items).filter(i => i.v !== 'inicio_resumen' && disp.has(i.v))
            .map(i => `<button type="button" class="quick-btn" onclick="irAModulo('${i.v}'${i.sec ? `, '${i.sec}'` : ''})">${i.ico} ${escaparHTML(i.t)}</button>`).join('');
    }
}

/* ============================================================
   RUTAS DE RECOLECCIÓN: se arman en el mapa (barrios + días + hora).
   - Al guardar queda "programada". El reloj del servidor (pg_cron, SQL 28) la pasa a "en curso" a la hora.
   - El resto de estados y las novedades los cambia el operador (CicloGo) o el panel, con rutas_cambiar_estado().
   - rutas_recoleccion se mantiene sincronizada (una fila por barrio) para la app ciudadana y las notificaciones.
   - Límites de barrios: OpenStreetMap (Overpass). Orden eficiente y calles reales: OSRM.
   ============================================================ */
let mapaRutas = null, capaBarrios = null, capaRecorrido = null, barriosGeo = [], capasPorBarrio = {}, mapaRutasListo = false;
let planBarrios = [], planGeometria = null, planDistancia = null, planDuracion = null, planesGuardados = [], planEditandoId = null, novedadesHoy = {};
const normNombre = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const infoMapaRuta = (m, error) => { const e = document.getElementById('mapaRutaInfo'); if (e) { e.textContent = m || ''; e.style.color = error ? '#b71c1c' : '#555'; } };
const ESTADOS_RUTA = { programada: ['🕒', 'Programada'], en_curso: ['🚛', 'En curso'], completada: ['✅', 'Completada'], incumplida: ['❌', 'Incumplida'], suspendida: ['⏸️', 'Suspendida'] };
const chipEstado = e => { const x = ESTADOS_RUTA[e] || ESTADOS_RUTA.programada; return `<span class="rt-chip rt-${ESTADOS_RUTA[e] ? e : 'programada'}">${x[0]} ${x[1]}</span>`; };
const diaHoyNombre = () => { const d = new Intl.DateTimeFormat('es-CO', { weekday: 'long', timeZone: 'America/Bogota' }).format(new Date()); return d.charAt(0).toUpperCase() + d.slice(1); };
const planPasaHoy = p => String(p.dias || '').split(',').map(x => x.trim()).includes(diaHoyNombre());
const TIPOS_VER = { inicio: '▶ Inicio', finalizada: '✅ Finalizada', incumplida: '❌ Incumplida', suspendida: '⏸ Suspendida', nota: '📝 Nota' };
const TIPOS_NOVEDAD = { retraso: '⏳ Retraso', falla: '🔧 Falla del camión', cierre_vial: '🚧 Cierre vial', clima: '🌧️ Clima', otra: '📝 Otra' };

function iniciarMapaRutas() {
    if (!window.L || !document.getElementById('mapaRutas')) { infoMapaRuta('No se pudo cargar la librería del mapa.', true); return; }
    if (!mapaRutas) {
        mapaRutas = L.map('mapaRutas').setView([7.1193, -73.1227], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(mapaRutas);
        capaBarrios = L.featureGroup().addTo(mapaRutas);
        capaRecorrido = L.featureGroup().addTo(mapaRutas);
        if (mapaRutas.on) mapaRutas.on('zoomend', () => document.getElementById('mapaRutas').classList.toggle('rt-sinlabels', mapaRutas.getZoom() < 14));
    }
    setTimeout(() => mapaRutas.invalidateSize(), 250);
    if (!mapaRutasListo) { mapaRutasListo = true; cargarBarriosMapa(); } else refrescarEstiloBarrios();
}

async function cargarBarriosMapa() {
    const mun = document.getElementById('mapaRutaMun').value;
    capaBarrios.clearLayers(); capasPorBarrio = {};
    const { data, error } = await supabaseClient.from('barrios_geo').select('barrio,municipio,geojson,centro_lat,centro_lng,comuna,comuna_nombre,fuente').eq('municipio', mun).order('barrio');
    if (error) { infoMapaRuta('Error: ' + error.message + ' (¿ejecutaste el SQL 23?)', true); return; }
    barriosGeo = data || [];
    const oficiales = barriosGeo.filter(b => b.comuna != null);
    if (oficiales.length) barriosGeo = oficiales;          // si hay división oficial, se usa solo esa
    if (!barriosGeo.length) { infoMapaRuta(`Aún no hay límites de barrios de ${mun}. Pulsa "Cargar límites de barrios" (se hace una sola vez).`); pintarComunas(); return; }
    barriosGeo.forEach(b => {
        const capa = L.geoJSON(b.geojson, { style: () => estiloBarrio(b) });
        capa.bindTooltip(b.barrio + (b.comuna ? ` · Comuna ${b.comuna}` : ''), { sticky: true });
        if (b.comuna) capa.bindTooltip(b.barrio, { permanent: true, direction: 'center', className: 'rt-lbl' });
        capa.on('click', () => alternarBarrioPlan(b));
        capa.on('mouseover', () => capa.setStyle({ weight: 3.5, fillOpacity: 0.4 }));
        capa.on('mouseout', () => capa.setStyle(estiloBarrio(b)));
        capa.addTo(capaBarrios);
        capasPorBarrio[normNombre(b.barrio)] = capa;
    });
    try { mapaRutas.fitBounds(capaBarrios.getBounds(), { padding: [20, 20] }); } catch (e) {}
    infoMapaRuta(`${barriosGeo.length} barrios en ${mun}${oficiales.length ? ' (división oficial por comunas)' : ''}. Toca un barrio para agregarlo o quitarlo de la ruta.`);
    pintarComunas(); filtrarBuscadorBarrios();
}

const COLORES_COMUNA = { 1: '#f472b6', 2: '#fb923c', 3: '#2dd4bf', 4: '#a3e635', 5: '#a78bfa', 6: '#f87171', 7: '#facc15', 8: '#60a5fa' };
const enPlan = b => planBarrios.findIndex(p => normNombre(p.barrio) === normNombre(b.barrio) && p.municipio === b.municipio);
const enOtraRuta = b => planesGuardados.some(p => String(p.id) !== String(planEditandoId) && p.activo !== false
    && (p.barrios || []).some(x => normNombre(x.barrio) === normNombre(b.barrio) && x.municipio === b.municipio));

function estiloBarrio(b) {
    if (enPlan(b) >= 0) { const c = document.getElementById('planColor').value || '#2563eb'; return { color: c, weight: 3, fillColor: c, fillOpacity: 0.55 }; }
    const cc = COLORES_COMUNA[b.comuna] || '#94a3b8';
    if (enOtraRuta(b)) return { color: '#d97706', weight: 3, dashArray: '6 4', fillColor: cc, fillOpacity: 0.28 };
    return { color: '#475569', weight: 1.6, fillColor: cc, fillOpacity: 0.22 };
}

function refrescarEstiloBarrios() {
    barriosGeo.forEach(b => { const c = capasPorBarrio[normNombre(b.barrio)]; if (c) c.setStyle(estiloBarrio(b)); });
    pintarPlanLista(); filtrarBuscadorBarrios();
}

function centroBarrio(b) {
    if (b.centro_lat != null && b.centro_lng != null) return [b.centro_lat, b.centro_lng];
    const c = capasPorBarrio[normNombre(b.barrio)];
    const ctr = c ? c.getBounds().getCenter() : mapaRutas.getCenter();
    return [ctr.lat, ctr.lng];
}

function alternarBarrioPlan(b) {
    const i = enPlan(b);
    if (i >= 0) planBarrios.splice(i, 1);
    else { const [lat, lng] = centroBarrio(b); planBarrios.push({ barrio: b.barrio, municipio: b.municipio, lat, lng, comuna: b.comuna }); }
    planGeometria = null; planDistancia = planDuracion = null;
    capaRecorrido.clearLayers();
    refrescarEstiloBarrios();
}

function pintarComunas() {
    const c = document.getElementById('planComunas');
    if (!c) return;
    const m = new Map();
    barriosGeo.forEach(b => { if (b.comuna != null) m.set(b.comuna, b.comuna_nombre || ('Comuna ' + b.comuna)); });
    c.innerHTML = m.size ? [...m.entries()].sort((a, b) => a[0] - b[0]).map(([n, nom]) => `<button type="button" data-ruta="comuna" data-n="${n}" style="border-color:${COLORES_COMUNA[n] || '#94a3b8'}" title="Agregar o quitar todos los barrios de la comuna">${n} · ${escaparHTML(nom)}</button>`).join('') : '';
}

function alternarComuna(n) {
    const bs = barriosGeo.filter(b => String(b.comuna) === String(n));
    if (!bs.length) return;
    const todos = bs.every(b => enPlan(b) >= 0);
    bs.forEach(b => { const i = enPlan(b); if (todos && i >= 0) planBarrios.splice(i, 1); else if (!todos && i < 0) { const [lat, lng] = centroBarrio(b); planBarrios.push({ barrio: b.barrio, municipio: b.municipio, lat, lng, comuna: b.comuna }); } });
    planGeometria = null; planDistancia = planDuracion = null; capaRecorrido.clearLayers();
    refrescarEstiloBarrios();
}

function filtrarBuscadorBarrios() {
    const q = normNombre((document.getElementById('planBuscar') || {}).value), c = document.getElementById('planSugerencias');
    if (!c) return;
    if (!q) { c.innerHTML = ''; return; }
    const r = barriosGeo.filter(b => enPlan(b) < 0 && normNombre(b.barrio).includes(q)).slice(0, 8);
    c.innerHTML = r.length ? r.map(b => `<button type="button" data-ruta="add" data-k="${escaparHTML(normNombre(b.barrio))}">+ ${escaparHTML(b.barrio)}${b.comuna ? ' <small>(C' + b.comuna + ')</small>' : ''}</button>`).join('') : '<span style="color:#888; font-size:12px;">Sin coincidencias</span>';
}

function pintarPlanLista() {
    const ol = document.getElementById('planLista'), res = document.getElementById('planResumen');
    if (!ol) return;
    const col = document.getElementById('planColor').value;
    ol.innerHTML = planBarrios.length ? planBarrios.map((p, i) => `<li>
        <span class="rt-num" style="background:${col};">${i + 1}</span>
        <span style="flex:1;">${escaparHTML(p.barrio)}${p.comuna ? ' <small style="color:#94a3b8;">C' + p.comuna + '</small>' : ''}</span>
        <button type="button" data-plan="sube" data-i="${i}">↑</button><button type="button" data-plan="baja" data-i="${i}">↓</button><button type="button" data-plan="quita" data-i="${i}" class="rt-x">✕</button></li>`).join('')
        : '<li class="rt-vacio">Toca barrios en el mapa para agregarlos.</li>';
    res.textContent = planDistancia != null ? `🛣️ ${(planDistancia / 1000).toFixed(1)} km · ⏱️ ${Math.round(planDuracion / 60)} min conduciendo (sin paradas)` : (planBarrios.length ? `${planBarrios.length} barrio(s) en la ruta` : '');
}

document.addEventListener('click', e => {
    const bp = e.target.closest('[data-plan]');
    if (bp) {
        const i = Number(bp.dataset.i), a = bp.dataset.plan;
        if (a === 'sube' && i > 0) [planBarrios[i - 1], planBarrios[i]] = [planBarrios[i], planBarrios[i - 1]];
        else if (a === 'baja' && i < planBarrios.length - 1) [planBarrios[i + 1], planBarrios[i]] = [planBarrios[i], planBarrios[i + 1]];
        else if (a === 'quita') planBarrios.splice(i, 1);
        planGeometria = null; planDistancia = planDuracion = null; if (capaRecorrido) capaRecorrido.clearLayers();
        refrescarEstiloBarrios();
        return;
    }
    const br = e.target.closest('[data-ruta]');
    if (!br) return;
    const a = br.dataset.ruta, id = br.dataset.id;
    if (a === 'comuna') alternarComuna(br.dataset.n);
    else if (a === 'add') { const b = barriosGeo.find(x => normNombre(x.barrio) === br.dataset.k); if (b) { alternarBarrioPlan(b); document.getElementById('planBuscar').value = ''; filtrarBuscadorBarrios(); } }
    else if (a === 'ver') verPlanGuardado(id);
    else if (a === 'editar') editarPlan(id);
    else if (a === 'borrar') borrarPlanGuardado(id);
    else if (a === 'pausa') alternarActivoPlan(id);
    else if (a === 'estado') cambiarEstadoPlan(id, br.dataset.est);
    else if (a === 'novedad') registrarNovedad(id);
});

function limpiarPlanRuta() {
    planBarrios = []; planGeometria = null; planDistancia = planDuracion = null; planEditandoId = null;
    if (capaRecorrido) capaRecorrido.clearLayers();
    ['planNombre', 'planHora', 'planBuscar'].forEach(i => { const e = document.getElementById(i); if (e) e.value = ''; });
    document.getElementById('planServicio').value = 'Recolección de residuos ordinarios';
    marcarDiasRuta('');
    document.getElementById('rtTitulo').textContent = '🗺️ Crear ruta desde el mapa';
    document.getElementById('btnGuardarPlan').textContent = '💾 Guardar ruta';
    refrescarEstiloBarrios();
}

// Orden más corto por calles reales (OSRM). El primer barrio elegido es el punto de salida.
async function calcularRecorrido(optimizar) {
    if (planBarrios.length < 2) { infoMapaRuta('Selecciona al menos 2 barrios.', true); return false; }
    const coords = planBarrios.map(p => `${p.lng},${p.lat}`).join(';');
    const url = optimizar
        ? `https://router.project-osrm.org/trip/v1/driving/${coords}?roundtrip=false&source=first&destination=any&overview=full&geometries=geojson`
        : `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    infoMapaRuta('Calculando recorrido por las calles...');
    try {
        const r = await fetch(url);
        const d = await r.json();
        if (d.code !== 'Ok') throw new Error(d.message || d.code);
        const t = optimizar ? d.trips[0] : d.routes[0];
        if (optimizar) {
            const orden = planBarrios.map((p, i) => ({ p, pos: d.waypoints[i].waypoint_index })).sort((a, b) => a.pos - b.pos);
            planBarrios = orden.map(o => o.p);
        }
        planGeometria = t.geometry; planDistancia = t.distance; planDuracion = t.duration;
        dibujarRecorrido(); refrescarEstiloBarrios();
        infoMapaRuta(optimizar ? 'Orden optimizado: sale del primer barrio que elegiste.' : 'Recorrido calculado.');
        return true;
    } catch (err) { infoMapaRuta('No se pudo calcular el recorrido por calles: ' + err.message, true); return false; }
}

function dibujarRecorrido() {
    capaRecorrido.clearLayers();
    if (!planGeometria) return;
    const c = document.getElementById('planColor').value || '#2563eb';
    L.geoJSON(planGeometria, { style: { color: c, weight: 5, opacity: 0.85 } }).addTo(capaRecorrido);
    planBarrios.forEach((p, i) => L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', iconSize: [26, 26],
        html: `<div style="background:${c}; color:#fff; width:26px; height:26px; border-radius:50%; border:2px solid #fff; display:grid; place-items:center; font-weight:800; font-size:12px; box-shadow:0 1px 4px rgba(0,0,0,.4);">${i + 1}</div>` }) })
        .bindTooltip(p.barrio).addTo(capaRecorrido));
    try { mapaRutas.fitBounds(capaRecorrido.getBounds(), { padding: [30, 30] }); } catch (e) {}
}

// Descarga los límites de barrios del municipio desde OpenStreetMap y los guarda (una sola vez)
async function cargarLimitesOficiales() {
    infoMapaRuta('Cargando la división oficial (comunas y barrios) de Floridablanca...');
    try {
        const r = await fetch('data/floridablanca_barrios.json?v=1');
        if (!r.ok) throw new Error('No se encontró data/floridablanca_barrios.json (copia la carpeta "data" junto a admin.html)');
        const fc = await r.json();
        const filas = fc.features.map(f => ({ municipio: 'Floridablanca', barrio: f.properties.barrio, geojson: f, centro_lat: f.properties.centro_lat, centro_lng: f.properties.centro_lng,
            comuna: f.properties.comuna, comuna_nombre: f.properties.comuna_nombre, fuente: 'Secretaría de Planeación de Floridablanca – plano 2 (2016)', osm_id: null }));
        const del = await supabaseClient.from('barrios_geo').delete().eq('municipio', 'Floridablanca').is('comuna', null);
        if (del.error) throw del.error;
        const { error } = await supabaseClient.from('barrios_geo').upsert(filas, { onConflict: 'municipio,barrio' });
        if (error) throw error;
        await cargarBarriosMapa();
        infoMapaRuta(`✅ ${filas.length} barrios oficiales cargados en 8 comunas (digitalizados del plano de Planeación, 2016).`);
    } catch (err) { infoMapaRuta('No se pudo cargar la división oficial: ' + err.message + ' (¿ejecutaste el SQL 29?)', true); }
}

async function descargarLimitesOSM() {
    const mun = document.getElementById('mapaRutaMun').value;
    if (mun === 'Floridablanca') return cargarLimitesOficiales();
    if (!window.osmtogeojson) { infoMapaRuta('No se pudo cargar el conversor de mapas (osmtogeojson).', true); return; }
    infoMapaRuta(`Descargando barrios de ${mun} desde OpenStreetMap (puede tardar hasta un minuto)...`);
    const q = `[out:json][timeout:90];area["name"="${mun}"]["boundary"="administrative"]->.m;
(relation(area.m)["boundary"="administrative"]["admin_level"~"^(9|10)$"];relation(area.m)["place"~"^(suburb|neighbourhood|quarter)$"];way(area.m)["place"~"^(suburb|neighbourhood|quarter)$"];);out geom;`;
    try {
        const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
        if (!r.ok) throw new Error('Overpass respondió ' + r.status);
        const fc = window.osmtogeojson(await r.json());
        const vistos = new Set(), filas = [];
        fc.features.forEach(f => {
            const nombre = f.properties && (f.properties.name || (f.properties.tags && f.properties.tags.name));
            if (!nombre || !f.geometry || !/Polygon/.test(f.geometry.type)) return;
            const k = normNombre(nombre);
            if (vistos.has(k)) return;
            vistos.add(k);
            const b = L.geoJSON(f).getBounds(), c = b.getCenter();
            filas.push({ municipio: mun, barrio: nombre, osm_id: String(f.id || ''), geojson: f, centro_lat: c.lat, centro_lng: c.lng });
        });
        if (!filas.length) { infoMapaRuta(`OpenStreetMap no tiene límites de barrios para ${mun}.`, true); return; }
        const { error } = await supabaseClient.from('barrios_geo').upsert(filas, { onConflict: 'municipio,barrio' });
        if (error) throw error;
        await cargarBarriosMapa();
        infoMapaRuta(`${filas.length} barrios guardados para ${mun}.`);
    } catch (err) { infoMapaRuta('No se pudieron descargar los límites: ' + err.message, true); }
}

async function guardarPlanRuta() {
    const nombre = document.getElementById('planNombre').value.trim();
    const dias = diasSeleccionadosRuta(), hora = document.getElementById('planHora').value;
    if (!planBarrios.length) { infoMapaRuta('Toca al menos un barrio en el mapa.', true); return; }
    if (!nombre) { infoMapaRuta('Escribe un nombre para la ruta.', true); document.getElementById('planNombre').focus(); return; }
    if (!dias) { infoMapaRuta('Marca al menos un día de paso.', true); return; }
    if (!hora) { infoMapaRuta('Indica la hora de inicio.', true); document.getElementById('planHora').focus(); return; }
    if (planBarrios.length > 1 && !planGeometria) await calcularRecorrido(false);
    const anterior = planEditandoId ? planesGuardados.find(x => String(x.id) === String(planEditandoId)) : null;
    const fila = {
        nombre, municipio: document.getElementById('mapaRutaMun').value, color: document.getElementById('planColor').value,
        barrios: planBarrios, geometria: planGeometria, distancia_m: planDistancia, duracion_s: planDuracion,
        dias, hora, tipo_servicio: document.getElementById('planServicio').value.trim() || 'Recolección de residuos ordinarios', updated_at: new Date().toISOString()
    };
    const t = supabaseClient.from('rutas_planes');
    const { data, error } = planEditandoId ? await t.update(fila).eq('id', planEditandoId).select() : await t.insert([{ ...fila, activo: true, estado_hoy: 'programada', fecha_estado: hoyLocal(), creado_por: emailActual }]).select();
    if (error || !data || !data[0]) { infoMapaRuta('No se pudo guardar: ' + ((error && error.message) || 'sin respuesta') + ' (¿ejecutaste el SQL 28?)', true); return; }
    const sync = await supabaseClient.rpc('rutas_sincronizar_plan', { p_plan: data[0].id });
    if (sync.error) { infoMapaRuta('Ruta guardada, pero no se pudo sincronizar con la app ciudadana: ' + sync.error.message, true); }
    else infoMapaRuta(planEditandoId ? 'Cambios guardados.' : '✅ Ruta guardada como Programada. Pasará a "En curso" sola a la hora indicada.');
    if (anterior && (anterior.dias !== dias || anterior.hora !== hora)) {
        for (const b of planBarrios) await notificarCambioRuta({ dia_semana: anterior.dias, hora_estimada: anterior.hora, estado_recorrido: 'programada' },
            { barrio: b.barrio, municipio: b.municipio, dia_semana: dias, hora_estimada: hora, estado_recorrido: 'programada' });
    }
    limpiarPlanRuta();
    await cargarPlanesGuardados(); cargarRutas();
}

async function cargarPlanesGuardados() {
    const [p, n] = await Promise.all([
        supabaseClient.from('rutas_planes').select('*').order('created_at', { ascending: false }).limit(100),
        supabaseClient.from('rutas_novedades').select('*').eq('fecha', hoyLocal()).order('created_at', { ascending: false }).limit(300)
    ]);
    planesGuardados = p.data || [];
    novedadesHoy = {};
    (n.data || []).forEach(x => { (novedadesHoy[x.plan_id] = novedadesHoy[x.plan_id] || []).push(x); });
    if (p.error) { const c = document.getElementById('planesGuardados'); if (c) c.innerHTML = `<span style="color:#b71c1c;">Error: ${escaparHTML(p.error.message)} (¿ejecutaste el SQL 28?)</span>`; return; }
    pintarPlanesGuardados(); pintarRutasHoy(); refrescarEstiloBarrios();
}

const horaCorta = iso => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });

function pintarRutasHoy() {
    const c = document.getElementById('rutasHoy'), f = document.getElementById('rutasHoyFecha');
    if (!c) return;
    f.textContent = '· ' + diaHoyNombre() + ' ' + hoyLocal();
    const hoy = planesGuardados.filter(p => p.activo !== false && planPasaHoy(p)).sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
    if (!hoy.length) { c.innerHTML = '<div class="rt-vacio">No hay rutas programadas para hoy.</div>'; return; }
    c.innerHTML = hoy.map(p => {
        const est = p.estado_hoy || 'programada', id = p.id;
        const btn = (e, t, cls) => `<button type="button" class="rt-btn ${cls || ''}" data-ruta="estado" data-id="${id}" data-est="${e}">${t}</button>`;
        const acciones = est === 'programada' ? btn('en_curso', '▶ Iniciar ahora', 'rt-ok') + btn('suspendida', '⏸ Suspender hoy')
            : est === 'en_curso' ? btn('completada', '✅ Finalizar', 'rt-ok') + btn('incumplida', '❌ No se cumplió', 'rt-mal') + btn('suspendida', '⏸ Suspender')
            : btn('en_curso', '↩ Reabrir como En curso');
        const nov = (novedadesHoy[id] || []).slice(0, 3).map(x => `<li><b>${horaCorta(x.created_at)}</b> ${escaparHTML(TIPOS_NOVEDAD[x.tipo] || TIPOS_VER[x.tipo] || x.tipo)}${x.detalle ? ' — ' + escaparHTML(x.detalle) : ''}</li>`).join('');
        return `<div class="rt-card rt-borde-${est}">
            <div class="rt-card-top"><span class="rt-barrita" style="background:${escaparHTML(p.color || '#2563eb')}"></span><div style="flex:1;"><strong>${escaparHTML(p.nombre)}</strong><br><small>🕒 ${escaparHTML(p.hora || '--:--')} · ${(p.barrios || []).length} barrio(s)</small></div>${chipEstado(est)}</div>
            <div class="rt-barrios">${(p.barrios || []).map(b => escaparHTML(b.barrio)).join(' → ')}</div>
            ${nov ? `<ul class="rt-nov">${nov}</ul>` : ''}
            <div class="rt-acciones">${acciones}</div>
            <details class="rt-det"><summary>➕ Registrar novedad</summary>
                <div class="rt-novform"><select id="nvTipo_${id}">${Object.entries(TIPOS_NOVEDAD).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
                <input type="text" id="nvTxt_${id}" placeholder="¿Qué pasó? (opcional)"><button type="button" class="rt-btn" data-ruta="novedad" data-id="${id}">Registrar</button></div></details>
        </div>`;
    }).join('');
}

function pintarPlanesGuardados() {
    const c = document.getElementById('planesGuardados');
    if (!c) return;
    c.innerHTML = planesGuardados.length ? planesGuardados.map(p => {
        const pasaHoy = planPasaHoy(p) && p.activo !== false;
        const chip = p.activo === false ? chipEstado('suspendida').replace('Suspendida', 'Pausada') : (pasaHoy ? chipEstado(p.estado_hoy || 'programada') : '<span class="rt-chip rt-programada">🕒 Programada</span>');
        return `<div class="rt-card">
            <div class="rt-card-top"><span class="rt-barrita" style="background:${escaparHTML(p.color || '#2563eb')}"></span><div style="flex:1;"><strong>${escaparHTML(p.nombre)}</strong><br><small>${escaparHTML(p.dias || 'Sin días')} · 🕒 ${escaparHTML(p.hora || '--:--')}</small></div>${chip}</div>
            <div class="rt-barrios">${(p.barrios || []).length} barrio(s)${p.distancia_m ? ' · ' + (p.distancia_m / 1000).toFixed(1) + ' km' : ''} · ${escaparHTML(p.municipio || '')}</div>
            <div class="rt-acciones"><button type="button" class="rt-btn" data-ruta="ver" data-id="${p.id}">👁 Ver en mapa</button><button type="button" class="rt-btn" data-ruta="editar" data-id="${p.id}">✏️ Editar</button>
            <button type="button" class="rt-btn" data-ruta="pausa" data-id="${p.id}">${p.activo === false ? '▶ Reanudar' : '⏸ Pausar'}</button><button type="button" class="rt-btn rt-mal" data-ruta="borrar" data-id="${p.id}">🗑️</button></div></div>`;
    }).join('') : '<div class="rt-vacio">Todavía no hay rutas. Crea la primera desde el mapa.</div>';
}

function cargarPlanEnFormulario(p) {
    const sel = document.getElementById('mapaRutaMun');
    if (p.municipio && sel.value !== p.municipio) { sel.value = p.municipio; cargarBarriosMapa(); }
    planBarrios = (p.barrios || []).map(b => ({ ...b })); planGeometria = p.geometria; planDistancia = p.distancia_m; planDuracion = p.duracion_s;
    document.getElementById('planNombre').value = p.nombre || '';
    document.getElementById('planColor').value = p.color || '#2563eb';
    document.getElementById('planHora').value = p.hora || '';
    document.getElementById('planServicio').value = p.tipo_servicio || 'Recolección de residuos ordinarios';
    marcarDiasRuta(p.dias);
    dibujarRecorrido(); refrescarEstiloBarrios();
}

function verPlanGuardado(id) {
    const p = planesGuardados.find(x => String(x.id) === String(id));
    if (!p) return;
    planEditandoId = null; cargarPlanEnFormulario(p);
    document.getElementById('cardMapaRutas').scrollIntoView({ behavior: 'smooth' });
    infoMapaRuta('Vista de la ruta. Usa "Editar" para modificarla.');
}

function editarPlan(id) {
    const p = planesGuardados.find(x => String(x.id) === String(id));
    if (!p) { infoMapaRuta('Esa ruta ya no existe.', true); return; }
    planEditandoId = p.id; cargarPlanEnFormulario(p);
    document.getElementById('rtTitulo').textContent = '✏️ Editando: ' + p.nombre;
    document.getElementById('btnGuardarPlan').textContent = '💾 Guardar cambios';
    document.getElementById('cardMapaRutas').scrollIntoView({ behavior: 'smooth' });
}

async function borrarPlanGuardado(id) {
    if (!confirm('¿Eliminar esta ruta? También se quitará de la app de los ciudadanos.')) return;
    await supabaseClient.from('rutas_recoleccion').delete().eq('plan_id', id);
    const { error } = await supabaseClient.from('rutas_planes').delete().eq('id', id);
    if (error) { infoMapaRuta('No se pudo eliminar: ' + error.message, true); return; }
    if (String(planEditandoId) === String(id)) limpiarPlanRuta();
    await cargarPlanesGuardados(); cargarRutas();
}

async function alternarActivoPlan(id) {
    const p = planesGuardados.find(x => String(x.id) === String(id));
    if (!p) return;
    const { error } = await supabaseClient.from('rutas_planes').update({ activo: p.activo === false, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { alert('No se pudo cambiar: ' + error.message); return; }
    await supabaseClient.rpc('rutas_sincronizar_plan', { p_plan: Number(id) });
    await cargarPlanesGuardados(); cargarRutas();
}

async function cambiarEstadoPlan(id, estado) {
    const p = planesGuardados.find(x => String(x.id) === String(id));
    if (!p) return;
    let detalle = null;
    if (['incumplida', 'suspendida'].includes(estado)) {
        detalle = prompt(estado === 'incumplida' ? '¿Por qué no se cumplió la ruta?' : '¿Por qué se suspende la ruta hoy?');
        if (detalle === null) return;
        detalle = detalle.trim() || (estado === 'incumplida' ? 'No se cumplió' : 'Suspendida');
    } else if (estado === 'completada') detalle = 'Ruta finalizada';
    else if (estado === 'en_curso') detalle = p.estado_hoy === 'programada' ? 'Iniciada manualmente' : 'Reabierta';
    const { error } = await supabaseClient.rpc('rutas_cambiar_estado', { p_plan: Number(id), p_estado: estado, p_tipo: estado === 'en_curso' ? 'inicio' : estado === 'completada' ? 'finalizada' : estado, p_detalle: detalle, p_autor: emailActual, p_origen: 'ecostan' });
    if (error) { alert('No se pudo cambiar el estado: ' + error.message); return; }
    if (['incumplida', 'suspendida'].includes(estado)) {
        for (const b of (p.barrios || [])) await notificarCambioRuta({ dia_semana: p.dias, hora_estimada: p.hora, estado_recorrido: p.estado_hoy },
            { barrio: b.barrio, municipio: b.municipio, dia_semana: p.dias, hora_estimada: p.hora, estado_recorrido: estado });
    }
    await cargarPlanesGuardados(); cargarRutas();
}

async function registrarNovedad(id) {
    const tipo = document.getElementById('nvTipo_' + id).value, txt = document.getElementById('nvTxt_' + id).value.trim();
    const { error } = await supabaseClient.rpc('rutas_cambiar_estado', { p_plan: Number(id), p_estado: null, p_tipo: tipo, p_detalle: txt || (TIPOS_NOVEDAD[tipo] || tipo), p_autor: emailActual, p_origen: 'ecostan' });
    if (error) { alert('No se pudo registrar: ' + error.message); return; }
    await cargarPlanesGuardados();
}

/* Refresco: tiempo real + respaldo cada minuto mientras se ve el módulo */
setInterval(() => { const s = document.getElementById('selectBandeja'); if (s && s.value === 'gestion_rutas' && !document.hidden) cargarPlanesGuardados(); }, 60000);

/* ============================================================
   OPERACIÓN DE RECICLADORES (datos de CicloGo mediante el puente seguro)
   El navegador nunca habla con CicloGo: llama a la función puente-ciclogo de EcoSTAN,
   que valida tu permiso y consulta a CicloGo con un secreto guardado en el servidor.
   ============================================================ */
let opCache = { recicladores: null, pesajes: null, empresas: null, solicitudes: [] };
const puedeOperarCiclo = () => esSuperadmin || ['aseo', 'recicladores'].includes(dependenciaUsuario);
const kgFmt = n => (Number(n) || 0).toLocaleString('es-CO', { maximumFractionDigits: 1 });
const MATERIALES_OP = ['PET', 'Cartón', 'Papel', 'Vidrio', 'Chatarra / Metal', 'Plástico (otros)', 'Textil', 'Aparatos y cables'];

// Limita lo que viene de CicloGo a la organización del usuario (y a las empresas de su territorio)
async function alcanceCiclo(accion, datos) {
    const al = alcanceActual;
    if (!al || !al.limitado) return datos;
    const ids = new Set((al.recicladores || []).map(String)), emp = new Set((al.empresas_ciclogo || []).map(String));
    const recOk = r => ids.has(String(r.id)) || emp.has(String(r.empresa_id));
    if (accion === 'recicladores') return Array.isArray(datos) ? datos.filter(recOk) : datos;
    if (accion === 'empresas') return Array.isArray(datos) ? datos.filter(e => emp.has(String(e.id))) : datos;
    if (accion === 'pesajes' || accion === 'solicitudes_pesables') return Array.isArray(datos) ? datos.filter(p => ids.has(String(p.reciclador_id)) || emp.has(String(p.empresa_id))) : datos;
    if (accion === 'resumen') {
        const [r, p] = await Promise.all([puenteCiclo('recicladores'), puenteCiclo('pesajes')]);
        const lr = r || [], lp = (p || []).filter(x => Date.now() - new Date(x.created_at) <= 30 * 86400000);
        return { ...datos, recicladores: lr.length, en_linea: lr.filter(x => x.en_linea).length, sin_verificar: lr.filter(x => !x.verificado).length, kg_30d: lp.reduce((a, x) => a + Number(x.peso_kg || 0), 0) };
    }
    return datos;
}

async function puenteCiclo(accion, extra) {
    try {
        const { data, error } = await supabaseClient.functions.invoke('puente-ciclogo', { body: { accion, ...(extra || {}) } });
        if (error) {
            let msg = error.message;
            try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
            throw new Error(msg);
        }
        if (data && data.error) throw new Error(data.error);
        return data ? await alcanceCiclo(accion, data.data) : null;
    } catch (err) {
        console.warn('[Puente CicloGo]', accion, err.message);
        puenteCiclo.ultimoError = err.message;
        return null;
    }
}

function avisoPuente(c) {
    c.innerHTML = `<div class="card" style="padding:18px;"><h4>No se pudo leer CicloGo</h4>
        <p style="font-size:13px; color:#b71c1c; margin:8px 0;">${escaparHTML(puenteCiclo.ultimoError || 'Sin respuesta')}</p>
        <p style="font-size:12px; color:#666;">Revisa que estén desplegadas las funciones <b>puente-ciclogo</b> (EcoSTAN) y <b>puente-lectura</b> (CicloGo) y los secrets <b>PUENTE_SECRET</b> y <b>CICLOGO_PUENTE_URL</b>.</p></div>`;
}

async function cargarOperacion(tabla) {
    const c = document.getElementById('operacionContenido');
    c.innerHTML = '<p style="padding:20px; color:#666;">Consultando CicloGo...</p>';
    if (tabla === 'operacion_recicladores') {
        const [rr, ee] = await Promise.all([puenteCiclo('recicladores'), puenteCiclo('empresas')]);
        if (!rr) return avisoPuente(c);
        opCache.recicladores = rr; opCache.empresas = ee || [];
        return pintarRecicladores();
    }
    if (tabla === 'operacion_pesajes') {
        const [p, r, s] = await Promise.all([puenteCiclo('pesajes'), puenteCiclo('recicladores'), puedeOperarCiclo() ? puenteCiclo('solicitudes_pesables') : Promise.resolve([])]);
        if (!p) return avisoPuente(c);
        opCache.pesajes = p; opCache.recicladores = r || []; opCache.solicitudes = s || [];
        return pintarPesajes();
    }
    if (tabla === 'operacion_ecas') {
        const [e, p, r] = await Promise.all([puenteCiclo('empresas'), puenteCiclo('pesajes'), puenteCiclo('recicladores')]);
        if (!e) return avisoPuente(c);
        opCache.empresas = e; opCache.pesajes = p || []; opCache.recicladores = r || [];
        return pintarEcas();
    }
}

function pintarRecicladores() {
    const c = document.getElementById('operacionContenido');
    const q = normTxt(document.getElementById('opBuscar') ? document.getElementById('opBuscar').value : '');
    const est = document.getElementById('opEstado') ? document.getElementById('opEstado').value : 'todos';
    const todos = opCache.recicladores || [];
    let lista = todos.filter(r => (!q || normTxt([r.nombre_completo, r.cedula, r.telefono].join(' ')).includes(q))
        && (est === 'todos' || (est === 'en_linea' && r.en_linea) || (est === 'off' && !r.en_linea) || (est === 'sin_verificar' && !r.verificado)));
    const tarj = (t, v, n) => `<div class="kpi-card"><h4>${t}</h4><div class="kpi-valor">${v}</div><small>${n}</small></div>`;
    c.innerHTML = `
      <div class="cards-grid" style="margin-bottom:16px;">
        ${tarj('Recicladores registrados', todos.length, 'En la red CicloGo')}
        ${tarj('En línea ahora', todos.filter(r => r.en_linea).length, 'Disponibles en campo')}
        ${tarj('Sin verificar', todos.filter(r => !r.verificado).length, 'Pendientes de validación')}
      </div>
      <div class="filters-card" style="margin-bottom:12px;">
        <div class="filter-group"><label>Buscar (nombre, cédula, teléfono)</label><input type="text" id="opBuscar" oninput="pintarRecicladores()" value="${escaparHTML(document.getElementById('opBuscar') ? document.getElementById('opBuscar').value : '')}"></div>
        <div class="filter-group"><label>Estado</label><select id="opEstado" onchange="pintarRecicladores()">
          <option value="todos">Todos</option><option value="en_linea">En línea</option><option value="off">Desconectados</option><option value="sin_verificar">Sin verificar</option></select></div>
      </div>
      <div class="table-container"><table><thead><tr><th>Reciclador</th><th>Cédula / Teléfono</th><th>Vehículo / Zona</th><th>RUPS</th><th>Asociación</th><th>Estado</th>${esSuperadmin ? '<th>Verificación</th>' : ''}${puedeOperarCiclo() ? '<th>Vinculación</th>' : ''}</tr></thead><tbody>
      ${lista.length ? lista.map(r => `<tr>
        <td><strong>${escaparHTML(r.nombre_completo)}</strong>${r.verificado ? ' ✅' : ''}</td>
        <td>${escaparHTML(r.cedula || '—')}<br><small>${escaparHTML(r.telefono || '')}</small></td>
        <td>${escaparHTML(r.vehiculo || '—')}<br><small>${escaparHTML(r.zona || '')}</small></td>
        <td>${escaparHTML(r.rups || 'SIN RUPS')}</td><td>${escaparHTML(r.asociacion || 'Ninguna')}</td>
        <td><span class="status-badge status-${r.en_linea ? 'resuelto' : 'pendiente'}">${r.en_linea ? 'EN LÍNEA' : 'OFF'}</span></td>
        ${esSuperadmin ? `<td><button class="btn-chat-admin" onclick="verificarReciclador('${escaparHTML(String(r.id))}', ${r.verificado ? 'false' : 'true'})">${r.verificado ? 'Quitar verificación' : '✅ Verificar'}</button></td>` : ''}
        ${puedeOperarCiclo() ? celdaVinculacion(r) : ''}
      </tr>`).join('') : `<tr><td colspan="8" style="text-align:center; padding:18px;">Sin recicladores con ese filtro.</td></tr>`}
      </tbody></table></div>`;
    const sel = document.getElementById('opEstado'); if (sel) sel.value = est;
}

async function verificarReciclador(id, valor) {
    if (!confirm(valor ? '¿Marcar a este reciclador como verificado?' : '¿Quitar la verificación a este reciclador?')) return;
    const ok = await puenteCiclo('verificar_reciclador', { id, verificado: valor });
    if (!ok) { alert('No se pudo actualizar: ' + (puenteCiclo.ultimoError || '')); return; }
    cargarOperacion('operacion_recicladores');
}

function celdaVinculacion(r) {
    const id = escaparHTML(String(r.id));
    if (r.empresa_id) return `<td><small>${escaparHTML(r.asociacion || '')}</small><br><button class="btn-logout" style="padding:4px 8px; font-size:12px;" onclick="desvincularReciclador('${id}')">Desvincular</button></td>`;
    const ops = (opCache.empresas || []).map(e => `<option value="${escaparHTML(String(e.id))}">${escaparHTML(e.nombre)}</option>`).join('');
    return `<td><select id="vinc-${id}" style="max-width:150px;">${ops}</select><br><button class="btn-chat-admin" style="margin-top:4px;" onclick="vincularReciclador('${id}')">➕ Vincular</button></td>`;
}

async function vincularReciclador(id) {
    const sel = document.getElementById('vinc-' + id);
    if (!sel || !sel.value) { alert('No hay empresas registradas para vincular.'); return; }
    if (!confirm('¿Vincular este reciclador a "' + sel.options[sel.selectedIndex].text + '"?')) return;
    const ok = await puenteCiclo('vincular_reciclador', { id, empresa_id: sel.value });
    if (!ok) { alert('No se pudo vincular: ' + (puenteCiclo.ultimoError || '')); return; }
    cargarOperacion('operacion_recicladores');
}

async function desvincularReciclador(id) {
    if (!confirm('¿Desvincular a este reciclador de su empresa?')) return;
    const ok = await puenteCiclo('desvincular_reciclador', { id });
    if (!ok) { alert('No se pudo desvincular: ' + (puenteCiclo.ultimoError || '')); return; }
    cargarOperacion('operacion_recicladores');
}

async function alternarPremiumEmpresa(id, activar) {
    if (!confirm(activar ? '¿Activar el plan Premium para esta empresa?' : '¿Desactivar el plan Premium de esta empresa?')) return;
    const ok = await puenteCiclo('toggle_premium', { id, activar });
    if (!ok) { alert('No se pudo cambiar el plan: ' + (puenteCiclo.ultimoError || '')); return; }
    cargarOperacion('operacion_ecas');
}

// ---- Registro de pesaje en báscula (acredita EcoPuntos a los ciudadanos) ----
function formularioPesaje() {
    const vinc = opCache.recicladores || [];
    return `<div class="card" style="padding:16px; margin-bottom:18px;">
      <h4 style="margin-bottom:10px;">⚖️ Registrar pesaje de entrada y acreditar EcoPuntos</h4>
      <div class="form-banner-grid">
        <div class="form-banner-group"><label>Reciclador *</label><select id="pesReciclador" onchange="pintarSolicitudesPesaje()"><option value="">Selecciona...</option>${vinc.map(r => `<option value="${escaparHTML(String(r.id))}">${escaparHTML(r.nombre_completo)} (CC ${escaparHTML(r.cedula || '—')})${r.verificado ? '' : ' · sin verificar'}</option>`).join('')}</select></div>
        <div class="form-banner-group"><label>Material *</label><select id="pesMaterial">${MATERIALES_OP.map(m => `<option>${m}</option>`).join('')}</select></div>
        <div class="form-banner-group"><label>Peso (kg) *</label><input type="number" id="pesPeso" step="0.1" min="0.1" placeholder="Ej: 45.0"></div>
        <div class="form-banner-group"><label>Calidad</label><select id="pesCalidad"><option value="limpio_seco">Limpio y seco (aprobado)</option><option value="humedo">Húmedo</option><option value="contaminado">Contaminado</option></select></div>
        <div class="form-banner-group"><label>Municipio de origen *</label><select id="pesMuni"><option>Bucaramanga</option><option>Floridablanca</option><option>Girón</option><option>Piedecuesta</option></select></div>
      </div>
      <label style="font-size:12px; font-weight:700; display:block; margin:10px 0 4px;">Recogidas con QR verificado (marca varias si pesas un lote: el peso se reparte entre ellas)</label>
      <div id="pesSolicitudes" style="border:1px solid #ddd; border-radius:8px; padding:8px; max-height:210px; overflow:auto; background:#fff;"><small style="color:#666;">Selecciona primero un reciclador...</small></div>
      <button class="btn-publicar-banner" id="btnRegistrarPesaje" style="margin-top:12px;" onclick="registrarPesaje()">✅ Guardar pesaje y acreditar EcoPuntos</button>
    </div>`;
}

function pintarSolicitudesPesaje() {
    const id = document.getElementById('pesReciclador').value, c = document.getElementById('pesSolicitudes');
    if (!id) { c.innerHTML = '<small style="color:#666;">Selecciona primero un reciclador...</small>'; return; }
    const propias = (opCache.solicitudes || []).filter(s => String(s.reciclador_id || '').trim() === String(id).trim());
    if (!propias.length) { c.innerHTML = '<small style="color:#666;">Este reciclador no tiene recogidas con QR verificado. Si no marcas ninguna, el pesaje se guarda sin EcoPuntos.</small>'; return; }
    c.innerHTML = propias.map(s => {
        const queda = s.plazo_pesaje_hasta ? (new Date(s.plazo_pesaje_hasta) - Date.now()) / 36e5 : null;
        const plazo = queda === null ? '' : (queda <= 0 ? ' · <b style="color:#b91c1c;">plazo vencido</b>' : ` · quedan ${Math.floor(queda)} h`);
        return `<label style="display:flex; gap:8px; align-items:center; padding:5px 2px; border-bottom:1px solid #eee; font-size:13px;">
            <input type="checkbox" class="pes-chk" value="${escaparHTML(String(s.id))}">
            <span style="flex:1;">#${escaparHTML(String(s.codigo || s.id))} · ${escaparHTML(s.nombre_reporte || s.usuario_email || 'Ciudadano')} (${escaparHTML(s.tipo_residuo || '')})${plazo}</span>
            <input type="number" class="pes-rel" min="0.1" step="0.1" value="1" title="Peso relativo (kg estimados). Si no sabes, deja 1" style="width:64px;"></label>`;
    }).join('') + '<small style="color:#666; display:block; margin-top:6px;">Con 2 o más marcadas, el peso se reparte según el número de la derecha (deja 1 para partes iguales).</small>';
}

async function registrarPesaje() {
    const rec = document.getElementById('pesReciclador').value, peso = parseFloat(document.getElementById('pesPeso').value);
    if (!rec || !(peso > 0)) { alert('Selecciona un reciclador y escribe el peso.'); return; }
    const marcadas = [...document.querySelectorAll('#pesSolicitudes .pes-chk:checked')];
    const pesaje = {
        reciclador_id: rec, material: document.getElementById('pesMaterial').value, peso_kg: peso,
        calidad: document.getElementById('pesCalidad').value, municipio: document.getElementById('pesMuni').value,
        solicitudes: marcadas.map(c => c.value),
        pesos: marcadas.map(c => parseFloat(c.closest('label').querySelector('.pes-rel').value) || 1)
    };
    const btn = document.getElementById('btnRegistrarPesaje');
    btn.disabled = true; btn.textContent = 'Registrando y acreditando puntos...';
    const r = await puenteCiclo('registrar_pesaje', { pesaje });
    btn.disabled = false; btn.textContent = '✅ Guardar pesaje y acreditar EcoPuntos';
    if (!r) { alert(puenteCiclo.ultimoError || 'No se pudo registrar el pesaje.'); return; }
    alert(r.puntos > 0 ? `¡Pesaje guardado! ${r.lote ? 'Lote: ' : ''}${Number(r.puntos).toLocaleString()} EcoPuntos acreditados.${r.mensaje ? '\n' + r.mensaje : ''}` : (r.mensaje || 'Pesaje registrado.'));
    cargarOperacion('operacion_pesajes');
}

function pintarPesajes() {
    const c = document.getElementById('operacionContenido');
    const mapaRec = {}; (opCache.recicladores || []).forEach(r => { mapaRec[r.id] = r; });
    const d1 = document.getElementById('opDesde') ? document.getElementById('opDesde').value : '';
    const d2 = document.getElementById('opHasta') ? document.getElementById('opHasta').value : '';
    const lista = (opCache.pesajes || []).filter(p => (!d1 || (p.created_at || '').slice(0, 10) >= d1) && (!d2 || (p.created_at || '').slice(0, 10) <= d2));
    const total = lista.reduce((a, p) => a + Number(p.peso_kg || 0), 0);
    const porMat = {}; MATERIALES_OP.forEach(m => porMat[m] = 0);
    lista.forEach(p => { const k = MATERIALES_OP.find(m => normTxt(m) === normTxt(p.material)) || 'Plástico (otros)'; porMat[k] += Number(p.peso_kg || 0); });
    c.innerHTML = (puedeOperarCiclo() ? formularioPesaje() : '') + `
      <div class="filters-card" style="margin-bottom:12px;">
        <div class="filter-group"><label>Desde</label><input type="date" id="opDesde" value="${d1}" onchange="pintarPesajes()"></div>
        <div class="filter-group"><label>Hasta</label><input type="date" id="opHasta" value="${d2}" onchange="pintarPesajes()"></div>
        <button class="btn-excel" onclick="exportarPesajesCSV()">📊 Exportar CSV (SUI)</button>
      </div>
      <div class="cards-grid" style="margin-bottom:16px;">
        <div class="kpi-card"><h4>Pesajes</h4><div class="kpi-valor">${lista.length}</div><small>En el periodo</small></div>
        <div class="kpi-card"><h4>Kilogramos</h4><div class="kpi-valor">${kgFmt(total)}</div><small>${(total / 1000).toFixed(3)} toneladas (SUI)</small></div>
      </div>
      <div class="quick-grid" style="margin-bottom:18px;">${MATERIALES_OP.map(m => `<div class="quick-btn" style="cursor:default;"><strong>${escaparHTML(m)}</strong><br>${kgFmt(porMat[m])} kg <small style="color:#888;">(${total ? (porMat[m] / total * 100).toFixed(1) : '0.0'}%)</small></div>`).join('')}</div>
      <div class="table-container"><table><thead><tr><th>Fecha</th><th>Reciclador</th><th>Material</th><th>Peso (kg)</th><th>Calidad</th><th>Municipio</th></tr></thead><tbody>
      ${lista.slice(0, 300).map(p => `<tr><td>${new Date(p.created_at).toLocaleString()}</td><td>${escaparHTML((mapaRec[p.reciclador_id] || {}).nombre_completo || '—')}</td><td>${escaparHTML(p.material || '')}</td><td>${kgFmt(p.peso_kg)}</td><td>${escaparHTML(p.calidad || '')}</td><td>${escaparHTML(p.municipio || '')}</td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center; padding:18px;">Sin pesajes en el periodo.</td></tr>'}
      </tbody></table></div>${lista.length > 300 ? '<p style="font-size:12px; color:#666; margin-top:8px;">Se muestran los 300 más recientes; el CSV incluye todos.</p>' : ''}`;
}

function exportarPesajesCSV() {
    const mapaRec = {}; (opCache.recicladores || []).forEach(r => { mapaRec[r.id] = r; });
    const d1 = document.getElementById('opDesde').value, d2 = document.getElementById('opHasta').value;
    const filas = (opCache.pesajes || []).filter(p => (!d1 || (p.created_at || '').slice(0, 10) >= d1) && (!d2 || (p.created_at || '').slice(0, 10) <= d2));
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const csv = '﻿' + ['Fecha,Reciclador,Cédula,Material,Peso_kg,Calidad,Municipio'].concat(filas.map(p => {
        const r = mapaRec[p.reciclador_id] || {};
        return [p.created_at, r.nombre_completo, r.cedula, p.material, p.peso_kg, p.calidad, p.municipio].map(q).join(',');
    })).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `pesajes_ciclogo_${hoyLocal()}.csv`; a.click();
}

function pintarEcas() {
    const c = document.getElementById('operacionContenido');
    const pes = opCache.pesajes || [], rec = opCache.recicladores || [];
    c.innerHTML = `<div class="table-container"><table><thead><tr><th>Empresa / Asociación</th><th>NIT / RUPS</th><th>Municipio</th><th>Barrios asignados</th><th>Recicladores</th><th>Toneladas (SUI)</th><th>IA Premium</th></tr></thead><tbody>
      ${(opCache.empresas || []).map(e => {
          const vinc = rec.filter(r => r.empresa_id === e.id || (r.asociacion && normTxt(r.asociacion) === normTxt(e.nombre)));
          const kg = pes.filter(p => p.empresa_id === e.id).reduce((a, p) => a + Number(p.peso_kg || 0), 0);
          return `<tr><td><strong>${escaparHTML(e.nombre)}</strong><br><small>${escaparHTML(e.representante_legal || '')}</small></td>
            <td>${escaparHTML(e.nit || '—')}<br><small>RUPS: ${escaparHTML(e.rups || 'En trámite')}</small></td><td>${escaparHTML(e.municipio || '—')}</td>
            <td>${escaparHTML(e.barrios_asignados || 'Acuerdo municipal general')}</td>
            <td>${vinc.length} <small>(${vinc.filter(r => r.en_linea).length} en línea)</small></td><td>${(kg / 1000).toFixed(3)}</td><td>${e.ia_premium ? '💎 Activa' : '—'}${esSuperadmin ? `<br><button class="btn-chat-admin" style="margin-top:4px;" onclick="alternarPremiumEmpresa('${escaparHTML(String(e.id))}', ${e.ia_premium ? 'false' : 'true'})">${e.ia_premium ? 'Desactivar' : 'Activar'}</button>` : ''}</td></tr>`;
      }).join('') || '<tr><td colspan="7" style="text-align:center; padding:18px;">No hay empresas registradas.</td></tr>'}
      </tbody></table></div>`;
}

// Funciones que admin.html invoca desde atributos onclick / onchange / onsubmit

/* ============================================================
   ANALÍTICA GENERAL Y PLAN PREMIUM POR PROVEEDOR (ver analitica.js)
   ============================================================ */
const analitica = crearAnalitica({
    db: supabaseClient, puente: puenteCiclo, puenteError: () => puenteCiclo.ultimoError,
    esc: escaparHTML, norm: normTxt, tablas: TABLAS_REPORTES, nombres: NOMBRES_TABLAS,
    umbral: () => UMBRAL_EFICIENCIA, rol: () => ({ superadmin: esSuperadmin, dep: dependenciaUsuario }),
    filtros: () => ({ mun: document.getElementById('filtroMunicipio').value, d1: document.getElementById('filtroFechaInicio').value, d2: document.getElementById('filtroFechaFin').value }),
    puede: v => bandejaDisponible(v), competencia: filtrarPorCompetencia, bitacora: () => renderBitacora(null), crearRuta: crearRutaSugerida, fmtHoras: formatoHoras, alcance: () => alcanceActual
});
const territorios = crearTerritorios({
    db: supabaseClient, esc: escaparHTML, puente: puenteCiclo, puenteError: () => puenteCiclo.ultimoError,
    modulos: () => { const v = new Set(), r = []; MENU_AREAS.forEach(a => a.items.forEach(i => { if (i.v === 'superadmin_panel' || v.has(i.v)) return; v.add(i.v); r.push(i); })); return r; }
});

// Abre Rutas con los barrios sugeridos ya marcados en el mapa
async function crearRutaSugerida(p) {
    irAModulo('gestion_rutas');
    for (let i = 0; i < 40 && !mapaRutasListo; i++) await new Promise(r => setTimeout(r, 250));
    const sel = document.getElementById('mapaRutaMun');
    sel.value = p.municipio; await cargarBarriosMapa();
    limpiarPlanRuta();
    p.barrios.forEach(n => { const b = barriosGeo.find(x => normNombre(x.barrio) === normNombre(n)); if (b && enPlan(b) < 0) alternarBarrioPlan(b); });
    document.getElementById('planNombre').value = p.nombre || '';
    marcarDiasRuta(p.dia || '');
    document.getElementById('planHora').value = p.hora || '06:00';
    refrescarEstiloBarrios();
    infoMapaRuta('Ruta sugerida lista: revisa los barrios, ajusta días y hora, y pulsa "Guardar ruta".');
    if (planBarrios.length > 1) calcularRecorrido(true);
    document.getElementById('cardMapaRutas').scrollIntoView({ behavior: 'smooth' });
}

Object.assign(window, {
    pintarRecicladores, verificarReciclador, pintarPesajes, exportarPesajesCSV,
    vincularReciclador, desvincularReciclador, alternarPremiumEmpresa, pintarSolicitudesPesaje, registrarPesaje,
    cargarBarriosMapa, descargarLimitesOSM, calcularRecorrido, guardarPlanRuta, limpiarPlanRuta, refrescarEstiloBarrios,
    irAModulo, alternarSidebar,
    eliminarReporte, eliminarCerradosBandeja, exportarBitacora,
    mantRevisarConfirmacion, ejecutarMantenimiento,
    abrirChatModal,
    actualizarEstado,
    alternarBannerActivo,
    alternarPremiumUsuario,
    alternarTipoEnlaceBanner,
    alternarUsuarioPanel,
    aplicarFiltros,
    avisarPasoCamion,
    bloquearUsuario,
    cambiarBandeja,
    cargarAnalitica, cargarPremium, crearRutaSugerida,
    cargarMetricasBanners,
    cerrarChatModal,
    cerrarSesion,
    crearUsuarioPanel,
    desbloquearUsuario,
    cargarLimitesOficiales, editarPlan, verPlanGuardado, filtrarBuscadorBarrios, registrarNovedad, cambiarEstadoPlan, alternarActivoPlan, borrarPlanGuardado,
    editarUsuarioPanel,
    eliminarBanner,
    eliminarRuta,
    enviarMensajeAdmin,
    exportarExcel,
    guardarConfigAlerta,
    guardarConfigDependencia,
    limpiarFiltros,
    refrescarYVerAlerta,
    renderizarRutas,
    restablecerClaveUsuario
});

/* ==========================================
   ARRANQUE (al final del archivo para que todas las variables ya existan)
========================================== */
// alDOMListo ejecuta de inmediato si el DOM ya cargó (con módulos ES el evento puede haber pasado)
alDOMListo(() => {
    const select = document.getElementById('selectBandeja');
    const optAbandonados = document.getElementById('optAbandonados');
    const optViolenciaAnimal = document.getElementById('optViolenciaAnimal');
    const optCiudadania = document.getElementById('optCiudadania');
    const optUsuarios = document.getElementById('optUsuarios');
    const optBloqueados = document.getElementById('optBloqueados');

    if (dependenciaUsuario === 'publicidad' || dependenciaUsuario === 'marketing') {
        select.value = 'gestion_banners';
    } else if (dependenciaUsuario === 'recicladores' || dependenciaUsuario === 'aseo') {
        if (optAbandonados) optAbandonados.remove();
        if (optViolenciaAnimal) optViolenciaAnimal.remove();
        if (optCiudadania) optCiudadania.remove();
        if (optUsuarios) optUsuarios.remove();
        if (optBloqueados) optBloqueados.remove();
        const optKpi = document.getElementById('optKpi');
        if (optKpi) optKpi.remove();
        select.value = 'inicio_resumen';
    }

    construirMenuLateral();
    cargarDatosBandeja();
    iniciarEscuchaRealtimeAdmin();
    setInterval(refrescarContadores, 90000);
    escucharRutasAdmin();
    permisosPromesa = aplicarPermisosDependencia();
    solicitarPermisoNotificacionesEscritorio();
    inicializarFormularioBanners();
});

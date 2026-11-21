/* ==========================================
   modules/banners/banners.js
   Publicidad y avisos institucionales: carrusel de inicio, sección Avisos,
   métricas de vistas/clics y formulario de publicación de banners.
   Es un módulo comercial aislado: no depende de reportes, mapas ni puntos.
========================================== */
import { supabaseClient } from '../../core/supabaseClient.js';
import { datosUsuarioApp } from '../../core/authService.js';
import { escaparHtml, normalizarTexto, fechaLocalISO, abrirEnlaceExterno } from '../../core/utils.js';
import { mostrarSeccion, alEntrarEnSeccion } from '../../core/navigation.js';

let bannerIndiceActual = 0;
let bannerIntervalo = null;
let bannersCargados = [];
let avisoDestacadoId = null;

const BANNER_POR_DEFECTO = [{
    titulo: 'Ayudemos a mantener <strong>Bucaramanga limpia</strong>',
    descripcion: 'Consulta las rutas de recolección, avisos y recibe información de interés ambiental.',
    texto_boton: '🌱 Ver iniciativas'
}];

export async function cargarBanners() {
    const track = document.getElementById('bannerTrack');
    const dotsContenedor = document.getElementById('bannerDots');
    if (!track || !dotsContenedor) return;

    // Toma la lista de banners desde banners-config.js o usa la lista por defecto
    let banners = window.MIS_BANNERS || BANNER_POR_DEFECTO;

    try {
        if (supabaseClient) {
            const { data, error } = await supabaseClient.from('banners').select('*');
            if (!error && Array.isArray(data)) {
                const visibles = data.filter(bannerVisibleParaUsuario);
                if (visibles.length > 0) banners = visibles;
            }
        }
    } catch (e) {}

    bannersCargados = banners;
    track.innerHTML = banners.map((banner, idx) => `
        <div class="banner-slide" style="background-image: url('${banner.imagen_fondo || ''}'); background-size: cover; background-position: center; background-repeat: no-repeat;">
            <div class="banner-texto">
                <span class="badge">${banner.importante ? '⭐ ' : ''}${banner.badge || 'PLATAFORMA CIUDADANA'}</span>
                <h2>${banner.titulo || ''}</h2>
                <p>${banner.descripcion || ''}</p>
                ${banner.texto_boton ? `<button type="button" class="banner-btn" onclick="abrirBanner(${idx})">${banner.texto_boton}</button>` : ''}
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

    // Registra la vista cuando el ciudadano desliza el carrusel con el dedo
    let temporizadorScrollBanner = null;
    track.onscroll = () => {
        clearTimeout(temporizadorScrollBanner);
        temporizadorScrollBanner = setTimeout(() => {
            const i = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
            if (i !== bannerIndiceActual && i >= 0 && i < bannersCargados.length) bannerIndiceActual = i;
            registrarVistaBannerActual();
        }, 500);
    };
    setTimeout(registrarVistaBannerActual, 800);
}

function irABanner(indice) {
    const track = document.getElementById('bannerTrack');
    if (!track) return;
    bannerIndiceActual = indice;
    track.scrollTo({ left: track.clientWidth * indice, behavior: 'smooth' });
    setTimeout(registrarVistaBannerActual, 700);
}

function abrirBanner(idx) {
    const b = bannersCargados[idx];
    if (!b) return;
    registrarEventoBanner(b, 'clic');
    const url = String(b.url_externa || b.enlace_boton || '').trim();
    const esUrl = /^https?:\/\//i.test(url) && (b.tipo_enlace === 'url' || !b.tipo_enlace);
    if (esUrl) { abrirEnlaceExterno(url); return; }

    if (b.nota_aviso || b.tipo_enlace === 'aviso' || b.enlace_boton === 'avisos') {
        avisoDestacadoId = b.id ?? null;
        mostrarSeccion('avisos');
        return;
    }
    mostrarSeccion(b.enlace_boton || 'educacion');
}

export async function renderizarAvisos() {
    const sec = document.getElementById('avisos');
    if (!sec) return;
    let cont = document.getElementById('avisosDinamicos');
    if (!cont) { cont = document.createElement('div'); cont.id = 'avisosDinamicos'; sec.appendChild(cont); }

    const items = bannersCargados.filter(b => b.nota_aviso).map(b => ({
        id: b.id, titulo: b.titulo, badge: b.badge, texto: b.nota_aviso, fecha: b.created_at
    }));
    try {
        if (supabaseClient) {
            const { data } = await supabaseClient.from('avisos_institucionales').select('*').order('created_at', { ascending: false }).limit(20);
            (data || []).forEach(a => items.push({
                id: 'a' + a.id, titulo: a.titulo, badge: 'AVISO INSTITUCIONAL',
                texto: a.mensaje || a.descripcion || a.contenido || a.detalle || '', fecha: a.created_at
            }));
        }
    } catch (e) {}

    items.sort((x, y) => (String(x.id) === String(avisoDestacadoId) ? -1 : 0) - (String(y.id) === String(avisoDestacadoId) ? -1 : 0));
    cont.innerHTML = items.length ? items.map(i => `
        <div class="aviso-card${String(i.id) === String(avisoDestacadoId) ? ' destacado' : ''}">
            <span class="aviso-badge">${escaparHtml(i.badge || 'AVISO')}</span>
            <h3>${escaparHtml(i.titulo)}</h3>
            <p>${escaparHtml(i.texto).replace(/\n/g, '<br>')}</p>
            ${i.fecha ? `<small>${new Date(i.fecha).toLocaleDateString()}</small>` : ''}
        </div>`).join('') : '<p class="aviso-vacio">No hay avisos publicados por ahora.</p>';
    avisoDestacadoId = null;
}

/* ==========================================
   MÉTRICAS DE BANNERS: VISTAS Y CLICS
   - Vista: una por banner, usuario y día, solo si el banner está en pantalla.
   - Clic: cada vez que se pulsa "Ver detalles".
========================================== */
function bannerVisibleParaUsuario(b) {
    if (!b || b.activo === false) return false;
    const mun = normalizarTexto(b.municipio);
    const mio = normalizarTexto(datosUsuarioApp().municipio);
    return !mun || mun === 'todos' || !mio || mun === mio;
}

export function registrarVistaBannerActual() {
    if (document.visibilityState !== 'visible') return;
    if (!document.getElementById('inicio')?.classList.contains('activa')) return;
    registrarEventoBanner(bannersCargados[bannerIndiceActual], 'vista');
}

async function registrarEventoBanner(banner, tipo) {
    if (!banner || !banner.id || !supabaseClient) return;
    const email = (datosUsuarioApp().email || '').trim().toLowerCase() || 'anonimo';
    const clave = `bv_${banner.id}_${email}_${fechaLocalISO()}`;
    if (tipo === 'vista') {
        if (localStorage.getItem(clave)) return;
        localStorage.setItem(clave, '1');
    }
    try {
        const { error } = await supabaseClient.from('banner_vistas').insert([{ banner_id: banner.id, user_email: email, tipo }]);
        if (error) throw error;
    } catch (err) {
        if (tipo === 'vista') localStorage.removeItem(clave);
        console.warn("No se pudo registrar el evento del banner:", err.message || err);
    }
}

/* ==========================================
   PUBLICAR BANNER (formulario del panel de administración; en la app ciudadana no existe y no hace nada)
========================================== */
function iniciarFormularioPublicarBanner() {
    const formBanner = document.getElementById('formPublicarBanner');
    if (!formBanner) return;

    formBanner.addEventListener('submit', async (e) => {
        e.preventDefault();
        const badge = document.getElementById('bannerBadge').value;
        const municipioDestino = document.getElementById('bannerMunicipio').value;
        const titulo = document.getElementById('bannerTitulo').value.trim();
        const descripcion = document.getElementById('bannerDescripcion').value.trim();
        const archivo = document.getElementById('bannerImagenFile').files[0];

        if (!archivo) return alert("Selecciona una imagen.");

        try {
            const nombreArchivo = `${Date.now()}_${archivo.name}`;
            const { error: uploadError } = await supabaseClient.storage.from('banners').upload(nombreArchivo, archivo);
            if (uploadError) throw uploadError;

            const { data: urlData } = supabaseClient.storage.from('banners').getPublicUrl(nombreArchivo);

            const { error: insertError } = await supabaseClient.from('banners').insert([{
                badge: badge,
                titulo: titulo,
                descripcion: descripcion,
                imagen_fondo: urlData.publicUrl,
                municipio: municipioDestino,
                texto_boton: 'Ver detalles',
                enlace_boton: 'avisos'
            }]);
            if (insertError) throw insertError;

            alert("¡Banner publicado con éxito!");
            formBanner.reset();
        } catch (err) {
            console.error("Error:", err);
            alert("Error al publicar el banner: " + err.message);
        }
    });
}

export function iniciarBanners() {
    cargarBanners();
    iniciarFormularioPublicarBanner();
    alEntrarEnSeccion('avisos', renderizarAvisos);
    alEntrarEnSeccion('inicio', () => setTimeout(registrarVistaBannerActual, 900));
}

Object.assign(window, { abrirBanner, irABanner });
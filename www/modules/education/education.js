/* ==========================================
   modules/education/education.js
   Eco-Academia: nivel y progreso, Desafío del Día (trivia con temporizador) y módulos de consejos.
   Los puntos los otorga Supabase; la billetera y el canje viven en rewards.js.
========================================== */
import { datosUsuarioApp } from '../../core/authService.js';
import { escaparHtml, fechaLocalISO, mostrarToast, registrarErrorApp, abrirEnlaceExterno } from '../../core/utils.js';
import { supabaseClient } from '../../core/supabaseClient.js';
import { alEntrarEnSeccion } from '../../core/navigation.js';
import { registrarNovedadCampana, alertaAppActiva } from '../../core/notifications.js';
import { rpcEco, ecoAvisar, lanzarConfeti, pintarBilletera } from '../rewards/rewards.js';

let ecoModulos = [];
let ecoTemporizador = null;
let moduloActual = null, tarjetaActual = 0;

export async function cargarEco() {
    const aviso = document.getElementById('ecoAviso');
    const contenido = document.getElementById('ecoContenido');
    if (!aviso || !contenido) return;

    const mostrarAviso = texto => { aviso.textContent = texto; aviso.hidden = false; contenido.hidden = true; };
    if (!datosUsuarioApp().email) { mostrarAviso('Inicia sesión para acumular EcoPuntos.'); return; }

    try {
        const [resumen, trivia, modulos] = await Promise.all([rpcEco('eco_resumen'), rpcEco('trivia_del_dia'), rpcEco('modulos_eco')]);
        ecoModulos = modulos || [];
        document.getElementById('ecoEncabezado').innerHTML = htmlEcoEncabezado(resumen);
        document.getElementById('ecoTrivia').innerHTML = htmlEcoTrivia(trivia);
        document.getElementById('ecoAcademia').innerHTML = htmlEcoAcademia();
        pintarBilletera(resumen);
        aviso.hidden = true;
        contenido.hidden = false;
        iniciarTemporizadorTrivia();
        cargarAccionAmbiental(resumen);
    } catch (e) {
        mostrarAviso('No se pudieron cargar tus EcoPuntos. Verifica tu conexión e inicia sesión de nuevo.');
        registrarErrorApp('cargarEco', e);
    }
}

function htmlEcoEncabezado(r) {
    const n = r.nivel;
    const pct = n.hasta ? Math.min(100, Math.round(((r.ganados - n.desde) / (n.hasta - n.desde)) * 100)) : 100;
    return `<div class="eco-caja eco-header">
        <div class="eco-fila"><strong>🌿 MI IMPACTO VERDE</strong><span class="eco-puntos">${r.saldo} EcoPuntos</span></div>
        <div class="eco-barra"><div style="width:${pct}%"></div></div>
        <small>Nivel ${n.nivel}: ${escaparHtml(n.nombre)}${n.hasta ? ` · te faltan ${n.hasta - r.ganados} puntos para el siguiente nivel` : ' · ¡Nivel máximo!'}</small>
    </div>`;
}

function htmlEcoTrivia(t) {
    if (!t || !t.disponible) return '';
    if (t.ya_respondida) {
        return `<div class="eco-caja"><strong>⚡ DESAFÍO DEL DÍA</strong>
            <p>${t.acierto ? '🎉 ¡Acertaste y ganaste +20 EcoPuntos!' : 'Hoy no acertaste, ¡mañana hay otra oportunidad!'}</p>
            <small>${escaparHtml(t.explicacion || '')}</small><br><small>Vuelve mañana por una nueva trivia.</small></div>`;
    }
    return `<div class="eco-caja"><strong>⚡ DESAFÍO DEL DÍA (+20 PTS)</strong>
        <p>${escaparHtml(t.pregunta)}</p>
        ${(t.opciones || []).map((o, i) => `<button type="button" class="eco-opcion" onclick="responderTrivia(${t.id}, ${i})">${escaparHtml(o)}</button>`).join('')}
        <small id="ecoTiempo">⏱️ 15 s</small></div>`;
}

function iniciarTemporizadorTrivia() {
    clearInterval(ecoTemporizador);
    if (!document.getElementById('ecoTiempo')) return;
    let t = 15;
    ecoTemporizador = setInterval(() => {
        const el = document.getElementById('ecoTiempo');
        if (!el) { clearInterval(ecoTemporizador); return; }
        t--;
        el.textContent = `⏱️ ${t} s`;
        if (t <= 0) {
            clearInterval(ecoTemporizador);
            document.querySelectorAll('.eco-opcion').forEach(b => { b.disabled = true; });
            el.innerHTML = '⏱️ Se acabó el tiempo. <button type="button" class="eco-link" onclick="cargarEco()">Reintentar</button>';
        }
    }, 1000);
}

export async function responderTrivia(id, opcion) {
    clearInterval(ecoTemporizador);
    document.querySelectorAll('.eco-opcion').forEach(b => { b.disabled = true; });
    try {
        const r = await rpcEco('responder_trivia', { p_trivia_id: id, p_opcion: opcion });
        if (r.correcta) { lanzarConfeti(); ecoAvisar('¡Correcto! Ganaste +20 EcoPuntos por la trivia del día.', 'eco-trivia-' + fechaLocalISO()); }
        else mostrarToast('Casi... ' + (r.explicacion || ''));
    } catch (e) { mostrarToast(e.message || 'No se pudo enviar tu respuesta.'); }
    cargarEco();
}

function htmlEcoAcademia() {
    return `<div class="eco-caja"><strong>📚 ECO-ACADEMIA</strong>
        ${ecoModulos.map(m => `<button type="button" class="eco-modulo" onclick="abrirModuloEco('${m.id}')">
            <span>${m.icono} ${escaparHtml(m.titulo)}</span>
            <small>${m.completado ? '✅ Completado' : `${m.minutos} min · +${m.bono} pts`}</small></button>`).join('')}
    </div>`;
}

function asegurarPanelModulo() {
    let p = document.getElementById('panelModuloEco');
    if (!p) {
        p = document.createElement('div');
        p.id = 'panelModuloEco';
        p.className = 'panel-campana';
        p.addEventListener('click', e => { if (e.target === p) p.classList.remove('abierto'); });
        document.body.appendChild(p);
    }
    return p;
}

export function abrirModuloEco(id) {
    moduloActual = ecoModulos.find(m => m.id === id);
    tarjetaActual = 0;
    if (moduloActual) { asegurarPanelModulo().classList.add('abierto'); pintarTarjetaEco(); }
}

export function pintarTarjetaEco() {
    const m = moduloActual, total = m.tarjetas.length, ultima = tarjetaActual === total - 1;
    asegurarPanelModulo().innerHTML = `<div class="panel-campana-caja"><div class="panel-campana-cabecera">
        <strong>${m.icono} ${escaparHtml(m.titulo)}</strong><button type="button" onclick="document.getElementById('panelModuloEco').classList.remove('abierto')">✕</button></div>
        <div class="eco-tarjeta"><small>Consejo ${tarjetaActual + 1} de ${total}</small><p>${escaparHtml(m.tarjetas[tarjetaActual])}</p>
        <div class="calificacion-botones">
            ${tarjetaActual > 0 ? '<button type="button" class="secundario" onclick="tarjetaAnterior()">← Anterior</button>' : ''}
            ${ultima ? `<button type="button" onclick="terminarModuloEco()">${m.completado ? 'Cerrar' : `✅ Terminar (+${m.bono} pts)`}</button>`
                     : '<button type="button" onclick="tarjetaSiguiente()">Siguiente →</button>'}
        </div></div></div>`;
}

// Navegación entre tarjetas (el estado vive en este módulo; el HTML solo llama a estas funciones)
export function tarjetaAnterior() { tarjetaActual--; pintarTarjetaEco(); }
export function tarjetaSiguiente() { tarjetaActual++; pintarTarjetaEco(); }

export async function terminarModuloEco() {
    const m = moduloActual;
    document.getElementById('panelModuloEco').classList.remove('abierto');
    if (!m || m.completado) return;
    try {
        const r = await rpcEco('completar_modulo', { p_modulo_id: m.id });
        if (r.nuevo) { lanzarConfeti(); ecoAvisar(`Completaste "${m.titulo}": +${r.puntos} EcoPuntos y una nueva insignia.`, 'eco-modulo-' + m.id); }
    } catch (e) { mostrarToast(e.message || 'No se pudo registrar el módulo.'); }
    cargarEco();
}

export async function recordarTriviaDiaria() {
    if (!datosUsuarioApp().email || !alertaAppActiva('recordatorio_trivia')) return;
    try {
        const t = await rpcEco('trivia_del_dia');
        if (t && t.disponible && !t.ya_respondida) {
            registrarNovedadCampana({ id: 'trivia-' + fechaLocalISO(), tipo: 'ecopuntos', titulo: '⚡ Desafío del día', mensaje: 'Responde la trivia de hoy en Educación Ambiental y gana +20 EcoPuntos.' });
        }
    } catch (e) {}
}

export function iniciarEducacion() {
    alEntrarEnSeccion('educacion', () => { cargarEco(); cargarNoticias(); });
    alEntrarEnSeccion('inicio', () => cargarAccionAmbiental());
    pintarCanecos();
    cargarAccionAmbiental();
    // El correo del ciudadano puede tardar en estar listo al abrir la app: se reintenta una vez
    setTimeout(() => cargarAccionAmbiental(), 2500);
    setTimeout(() => cargarNoticias(), 5000);   // para avisar noticias nuevas en la campana
}

Object.assign(window, { abrirReglasEco, cerrarReglasEco, verMasNoticias, abrirCaneco, cerrarCaneco, filtrarNoticias, abrirNoticia, cargarEco, responderTrivia, abrirModuloEco, tarjetaAnterior, tarjetaSiguiente, terminarModuloEco });


/* ==========================================
   ACCIÓN AMBIENTAL (pantalla de inicio): EcoPuntos, kilos reciclados e impacto en el planeta
========================================== */
// Factores ESTIMADOS por kilo reciclado (orden de magnitud de estudios de ciclo de vida; son una referencia, no una medición exacta)
const FACTORES_IMPACTO = {            // co2 kg · agua L · energía kWh
    'pet':               { co2: 1.5, agua: 15,  kwh: 2.0 },
    'plastico (otros)':  { co2: 1.2, agua: 12,  kwh: 1.6 },
    'carton':            { co2: 0.9, agua: 25,  kwh: 1.4, arbol: true },
    'papel':             { co2: 1.0, agua: 26,  kwh: 1.5, arbol: true },
    'vidrio':            { co2: 0.3, agua: 2,   kwh: 0.4 },
    'chatarra / metal':  { co2: 1.8, agua: 10,  kwh: 4.0 },
    'textil':            { co2: 3.0, agua: 50,  kwh: 3.5 },
    'aparatos y cables': { co2: 2.5, agua: 10,  kwh: 3.0 }
};
const FACTOR_OTROS = { co2: 0.5, agua: 5, kwh: 0.8 };
const ARBOLES_POR_KG_PAPEL = 0.017;   // ≈ 17 árboles por tonelada de papel
const KG_POR_BOTELLA_PET = 0.025;
const COP_POR_ECOPUNTO = 10;

const normalizarMaterial = m => String(m || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function calcularImpacto(materiales) {
    const t = { co2: 0, agua: 0, kwh: 0, arboles: 0 };
    (materiales || []).forEach(x => {
        const kg = Number(x.kg) || 0;
        const f = FACTORES_IMPACTO[normalizarMaterial(x.material)] || FACTOR_OTROS;
        t.co2 += kg * f.co2; t.agua += kg * f.agua; t.kwh += kg * f.kwh;
        if (f.arbol) t.arboles += kg * ARBOLES_POR_KG_PAPEL;
    });
    return t;
}

const fmt = (n, dec = 0) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: dec, minimumFractionDigits: dec });

function animarNumeros(raiz) {
    raiz.querySelectorAll('[data-contar]').forEach(el => {
        const fin = Number(el.dataset.contar), dec = Number(el.dataset.dec || 0);
        const t0 = performance.now(), dur = 900;
        const paso = ahora => {
            const p = Math.min(1, (ahora - t0) / dur);
            el.textContent = fmt(fin * (1 - Math.pow(1 - p, 3)), dec);
            if (p < 1) requestAnimationFrame(paso);
        };
        requestAnimationFrame(paso);
    });
}

const MATERIALES_UI = {   // etiqueta y color en el gráfico
    'pet': ['PET', '#1e88e5'], 'plastico (otros)': ['Plástico', '#7e57c2'], 'carton': ['Cartón', '#8d6e63'],
    'papel': ['Papel', '#fbc02d'], 'vidrio': ['Vidrio', '#26a69a'], 'chatarra / metal': ['Metal', '#78909c'],
    'textil': ['Textil', '#ec407a'], 'aparatos y cables': ['Aparatos', '#ef6c00']
};

function htmlDona(materiales, kg) {
    const R = 52, C = 2 * Math.PI * R;
    const lista = (materiales || []).filter(m => Number(m.kg) > 0).sort((x, y) => y.kg - x.kg);
    let acum = 0;
    const arcos = lista.map(m => {
        const ui = MATERIALES_UI[normalizarMaterial(m.material)] || [m.material, '#9e9e9e'];
        const largo = (Number(m.kg) / kg) * C;
        const svg = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${ui[1]}" stroke-width="18" stroke-dasharray="${Math.max(0, largo - 2)} ${C - Math.max(0, largo - 2)}" stroke-dashoffset="${-acum}" transform="rotate(-90 70 70)"/>`;
        acum += largo;
        return { svg, ui, kg: Number(m.kg), pct: Math.round((Number(m.kg) / kg) * 100) };
    });
    const dona = `<svg viewBox="0 0 140 140" class="aa-dona" role="img" aria-label="Kilos reciclados por material">
        <circle cx="70" cy="70" r="${R}" fill="none" stroke="#e8eef0" stroke-width="18"/>${arcos.map(x => x.svg).join('')}
        <text x="70" y="68" text-anchor="middle" class="aa-dona-num">${fmt(kg, kg < 10 ? 1 : 0)}</text>
        <text x="70" y="86" text-anchor="middle" class="aa-dona-kg">kg reciclados</text></svg>`;
    const leyenda = arcos.length
        ? arcos.map(x => `<div class="aa-ley"><i style="background:${x.ui[1]}"></i><span>${escaparHtml(x.ui[0])}</span><b>${fmt(x.kg, x.kg < 10 ? 1 : 0)} kg</b></div>`).join('')
        : '<p class="aa-vacio">Aún no tienes kilos. Pide tu primera recogida y verás aquí qué materiales entregas.</p>';
    return `<div class="aa-dona-fila">${dona}<div class="aa-leyenda">${leyenda}</div></div>`;
}

function htmlVencimiento(v) {
    if (!v || !(v.por_vencer_14 > 0)) return '';
    const fecha = new Date(v.proximo_vencimiento);
    const dias = Math.max(0, Math.ceil((fecha - Date.now()) / 86400000));
    const txt = `⏳ ${fmt(v.por_vencer_14)} EcoPuntos vencen ${dias <= 1 ? 'hoy o mañana' : 'en ' + dias + ' días'} (${fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}). ¡Canjéalos a tiempo!`;
    try {   // aviso en la campana: una vez al día, y más urgente si faltan 3 días o menos
        const clave = 'eco-vence-' + fechaLocalISO();
        if (!localStorage.getItem(clave)) { localStorage.setItem(clave, '1'); ecoAvisar(txt, clave, { tipo: 'vence', destino: 'canje' }); }
    } catch (e) {}
    return `<div class="aa-vence ${v.por_vencer_3 > 0 ? 'urgente' : ''}">${txt}</div>`;
}

export async function cargarAccionAmbiental(resumenPrevio) {
    const cont = document.getElementById('accionAmbiental');
    if (!cont) return;
    if (!datosUsuarioApp().email) {
        cont.innerHTML = `<div class="aa-hero aa-invitado">
            <div class="aa-hero-titulo">🌱 Recicla y gana EcoPuntos</div>
            <p>Inicia sesión para ver tus puntos, tus kilos reciclados y cuánto ayudas al planeta.</p>
            <button class="primary-btn" onclick="abrirReglasEco()">📜 Cómo ganar y canjear</button></div>`;
        return;
    }
    try {
        const [r, imp] = await Promise.all([
            resumenPrevio ? Promise.resolve(resumenPrevio) : rpcEco('eco_resumen'),
            rpcEco('eco_impacto').catch(() => ({ kg_total: 0, materiales: [], canje_habilitado: true }))
        ]);
        const kg = Number(imp.kg_total) || 0;
        const i = calcularImpacto(imp.materiales);
        const n = r.nivel || {};
        const pct = n.hasta ? Math.min(100, Math.round(((r.ganados - n.desde) / (n.hasta - n.desde)) * 100)) : 100;
        const habilitado = imp.canje_habilitado !== false;

        cont.innerHTML = `
        <div class="aa-hero">
            <div class="aa-hero-fila"><span class="aa-hero-titulo">⭐ Tus EcoPuntos</span><span class="aa-nivel">Nivel ${n.nivel || 1} · ${escaparHtml(n.nombre || '')}</span></div>
            <div class="aa-hero-numero"><span data-contar="${Number(r.saldo) || 0}">0</span><small> pts</small></div>
            <div class="aa-hero-sub">${r.ganados > 0
                ? `🎉 ¡Vas ganando! Has sumado <b>${fmt(r.ganados)}</b> EcoPuntos en total · equivalen a <b>$${fmt(r.saldo * COP_POR_ECOPUNTO)}</b> en beneficios`
                : 'Recicla, responde la trivia y completa módulos para empezar a ganar'}</div>
            <div class="aa-barra"><div style="width:${pct}%"></div></div>
            <small class="aa-hero-meta">${n.hasta ? `Te faltan ${fmt(n.hasta - r.ganados)} puntos para el siguiente nivel` : '🏆 ¡Nivel máximo!'}</small>
            ${htmlVencimiento(r.vigencia)}
            <div class="aa-estado ${habilitado ? 'ok' : 'bloq'}">${habilitado
                ? '✅ Canje habilitado este mes'
                : '🔒 Sigues sumando, pero para <b>canjear</b> necesitas completar 1 recogida de reciclaje este mes'}</div>
            <div class="aa-botones">
                <button type="button" class="aa-btn-claro" onclick="canjearEnCicloGo()">🎟️ Canjear</button>
                <button type="button" class="aa-btn-borde" onclick="mostrarSeccion('educacion')">⚡ Ganar más</button>
            </div>
            <button type="button" class="aa-enlace" onclick="abrirReglasEco()">📜 ¿Cómo ganar y canjear EcoPuntos?</button>
        </div>

        <div class="aa-impacto">
            <div class="aa-impacto-titulo">♻️ Lo que has reciclado</div>
            ${htmlDona(imp.materiales, kg)}
            <div class="aa-impacto-titulo" style="margin-top:14px;">🌍 Tu ayuda al planeta</div>
            <div class="aa-tiles">
                <div class="aa-tile t-co2"><span>☁️</span><b><span data-contar="${i.co2}" data-dec="1">0</span> kg</b><small>CO₂ evitado</small></div>
                <div class="aa-tile t-arb"><span>🌳</span><b><span data-contar="${i.arboles}" data-dec="2">0</span></b><small>árboles salvados</small></div>
                <div class="aa-tile t-agua"><span>💧</span><b><span data-contar="${i.agua}">0</span> L</b><small>agua ahorrada</small></div>
                <div class="aa-tile t-ene"><span>⚡</span><b><span data-contar="${i.kwh}" data-dec="1">0</span> kWh</b><small>energía ahorrada</small></div>
            </div>
            <small class="aa-nota">${kg > 0 ? `≈ ${fmt(Math.round(kg / KG_POR_BOTELLA_PET))} botellas PET. ` : ''}Impacto estimado según los materiales que entregas. Los kilos se suman cuando el reciclador termina el flujo y la báscula confirma el pesaje.</small>
        </div>
        <button class="primary-btn" style="width:100%;" onclick="mostrarSeccion('educacion')">Ver más: trivia y educación ambiental</button>`;
        animarNumeros(cont);
    } catch (e) {
        cont.innerHTML = '<p class="aviso-vacio">No se pudo cargar tu impacto. Verifica tu conexión.</p>';
        registrarErrorApp('cargarAccionAmbiental', e);
    }
}

/* ==========================================
   REGLAS RESUMIDAS DE ECOPUNTOS (ganar y canjear)
========================================== */
export function abrirReglasEco() {
    let p = document.getElementById('panelReglasEco');
    if (!p) {
        p = document.createElement('div');
        p.id = 'panelReglasEco';
        p.className = 'panel-campana';
        p.addEventListener('click', e => { if (e.target === p) cerrarReglasEco(); });
        document.body.appendChild(p);
    }
    const tarifas = [['♻️', 'PET', 12], ['🔌', 'Aparatos y cables', 15], ['🔩', 'Chatarra / metal', 8], ['🧴', 'Plástico (otros)', 8],
                     ['📦', 'Cartón', 6], ['📄', 'Papel', 6], ['👕', 'Textil', 6], ['🍾', 'Vidrio y otros', 5]];
    p.innerHTML = `<div class="panel-campana-caja vol-caja"><button type="button" class="vol-cerrar" onclick="cerrarReglasEco()">✕</button>
        <div class="vol">
            <div class="vol-cab"><span>♻️</span><h3>Recicla · Gana · Canjea</h3><p>Así funcionan tus EcoPuntos</p></div>

            <div class="vol-pasos">
                <div><b>1</b><span>🚛</span><small>Pide una recogida de reciclaje</small></div>
                <div><b>2</b><span>⭐</span><small>Gana puntos por kilo</small></div>
                <div><b>3</b><span>🎟️</span><small>Canjea con tu QR en comercios aliados</small></div>
            </div>

            <div class="vol-bloque">
                <h4>⭐ Cuánto ganas por kilo</h4>
                <div class="vol-tarifas">${tarifas.map(t => `<div><span>${t[0]}</span><em>${t[1]}</em><b>${t[2]} pts/kg</b></div>`).join('')}</div>
                <div class="vol-calidad">
                    <div style="background:#c8e6c9"><b>100%</b><small>limpio y seco</small></div>
                    <div style="background:#fff3c4"><b>50%</b><small>húmedo</small></div>
                    <div style="background:#ffcdd2"><b>0%</b><small>contaminado</small></div>
                </div>
                <ul>
                    <li><b>+50 puntos</b> al escanear el carnet del reciclador.</li>
                    <li>Los puntos por kilo se abonan cuando la báscula confirma el pesaje. Máximo <b>300</b> por recogida.</li>
                    <li><b>⚡ Trivia del día +20</b> · <b>📚 Eco-Academia:</b> bono al terminar cada módulo.</li>
                </ul>
            </div>

            <div class="vol-bloque">
                <h4>🎟️ Cómo canjear</h4>
                <ul>
                    <li>Elige una oferta de <b>cualquier comercio aliado</b> y genera tu <b>QR</b> estando en la caja.</li>
                    <li><b>⏱️ El QR dura 60 segundos.</b> Los puntos se descuentan cuando el comercio lo escanea.</li>
                    <li>Cada comercio define los puntos y la compra mínima. <b>1 punto = $10</b> de referencia.</li>
                    <li>Los comercios participan voluntariamente; la plataforma no les paga.</li>
                </ul>
            </div>

            <div class="vol-reglas">
                <div class="vol-regla amarilla"><span>📅</span><p><b>Regla del mes</b><br>Siempre puedes acumular, pero para <b>canjear</b> debes completar <b>1 recogida al mes</b>: carnet verificado, entrega y pesaje confirmado en báscula.</p></div>
                <div class="vol-regla naranja"><span>⏳</span><p><b>Vigencia de 90 días</b><br>Cada punto vence 90 días después de ganarlo (se gastan primero los más antiguos). Te avisamos 14 y 3 días antes.</p></div>
            </div>

            <p class="vol-pie">🛡️ Los puntos son personales: no se transfieren ni se venden. Si se detecta fraude, pueden anularse. Tu nivel no baja cuando vencen puntos.</p>
        </div></div>`;
    p.classList.add('abierto');
}
export function cerrarReglasEco() { document.getElementById('panelReglasEco')?.classList.remove('abierto'); }

/* ==========================================
   CANECOS (Guías rápidas) — código de colores de Colombia (Resolución 2184 de 2019)
========================================== */
const CANECOS = [
    { id: 'blanco', color: '#f5f5f5', borde: '#bdbdbd', icono: '♻️', nombre: 'Caneco blanco', sub: 'Aprovechables',
      si: ['Botellas y envases de plástico', 'Latas y chatarra metálica', 'Vidrio (botellas y frascos)', 'Papel y cartón limpios y secos', 'Cajas de leche y jugos (tetra pak)', 'Bolsas plásticas limpias'],
      no: ['Papel higiénico o servilletas usadas', 'Envases con comida o grasa', 'Papel o cartón mojado'],
      tip: 'Enjuaga y escurre los envases: así sí se pueden reciclar.' },
    { id: 'negro', color: '#37474f', borde: '#263238', icono: '🗑️', nombre: 'Caneco negro', sub: 'No aprovechables',
      si: ['Papel higiénico, servilletas y pañuelos usados', 'Pañales y toallas higiénicas', 'Colillas de cigarrillo', 'Barrido y polvo', 'Cerámica y espejos rotos', 'Papel sucio o con grasa', 'Icopor con restos de comida'],
      no: ['Plásticos, vidrio, metal, papel y cartón limpios', 'Restos de comida'],
      tip: 'Envuelve los vidrios rotos para evitar accidentes a quien recoge.' },
    { id: 'verde', color: '#43a047', borde: '#2e7d32', icono: '🍃', nombre: 'Caneco verde', sub: 'Orgánicos',
      si: ['Restos de comida', 'Cáscaras de frutas y verduras', 'Cáscaras de huevo', 'Café molido y bolsitas de té', 'Hojas, flores y residuos de poda'],
      no: ['Carnes con salsas o grasa en exceso', 'Cualquier material que no sea orgánico'],
      tip: 'Con los orgánicos se puede hacer compostaje y abono para tus plantas.' },
    { id: 'rojo', color: '#e53935', borde: '#b71c1c', icono: '⚠️', nombre: 'Punto especial', sub: 'Peligrosos y RAEE',
      si: ['Pilas y baterías', 'Bombillos y tubos fluorescentes', 'Medicamentos vencidos', 'Celulares, cargadores y electrodomésticos', 'Aceite de cocina usado (en botella cerrada)', 'Llantas y envases de químicos'],
      no: ['No van en ningún caneco de la casa'],
      tip: 'Llévalos a los puntos de recolección posconsumo o entrégalos en una jornada especial.' }
];

function pintarCanecos() {
    const g = document.getElementById('canecoGrid');
    if (!g) return;
    g.innerHTML = CANECOS.map(c => `<button type="button" class="caneco-card" onclick="abrirCaneco('${c.id}')">
        <span class="caneco-cuerpo" style="background:${c.color}; border-color:${c.borde};"><i style="background:${c.borde};"></i><em>${c.icono}</em></span>
        <strong>${c.nombre}</strong><small>${c.sub}</small></button>`).join('');
}

export function abrirCaneco(id) {
    const c = CANECOS.find(x => x.id === id);
    if (!c) return;
    let p = document.getElementById('panelCaneco');
    if (!p) {
        p = document.createElement('div');
        p.id = 'panelCaneco';
        p.className = 'panel-campana';
        p.addEventListener('click', e => { if (e.target === p) cerrarCaneco(); });
        document.body.appendChild(p);
    }
    p.innerHTML = `<div class="panel-campana-caja"><div class="panel-campana-cabecera" style="border-bottom:4px solid ${c.color};">
        <strong>${c.icono} ${c.nombre} · ${c.sub}</strong><button type="button" onclick="cerrarCaneco()">✕</button></div>
        <div class="eco-tarjeta caneco-detalle">
            <p class="caneco-t">✅ Sí va aquí</p>
            <ul>${c.si.map(x => `<li>${escaparHtml(x)}</li>`).join('')}</ul>
            <p class="caneco-t caneco-no">🚫 No va aquí</p>
            <ul>${c.no.map(x => `<li>${escaparHtml(x)}</li>`).join('')}</ul>
            <div class="caneco-tip">💡 ${escaparHtml(c.tip)}</div>
        </div></div>`;
    p.classList.add('abierto');
}
export function cerrarCaneco() { document.getElementById('panelCaneco')?.classList.remove('abierto'); }

/* ==========================================
   NOTICIAS DEL PLANETA (Edge Function noticias-ambientales de EcoSTAN)
========================================== */
let noticiasCache = [], filtroNoticias = 'todas', noticiasCargadas = 0, noticiasVisibles = 6;

export async function cargarNoticias() {
    const lista = document.getElementById('noticiasLista');
    if (!lista) return;
    if (noticiasCache.length && Date.now() - noticiasCargadas < 30 * 60 * 1000) { pintarNoticias(); return; }
    try {
        const { data, error } = await supabaseClient.functions.invoke('noticias-ambientales', { body: {} });
        if (error) throw error;
        noticiasCache = (data && data.noticias) || [];
        noticiasCargadas = Date.now();
        pintarNoticias();
        avisarNoticiasNuevas();
    } catch (e) {
        lista.innerHTML = '<p class="aviso-vacio">No pudimos traer las noticias ahora. Intenta más tarde.</p>';
        registrarErrorApp('cargarNoticias', e);
    }
}

// Las noticias que el ciudadano aún no ha visto pasan a la campana (la primera vez solo se marcan como vistas)
function avisarNoticiasNuevas() {
    try {
        const clave = 'noticiasVistas_' + (datosUsuarioApp().email || 'anon');
        const previas = JSON.parse(localStorage.getItem(clave) || 'null');
        const links = noticiasCache.map(n => n.link);
        if (previas && datosUsuarioApp().email) {
            noticiasCache.filter(n => !previas.includes(n.link)).slice(0, 3).forEach(n =>
                registrarNovedadCampana({ id: 'noticia-' + btoa(unescape(encodeURIComponent(n.link))).slice(-24), tipo: 'noticia',
                    titulo: '📰 ' + n.fuente, mensaje: n.titulo, fecha: n.fecha, destino: 'noticias', url: n.link }));
        }
        localStorage.setItem(clave, JSON.stringify(links.concat(previas || []).slice(0, 80)));
    } catch (e) {}
}

function tiempoRelativo(f) {
    const d = Math.floor((Date.now() - new Date(f).getTime()) / 86400000);
    return d <= 0 ? 'Hoy' : d === 1 ? 'Ayer' : d < 30 ? `Hace ${d} días` : new Date(f).toLocaleDateString('es-CO');
}

function pintarNoticias() {
    const lista = document.getElementById('noticiasLista');
    if (!lista) return;
    const todas = noticiasCache.filter(n => filtroNoticias === 'todas' || n.ambito === filtroNoticias);
    const items = todas.slice(0, noticiasVisibles);
    lista.innerHTML = items.length ? items.map(n => {
        const i = noticiasCache.indexOf(n);
        return `<button type="button" class="noticia-card" onclick="abrirNoticia(${i})">
            ${n.imagen ? `<img src="${escaparHtml(n.imagen)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="noticia-emoji">${n.ambito === 'colombia' ? '🌄' : '🌍'}</span>`}
            <span class="noticia-cuerpo"><small>${escaparHtml(n.fuente)} · ${tiempoRelativo(n.fecha)}</small>
            <strong>${escaparHtml(n.titulo)}</strong>
            ${n.resumen ? `<span class="noticia-resumen">${escaparHtml(n.resumen)}</span>` : ''}
            <em>Leer más ↗</em></span></button>`;
    }).join('') + (todas.length > noticiasVisibles ? `<button type="button" class="noticias-mas" onclick="verMasNoticias()">Ver más noticias (${todas.length - noticiasVisibles})</button>` : '') : '<p class="aviso-vacio">Aún no hay noticias para mostrar.</p>';
}

export function verMasNoticias() { noticiasVisibles += 6; pintarNoticias(); }

export function filtrarNoticias(ambito, btn) {
    filtroNoticias = ambito;
    noticiasVisibles = 6;
    document.querySelectorAll('.noticias-tabs button').forEach(b => b.classList.toggle('activa', b === btn));
    pintarNoticias();
}

export function abrirNoticia(i) {
    const n = noticiasCache[i];
    if (n && /^https?:\/\//.test(n.link)) abrirEnlaceExterno(n.link);
}
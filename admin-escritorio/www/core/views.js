/* ==========================================
   core/views.js
   Carga los fragmentos HTML de cada módulo dentro de home.html.
   - En home.html hay "huecos":      <div data-slot="nombre"></div>
   - Cada fragmento declara su sitio: <section data-slot-destino="nombre">…</section>
   Así cada módulo tiene su HTML en su carpeta y la navegación (mostrarSeccion) sigue igual.
   Nota: usa fetch, así que la app debe servirse por http(s) (Capacitor, Live Server, hosting);
   abrir home.html con doble clic (file://) no funciona.
========================================== */
import { registrarErrorApp } from './utils.js';

const RAIZ = new URL('../', import.meta.url);

// Orden de carga (solo importa si un fragmento tiene su hueco dentro de otro)
export const VISTAS = [
    'modules/banners/banners.html',
    'modules/map_routing/map.html',
    'modules/collections/collections.html',
    'modules/education/education.html',
    'modules/rewards/rewards.html'
];

async function descargar(ruta) {
    const respuesta = await fetch(new URL(ruta, RAIZ));
    if (!respuesta.ok) throw new Error(`No se pudo cargar ${ruta} (HTTP ${respuesta.status})`);
    return respuesta.text();
}

// Coloca el elemento en su hueco. Devuelve false si el hueco todavía no existe.
function insertar(elemento) {
    const nombre = elemento.dataset.slotDestino;
    const hueco = document.querySelector(`[data-slot="${nombre}"]`);
    if (!hueco) return false;
    elemento.removeAttribute('data-slot-destino');
    hueco.before(elemento);
    if (!hueco.hasAttribute('data-slot-multiple')) hueco.remove();   // los "multiple" admiten varios bloques
    return true;
}

export async function cargarVistas() {
    const textos = await Promise.all(VISTAS.map(descargar));

    let pendientes = textos.flatMap(texto => {
        const plantilla = document.createElement('template');
        plantilla.innerHTML = texto;
        return [...plantilla.content.children];
    });

    // Varias pasadas: un fragmento puede tener su hueco dentro de otro fragmento
    while (pendientes.length) {
        const restantes = pendientes.filter(el => !insertar(el));
        if (restantes.length === pendientes.length) break;   // nadie avanzó: huecos inexistentes
        pendientes = restantes;
    }
    pendientes.forEach(el => registrarErrorApp('vistas', new Error(`Hueco inexistente: ${el.dataset.slotDestino}`)));

    document.querySelectorAll('[data-slot-multiple]').forEach(hueco => hueco.remove());
}
/* ==========================================
   CONFIGURACIÓN Y CLIENTE SUPABASE (CORE)
   Único lugar donde viven la URL y la llave del proyecto.
========================================== */

// Configuración de credenciales del proyecto de Supabase
const SUPABASE_URL = 'https://afwlonmlxzwkmiumpsyt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8C7CKRVixeJmD9BsnTJQ3A_aVzU-wey';

const libreriaDisponible = () => !!(window.supabase && typeof window.supabase.createClient === 'function');

// Inicialización segura del cliente de Supabase
export const supabaseClient = libreriaDisponible()
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// Cliente que NO guarda sesión: sirve para crear cuentas de otros usuarios (panel del superadmin)
// sin reemplazar la sesión de quien está logueado.
export function crearClienteSinSesion() {
    if (!libreriaDisponible()) throw new Error('La librería de Supabase no está cargada.');
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
}

// Exposición global para compatibilidad con scripts legacy si se requiere
window.supabaseClient = supabaseClient;
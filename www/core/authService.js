/* ==========================================
   core/authService.js
   Única fuente de verdad de la sesión: ciudadano (usuarioLogueado) y administrador
   (userRole / userDependencia / userEmail), sesión de Supabase, rutas y operaciones de cuenta.
   Ningún otro archivo debe leer esas claves de localStorage ni escribir una ruta de login a mano.
========================================== */
import { supabaseClient } from './supabaseClient.js';

const CLAVE_USUARIO = 'usuarioLogueado';
const CLAVES_ADMIN = ['userRole', 'userDependencia', 'userEmail'];

/* Rutas centralizadas (se resuelven respecto a este archivo, así funcionan en
   Capacitor, Live Server o la app de escritorio sin importar la carpeta raíz).
   Si mueves un HTML, solo cambias la línea correspondiente aquí. */
const aRuta = ruta => new URL(ruta, import.meta.url).href;
/* Página WEB pública a la que llegan los enlaces de los correos (activar cuenta / nueva contraseña).
   Debe ser https (la app Android no puede recibir enlaces file:// ni capacitor://) y estar agregada en
   Supabase → Authentication → URL Configuration → Redirect URLs.
   Sube www/auth-callback.html a tu web y pon aquí su dirección. */
export const URL_WEB_AUTH = 'https://ecostan.territoriocivico.com/auth-callback.html';
const urlAuthLista = () => !/CAMBIA-ESTE-DOMINIO/.test(URL_WEB_AUTH);

export const RUTAS = {
    inicio:     aRuta('../home.html'),
    login:      aRuta('../modules/auth/login.html'),
    loginAdmin: aRuta('../admin-login.html'),
    admin:      aRuta('../modules/administration/admin.html')
};

/* ---------- Ciudadano: usuario local ---------- */
export function datosUsuarioApp() {
    try { return JSON.parse(localStorage.getItem(CLAVE_USUARIO) || '{}') || {}; } catch (e) { return {}; }
}
export const emailUsuarioApp = () => String(datosUsuarioApp().email || '').trim().toLowerCase();
export const estaLogueado = () => !!localStorage.getItem(CLAVE_USUARIO);
export const guardarUsuarioLocal = usuario => localStorage.setItem(CLAVE_USUARIO, JSON.stringify(usuario));

/* ---------- Sesión de Supabase ---------- */
export async function obtenerSesionActual() {
    if (!supabaseClient) return null;
    try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;
        return data?.session || null;
    } catch (err) {
        console.warn("No se pudo obtener la sesión actual:", err);
        return null;
    }
}

export function irALogin() { window.location.href = RUTAS.login; }

// Devuelve true si hay sesión; si no, avisa (opcional) y manda al login.
export function exigirLogin(mensaje) {
    if (estaLogueado()) return true;
    if (mensaje) alert(mensaje);
    irALogin();
    return false;
}

// Cierra la sesión en Supabase y borra los datos locales (ciudadano y administrador)
export async function cerrarSesionGlobal() {
    if (supabaseClient) {
        try {
            await supabaseClient.auth.signOut();
        } catch (e) {
            console.warn("Error al cerrar sesión en Supabase:", e);
        }
    }
    localStorage.removeItem(CLAVE_USUARIO);
    CLAVES_ADMIN.forEach(k => localStorage.removeItem(k));
}

/* Mensajes en español para los errores más comunes de Supabase Auth */
export function mensajeAuth(error) {
    const m = String((error && error.message) || error || '').toLowerCase();
    if (m.includes('email not confirmed')) return 'Tu correo aún no está activado. Revisa tu bandeja (y spam) o pide un nuevo correo de activación.';
    if (m.includes('invalid login')) return 'Correo o contraseña incorrectos.';
    if (m.includes('already registered') || m.includes('already been registered')) return 'Ese correo ya tiene una cuenta. Inicia sesión o recupera tu contraseña.';
    if (m.includes('rate limit') || m.includes('too many') || m.includes('security purposes')) return 'Pediste muchos correos seguidos. Espera unos minutos e inténtalo de nuevo.';
    if (m.includes('password') && (m.includes('least') || m.includes('weak') || m.includes('short'))) return 'La contraseña es muy débil: usa mínimo 8 caracteres.';
    if (m.includes('valid email') || m.includes('invalid email')) return 'Escribe un correo válido.';
    if (m.includes('failed to fetch') || m.includes('network')) return 'Sin conexión a internet. Inténtalo de nuevo.';
    return (error && error.message) || 'Ocurrió un error. Inténtalo de nuevo.';
}

/* ---------- Ciudadano: cuenta (devuelven { error } en fallos esperados) ---------- */
export async function iniciarSesion(email, password) {
    if (!supabaseClient) return { error: new Error('Sin conexión con Supabase.') };
    email = String(email || '').trim().toLowerCase();
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) return { error: new Error(mensajeAuth(error)), sinConfirmar: /not confirmed/i.test(error.message || '') };

    const usuario = { id: data.user.id, nombre: data.user.user_metadata?.nombre || data.user.email, email: data.user.email };
    guardarUsuarioLocal(usuario);
    // El perfil se crea aquí (ya con sesión): al registrarse, con la confirmación de correo activa, aún no hay sesión
    try {
        await supabaseClient.from('usuarios_registrados').upsert({ id: usuario.id, email: usuario.email, nombre: data.user.user_metadata?.nombre || null }, { ignoreDuplicates: true });
    } catch (e) { /* no bloquea el ingreso */ }
    return { usuario };
}

export async function registrarUsuario(nombre, email, password) {
    if (!supabaseClient) return { error: new Error('Sin conexión con Supabase.') };
    email = String(email || '').trim().toLowerCase();
    if (!password || password.length < 8) return { error: new Error('La contraseña debe tener mínimo 8 caracteres.') };
    const opciones = { data: { nombre } };
    if (urlAuthLista()) opciones.emailRedirectTo = URL_WEB_AUTH;
    const { data, error } = await supabaseClient.auth.signUp({ email, password, options: opciones });
    if (error) return { error: new Error(mensajeAuth(error)) };

    // Supabase no da error si el correo ya existe: devuelve un usuario sin identidades
    if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { error: new Error(mensajeAuth('already registered')) };
    }
    // Con sesión inmediata (confirmación desactivada) se crea el perfil ya; si no, se crea al primer ingreso
    if (data && data.session && data.user) {
        try { await supabaseClient.from('usuarios_registrados').upsert({ id: data.user.id, email, nombre, edad: null, barrio: null }); } catch (e) { /* se reintenta al ingresar */ }
    }
    return { usuario: data?.user || null, requiereConfirmar: !(data && data.session) };
}

export async function recuperarPassword(email) {
    if (!supabaseClient) return { error: new Error('Sin conexión con Supabase.') };
    email = String(email || '').trim().toLowerCase();
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: urlAuthLista() ? URL_WEB_AUTH : RUTAS.login });
    return { error: error ? new Error(mensajeAuth(error)) : null };
}

// Reenvía el correo de activación de cuenta
export async function reenviarActivacion(email) {
    if (!supabaseClient) return { error: new Error('Sin conexión con Supabase.') };
    const { error } = await supabaseClient.auth.resend({
        type: 'signup', email: String(email || '').trim().toLowerCase(),
        options: urlAuthLista() ? { emailRedirectTo: URL_WEB_AUTH } : undefined
    });
    return { error: error ? new Error(mensajeAuth(error)) : null };
}

export async function actualizarPasswordUsuario(nuevoPassword) {
    if (!supabaseClient) return { local: true };
    const { error } = await supabaseClient.auth.updateUser({ password: nuevoPassword });
    if (error) throw error;
    return { local: false };
}

// Guarda el perfil en el celular y lo sincroniza con Supabase (si la columna municipio no existe, reintenta sin ella)
export async function guardarPerfilUsuario(usuario) {
    guardarUsuarioLocal(usuario);
    if (!supabaseClient || !usuario.id) return;
    try {
        const base = { id: usuario.id, email: usuario.email, nombre: usuario.nombre, edad: usuario.edad, barrio: usuario.barrio };
        const { error: errMun } = await supabaseClient.from('usuarios_registrados').upsert({ ...base, municipio: usuario.municipio });
        if (errMun) await supabaseClient.from('usuarios_registrados').upsert(base);
    } catch (err) {
        console.error("Error al sincronizar datos de usuario en Supabase:", err);
    }
}

/* ---------- Administrador (superadmin y dependencias) ---------- */
// Rol y dependencia viven en la tabla profiles
export async function validarPermisosAdministrativos(userId) {
    if (!supabaseClient || !userId) return null;
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('rol, dependencia')
            .eq('id', userId)
            .single();

        if (error || !data) return null;
        return data;
    } catch (err) {
        console.warn("Error al validar permisos de administrador:", err);
        return null;
    }
}

// El panel actualiza la dependencia si el superadmin la cambió desde el servidor
export const guardarDependenciaAdmin = dependencia => localStorage.setItem('userDependencia', dependencia);

export const datosAdminApp = () => ({
    rol: (localStorage.getItem('userRole') || '').toLowerCase(),
    dependencia: (localStorage.getItem('userDependencia') || '').toLowerCase(),
    email: localStorage.getItem('userEmail') || ''
});

/* Login administrativo único: lo usan tanto "Acceso administrativo" de login.html (móvil)
   como admin-login.html (app de escritorio). Devuelve { error: 'mensaje' } o { rol, dependencia, email }. */
export async function iniciarSesionAdministrativo(emailCrudo, password) {
    if (!supabaseClient) return { error: "Error de conexión con Supabase." };
    const email = String(emailCrudo || '').trim().toLowerCase();

    // 1. Autenticación
    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (authError || !authData || !authData.user) return { error: "Acceso denegado: Credenciales incorrectas." };

    return completarAccesoAdministrativo(authData.user);
}

/* Pasos 2 a 4 del acceso administrativo, con una sesión ya iniciada.
   Lo usan el login de este proyecto y sso.html (acceso único desde territoriocivico.com/acceso). */
export async function completarAccesoAdministrativo(usuario) {
    if (!supabaseClient || !usuario) return { error: "No hay una sesión válida." };
    const email = String(usuario.email || '').trim().toLowerCase();

    // 2. Permisos: la tabla usuarios_panel manda (es la que administra el superadmin).
    //    profiles es opcional: las cuentas que ya existían (correo personal o de la empresa)
    //    se agregan al panel sin perfil.
    const perfil = await validarPermisosAdministrativos(usuario.id);
    const { data: panel } = await supabaseClient
        .from('usuarios_panel')
        .select('activo, dependencia')
        .eq('email', email)
        .maybeSingle();

    if (panel && panel.activo === false) {
        await supabaseClient.auth.signOut();
        return { error: "Tu cuenta está desactivada. Contacta al administrador del sistema." };
    }
    if (!perfil && !panel) {
        await supabaseClient.auth.signOut();
        return { error: "Tu usuario no está autorizado como administrador." };
    }

    // 3. Rol y dependencia: primero lo asignado en el panel, si no, lo del perfil
    let rol = (perfil && perfil.rol) || 'admin';
    let dependencia = (perfil && perfil.dependencia) || '';
    if (panel && panel.dependencia) {
        dependencia = panel.dependencia;
        if (dependencia === 'superadmin') rol = 'superadmin';
    }

    // 4. Datos que lee el panel
    localStorage.setItem('userRole', rol);
    localStorage.setItem('userDependencia', dependencia);
    localStorage.setItem('userEmail', email);
    return { rol, dependencia, email };
}
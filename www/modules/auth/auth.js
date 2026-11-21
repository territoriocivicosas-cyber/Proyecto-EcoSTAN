/* ==========================================
   modules/auth/auth.js
   Pantallas de acceso (login.html y admin-login.html). Solo traduce los resultados de
   authService a mensajes y redirecciones; no toca Supabase ni localStorage directamente.
========================================== */
import {
    RUTAS, iniciarSesion, registrarUsuario, recuperarPassword, reenviarActivacion, iniciarSesionAdministrativo
} from '../../core/authService.js';

export async function iniciarSesionSupabase(email, password) {
    try {
        const { error, sinConfirmar } = await iniciarSesion(email, password);
        if (error) {
            alert(error.message);
            const b = document.getElementById('btnReenviar');
            if (b) b.style.display = sinConfirmar ? 'block' : 'none';
            return;
        }
        window.location.href = RUTAS.inicio;
    } catch (err) {
        alert("Ocurrió un error inesperado.");
    }
}

export async function registrarUsuarioSupabase(nombre, email, password) {
    try {
        const { error, requiereConfirmar } = await registrarUsuario(nombre, email, password);
        if (error) { alert(error.message); return; }

        alert(requiereConfirmar === false
            ? "¡Cuenta creada! Ya puedes iniciar sesión."
            : "¡Te damos la bienvenida a EcoStan! Te enviamos un correo para activar tu cuenta. Ábrelo y toca el botón de activación (revisa también spam). Después inicia sesión.");
        if (typeof window.cambiarVista === 'function') window.cambiarVista('vistaLogin');
    } catch (err) {
        alert("Error inesperado en el registro.");
    }
}

export async function recuperarPasswordSupabase(email) {
    try {
        const { error } = await recuperarPassword(email);
        if (error) { alert(error.message); return; }
        alert("Si ese correo tiene cuenta, te enviamos un enlace para crear una nueva contraseña. Revisa tu bandeja y spam.");
    } catch (err) {
        alert("Error inesperado.");
    }
}

export async function reenviarActivacionSupabase(email) {
    try {
        if (!email) { alert('Escribe tu correo en el campo de arriba.'); return; }
        const { error } = await reenviarActivacion(email);
        alert(error ? error.message : 'Te enviamos de nuevo el correo de activación. Revisa tu bandeja y spam.');
    } catch (err) { alert('Error inesperado.'); }
}

// Acceso administrativo (superadmin y dependencias). Devuelve true si entró.
export async function iniciarSesionAdminSupabase(email, password) {
    try {
        const resultado = await iniciarSesionAdministrativo(email, password);
        if (resultado.error) { alert(resultado.error); return false; }
        window.location.href = RUTAS.admin;
        return true;
    } catch (err) {
        console.error(err);
        alert("Error inesperado en el inicio de sesión.");
        return false;
    }
}

// Exposición global para formularios HTML tradicionales
Object.assign(window, { iniciarSesionSupabase, registrarUsuarioSupabase, recuperarPasswordSupabase, reenviarActivacionSupabase, iniciarSesionAdminSupabase });
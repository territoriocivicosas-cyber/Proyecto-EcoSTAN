/* ==========================================
   CONFIGURACIÓN Y NOVEDADES DE BANNERS
========================================== */

const MIS_BANNERS = [
    {
        badge: "PLATAFORMA CIUDADANA",
        titulo: "Ayudemos a mantener <strong>Bucaramanga limpia</strong>",
        descripcion: "Consulta las rutas de recolección, avisos y recibe información de interés ambiental.",
        texto_boton: "Ver iniciativas",
        imagen_fondo: "", // Opcional: si deseas usar una imagen de fondo (ej: 'assets/banner1.jpg')
        enlace_boton: "educacion" // Sección a la que redirige al hacer clic
    },
    {
        badge: "NUEVO COMUNICADO",
        titulo: "Jornada de recolección de <strong>RPA en Floridablanca</strong>",
        descripcion: "Este sábado estaremos recolectando residuos posconsumo en la Comuna 1.",
        texto_boton: "Ver avisos",
        imagen_fondo: "",
        enlace_boton: "avisos"
    },
    {
        badge: "CAMPUS VERDE",
        titulo: "Puntos de reciclaje <strong>activos en Girón</strong>",
        descripcion: "Conoce los nuevos contenedores para plástico y cartón instalados cerca a tu barrio.",
        texto_boton: "Ver mapa",
        imagen_fondo: "",
        enlace_boton: "rutas"
    }
];

// Hacer disponible la lista globalmente
window.MIS_BANNERS = MIS_BANNERS;
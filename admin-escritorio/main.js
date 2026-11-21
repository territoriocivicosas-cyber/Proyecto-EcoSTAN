// EcoSTAN Admin · app de escritorio (Windows). Sirve la carpeta www en un servidor local
// (igual que en el navegador) y abre el panel de administración.
const { app, BrowserWindow, shell, Menu } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, 'www');
const INICIO = '/admin-login.html';   // pantalla de acceso administrativo de EcoSTAN
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2'
};

function servidor() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let ruta = decodeURIComponent((req.url || '/').split('?')[0]);
      if (ruta === '/') ruta = INICIO;
      // Solo el panel de administración: cualquier otra página HTML (home, index, etc.) vuelve al acceso del admin
      if (/\.html?$/i.test(ruta) && ruta !== INICIO && !ruta.startsWith('/modules/administration/')) {
        res.writeHead(302, { Location: INICIO }); return res.end();
      }
      const archivo = path.normalize(path.join(RAIZ, ruta));
      if (!archivo.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
      fs.readFile(archivo, (err, data) => {
        if (err) { res.writeHead(404); return res.end('No encontrado'); }
        res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}

let ventana;
async function crear() {
  const puerto = await servidor();
  Menu.setApplicationMenu(null);
  ventana = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, backgroundColor: '#eef5f0',
    title: 'EcoSTAN · Administración', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  ventana.loadURL(`http://127.0.0.1:${puerto}${INICIO}`);
  // Los enlaces externos (SUI, WhatsApp, etc.) se abren en el navegador, no dentro de la app
  ventana.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  ventana.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${puerto}`)) { e.preventDefault(); shell.openExternal(url); } });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); } });
  app.whenReady().then(crear);
  app.on('window-all-closed', () => app.quit());
}
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let serverProcess: ReturnType<typeof spawn> | null = null;
const PORT = 3000;

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true); // Port is in use
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false); // Port is free
    });
    server.listen(port);
  });
}

function startServer(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    // If we're in dev mode, server is likely managed by concurrent/vite
    const isDev = process.env.NODE_ENV === 'development';

    if (isDev) {
      console.log('Running in development mode. Assuming server is managed externally.');
      resolve();
      return;
    }

    const portInUse = await checkPort(PORT);
    if (portInUse) {
      console.log(`Port ${PORT} is already in use. Assuming server is already running.`);
      resolve();
      return;
    }

    console.log('Starting Express server...');
    const serverPath = path.join(app.getAppPath(), 'server.js');

    serverProcess = spawn('node', [serverPath], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: PORT.toString()
      }
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server:', err);
      reject(err);
    });

    // Give the server a moment to start up
    setTimeout(() => {
      resolve();
    }, 1500);
  });
}

async function createWindow() {
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    // The overlay capabilities
    // transparent: true,
    // frame: false,
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(`http://localhost:${PORT}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

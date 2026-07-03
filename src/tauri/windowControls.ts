import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../stores/app";

const appWindow = getCurrentWindow();
let listenersBound = false;

export async function syncWindowState() {
  const appStore = useAppStore();
  const [maximized, fullscreen] = await Promise.all([
    appWindow.isMaximized(),
    appWindow.isFullscreen(),
  ]);

  appStore.window.maximized = maximized;
  appStore.window.fullscreen = fullscreen;
}

export async function bindWindowEvents() {
  if (listenersBound) {
    return;
  }

  listenersBound = true;

  await Promise.all([
    appWindow.onResized(() => {
      void syncWindowState();
    }),
    appWindow.onMoved(() => {
      void syncWindowState();
    }),
  ]);
}

export async function initializeWindowState() {
  await bindWindowEvents();
  await syncWindowState();
}

export async function minimizeWindow() {
  await appWindow.minimize();
}

export async function closeWindow() {
  await appWindow.close();
}

export async function toggleMaximizeWindow() {
  const appStore = useAppStore();

  if (appStore.window.fullscreen) {
    await appWindow.setFullscreen(false);
  }

  if (appStore.window.maximized) {
    await appWindow.unmaximize();
  } else {
    await appWindow.maximize();
  }

  await syncWindowState();
}

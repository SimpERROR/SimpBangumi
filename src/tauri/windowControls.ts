import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../stores/app";
import { isDesktopPlatform } from "../platform";

const appWindow = getCurrentWindow();
let listenersBound = false;

export async function syncWindowState() {
  if (!isDesktopPlatform) return;
  const appStore = useAppStore();
  const [maximized, fullscreen] = await Promise.all([
    appWindow.isMaximized(),
    appWindow.isFullscreen(),
  ]);

  appStore.window.maximized = maximized;
  appStore.window.fullscreen = fullscreen;
}

export async function bindWindowEvents() {
  if (!isDesktopPlatform) return;
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
  if (!isDesktopPlatform) return;
  await bindWindowEvents();
  await syncWindowState();
}

export async function minimizeWindow() {
  if (!isDesktopPlatform) return;
  await appWindow.minimize();
}

export async function closeWindow() {
  if (!isDesktopPlatform) return;
  await appWindow.close();
}

export async function toggleMaximizeWindow() {
  if (!isDesktopPlatform) return;
  const appStore = useAppStore();

  if (appStore.window.fullscreen) {
    // 退出全屏即可恢复此前的窗口状态，不应再叠加最大化/还原操作
    await appWindow.setFullscreen(false);
    await syncWindowState();
    return;
  }

  if (appStore.window.maximized) {
    await appWindow.unmaximize();
  } else {
    await appWindow.maximize();
  }

  await syncWindowState();
}

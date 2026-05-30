/**
 * Preload script — runs in an isolated context with access to a limited Node
 * surface, and exposes a tiny, safe API to the renderer via contextBridge.
 *
 * Keep this minimal. The renderer talks to the backend over HTTP
 * (http://127.0.0.1:4317/api), not through IPC, so this bridge only carries
 * desktop-shell metadata for now.
 */
import { contextBridge, ipcRenderer } from 'electron';

const desktopApi = {
  /** True when running inside the Electron desktop shell. */
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** App version, resolved lazily from the main process. */
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('desktop:get-version'),
};

contextBridge.exposeInMainWorld('desktop', desktopApi);

export type DesktopApi = typeof desktopApi;

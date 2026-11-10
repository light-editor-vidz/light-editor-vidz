import "@testing-library/jest-dom/vitest";

// Mock localStorage for tests
const localStorageMock = {
  getItem: (_key: string) => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  length: 0,
  key: () => null,
};
Object.defineProperty(window, "localStorage", { value: localStorageMock });

// jsdom does not implement media playback; without these every video element
// prints "Not implemented: HTMLMediaElement's load() method" dozens of times.
Object.defineProperty(window.HTMLMediaElement.prototype, "load", { configurable: true, value: () => {} });

// Maquette de l'API du moteur pour les composants testés
window.electronAPI = {
  getPathForFile: () => "",
  toFileUrl: async (filePath: string) => `lcv-file://local${filePath}`,
  toStreamUrl: async (url: string) => `stream:${url}`,
  openVideo: async () => null,
  saveVideo: async () => null,
  cancelFfmpeg: async () => {},
  getCapabilities: async () => ({ hardware: [], stabilization: true }),
  queueAdd: async () => ({ id: 1 }),
  queueList: async () => [],
  queueCancel: async () => true,
  queueClearFinished: async () => {},
  queueReveal: async () => {},
  onQueueUpdate: () => () => {},
  listRecent: async () => [],
  removeRecent: async () => {},
  clearRecent: async () => {},
  previewVideo: async () => "",
  openSubtitleFile: async () => null,
  onPreviewProgress: () => () => {},
  exportVideo: async () => ({ success: true, outputPath: "" }),
  onProgress: () => () => {},
};

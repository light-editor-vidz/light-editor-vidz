import "@testing-library/jest-dom";
import { vi } from "vitest";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

// Node 25+ ships its own Web Storage global, which stays unusable without
// --localstorage-file and hides the one jsdom provides. Fall back to an in-memory
// Storage so the suite behaves the same on any Node version.
if (typeof globalThis.localStorage?.clear !== "function") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => [...store.keys()][index] ?? null,
      removeItem: (key: string) => void store.delete(key),
      setItem: (key: string, value: string) => void store.set(key, String(value)),
    } satisfies Storage,
  });
}

// Real translations, pinned to English: component tests then assert the strings a
// user actually sees, and the language detector never runs in jsdom.
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

// jsdom ships no 2D context; the drawing code only needs the calls to be harmless.
const context2d = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  scale: vi.fn(),
  setTransform: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  globalAlpha: 1,
  font: "",
  measureText: vi.fn(() => ({ width: 0 })),
  fillText: vi.fn(),
};

HTMLCanvasElement.prototype.getContext = vi.fn(() => context2d) as unknown as HTMLCanvasElement["getContext"];

// jsdom implements neither media playback nor <dialog>'s modal methods.
HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
HTMLMediaElement.prototype.pause = vi.fn();
HTMLMediaElement.prototype.load = vi.fn();
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// The native menu bar and the window: recorded instead of built, so tests can read the menu the
// app installs and click its entries.
vi.mock("@tauri-apps/api/menu", () => {
  const make = (kind: string) => ({ new: vi.fn(async (options: object) => ({ kind, ...options })) });
  return {
    Menu: { new: vi.fn(async (options: object) => ({ ...options, setAsAppMenu: vi.fn() })) },
    Submenu: make("submenu"),
    MenuItem: make("item"),
    CheckMenuItem: make("check"),
    PredefinedMenuItem: make("predefined"),
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTheme: vi.fn(async () => {}),
    isFullscreen: vi.fn(async () => false),
    setFullscreen: vi.fn(async () => {}),
  }),
}));

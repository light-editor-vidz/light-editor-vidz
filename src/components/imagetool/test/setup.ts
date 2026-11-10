import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

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

// jsdom ships no 2D context, and the components that draw only need the calls to
// be harmless. Stub just enough of the API for them to run without warnings.
const context2d = {
  canvas: null as unknown as HTMLCanvasElement,
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
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
  putImageData: vi.fn(),
  createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  lineCap: "butt",
  lineJoin: "miter",
};

HTMLCanvasElement.prototype.getContext = vi.fn(() => context2d) as unknown as HTMLCanvasElement["getContext"];

HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,AAA");

// jsdom implements <dialog> but not its modal methods.
HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.open = true;
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.open = false;
});

// jsdom ne fournit pas PointerEvent : sans lui, `clientX` des évènements pointeur est perdu.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// jsdom n'implémente pas la capture du pointeur.
HTMLElement.prototype.setPointerCapture ??= vi.fn();
HTMLElement.prototype.releasePointerCapture ??= vi.fn();

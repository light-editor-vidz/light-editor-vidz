import "./setup";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VideoSafeZone from "../components/VideoSafeZone";
import { fitBox } from "../utils/reframePreview";
import { lastReframeMode } from "../utils/exportPrefs";
import type { CropRect } from "../types";

vi.mock("../hooks/useVideoRect", () => ({
  useVideoRect: () => ({ left: 10, top: 20, width: 960, height: 540, naturalWidth: 1920, naturalHeight: 1080 }),
}));

const zone = { top: 0.1, bottom: 0.2, left: 0.05, right: 0.15 };
const video = {
  videoWidth: 1920,
  videoHeight: 1080,
  readyState: 4,
  currentTime: 1,
  currentSrc: "blob:v",
} as HTMLVideoElement;

function r(crop: CropRect | null, rotation = 0, mode: "blur" | "crop" = "blur") {
  return render(
    <VideoSafeZone
      videoRef={{ current: video }}
      zone={zone}
      crop={crop}
      rotation={rotation}
      mode={mode}
      label="reframed"
    />,
  );
}

describe("VideoSafeZone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("se pose sur la partie recadrée en 9:16", () => {
    const { container } = r({ x: 656, y: 0, w: 608, h: 1080 });
    const area = container.firstElementChild as HTMLElement;
    expect(area.style.left).toBe("338px");
    expect(area.style.width).toBe("304px");
    expect(container.querySelector<HTMLElement>(".safe-zone-frame")?.style.bottom).toBe("20%");
    expect(screen.queryByText("reframed")).not.toBeInTheDocument();
  });

  /** Les dessins de la prochaine image : [rotation, arguments de `drawImage` après la vidéo]. */
  function drawings(render: () => void) {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => ((frame = cb), 1));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const calls: [number, number[]][] = [];
    let angle = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: (a: number) => (angle = a),
      drawImage: (_: unknown, ...args: number[]) => calls.push([angle, args.map(Math.round)]),
    } as never);
    render();
    act(() => frame!(0));
    return calls;
  }

  it("montre une image 16:9 entière sur son fond flou", () => {
    let view: ReturnType<typeof r>;
    const calls = drawings(() => (view = r(null)));

    expect(screen.getByText("reframed")).toBeInTheDocument();
    expect(view!.container.querySelectorAll("canvas")).toHaveLength(2);
    // Devant : contenue (270 de large) ; derrière : couvrant les 480 de haut.
    expect(calls[0][1].slice(4)).toEqual([-135, -76, 270, 152]);
    expect(calls[1][1].slice(4)).toEqual([-427, -240, 853, 480]);
  });

  it("la rogne en mode « rogner », sans fond", () => {
    let view: ReturnType<typeof r>;
    const calls = drawings(() => (view = r(null, 0, "crop")));
    expect(view!.container.querySelectorAll("canvas")).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0][1][7]).toBe(480);
  });

  it("applique le quart de tour : une image 16:9 tournée remplit le cadre", () => {
    const calls = drawings(() => r(null, 90, "crop"));
    expect(calls[0][0]).toBeCloseTo(Math.PI / 2);
    // Dessinée couchée (480 × 270) puis tournée.
    expect(calls[0][1].slice(6)).toEqual([480, 270]);
  });

  it("centre l'image dans le cadre", () => {
    expect(fitBox({ w: 100, h: 100 }, { w: 270, h: 480 }, "contain")).toEqual({ x: 0, y: 105, w: 270, h: 270 });
  });

  it("reprend le mode de recadrage de la fenêtre d'export", () => {
    expect(lastReframeMode()).toBe("blur");
  });
});

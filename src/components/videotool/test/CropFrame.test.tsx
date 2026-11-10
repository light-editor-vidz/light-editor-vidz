import "./setup";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import CropFrame from "../components/CropFrame";

function Harness({
  videoWidth = 1920,
  crop = { x: 100, y: 50, w: 300, h: 200 },
  transform,
  geometry,
}: {
  videoWidth?: number;
  crop?: { x: number; y: number; w: number; h: number };
  transform?: string;
  geometry?: React.ComponentProps<typeof CropFrame>["geometry"];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  return (
    <div style={{ position: "relative" }} data-testid="parent">
      <video
        ref={(el) => {
          if (el) {
            Object.defineProperty(el, "videoWidth", { value: videoWidth, configurable: true });
            // Layout metrics: unaffected by a CSS rotation, unlike getBoundingClientRect.
            for (const [key, value] of Object.entries({
              offsetLeft: 10,
              offsetTop: 20,
              offsetWidth: 960,
              offsetHeight: 540,
            })) {
              Object.defineProperty(el, key, { value, configurable: true });
            }
          }
          (videoRef as { current: HTMLVideoElement | null }).current = el;
        }}
      />
      <CropFrame videoRef={videoRef} crop={crop} transform={transform} geometry={geometry} />
    </div>
  );
}

describe("CropFrame", () => {
  it("renders nothing when video has no width", () => {
    function NoVideo() {
      const ref = useRef<HTMLVideoElement | null>(null);
      return <CropFrame videoRef={ref} crop={{ x: 0, y: 0, w: 10, h: 10 }} />;
    }
    const { container } = render(<NoVideo />);
    expect(container.firstChild).toBeNull();
  });

  it("pins a layer to the picture and places the crop inside it, scaled by 960/1920", () => {
    const { container } = render(<Harness />);
    const layer = container.querySelector('[style*="position: absolute"]') as HTMLElement;
    expect(layer.style.left).toBe("10px");
    expect(layer.style.top).toBe("20px");
    expect(layer.style.width).toBe("960px");
    const frame = layer.firstElementChild as HTMLElement;
    // crop.x=100 * 0.5 = 50 and crop.y=50 * 0.5 = 25, relative to the picture
    expect(frame.style.left).toBe("50px");
    expect(frame.style.top).toBe("25px");
    expect(frame.style.width).toBe("150px");
    expect(frame.style.height).toBe("100px");
  });

  // The crop is drawn on the unrotated frame: the layer must turn with the video.
  it("applies the video transform so the frame follows a rotation", () => {
    const { container } = render(<Harness transform="rotateZ(90deg)" />);
    const layer = container.querySelector('[style*="position: absolute"]') as HTMLElement;
    expect(layer.style.transform).toBe("rotateZ(90deg)");
  });

  it("derives the transform from the video geometry", () => {
    const { container } = render(
      <Harness geometry={{ rotation: 90, straighten: 0, perspectiveH: 0, perspectiveV: 0, filterId: "none" }} />,
    );
    const layer = container.querySelector('[style*="position: absolute"]') as HTMLElement;
    expect(layer.style.transform).toBe("rotateZ(90deg)");
  });

  it("follows a perspective with a projective matrix pinned to the top-left", () => {
    const { container } = render(
      <Harness geometry={{ rotation: 0, straighten: 0, perspectiveH: 20, perspectiveV: 0, filterId: "none" }} />,
    );
    const layer = container.querySelector('[style*="position: absolute"]') as HTMLElement;
    expect(layer.style.transform).toMatch(/^matrix3d\(/);
    expect(layer.style.transformOrigin).toBe("0 0");
  });
});

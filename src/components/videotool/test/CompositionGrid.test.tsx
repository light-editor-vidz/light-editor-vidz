import "./setup";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import CompositionGrid from "../components/CompositionGrid";

describe("CompositionGrid", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(<CompositionGrid visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the grid container when visible", () => {
    const { container } = render(<CompositionGrid visible={true} />);
    expect(container.querySelector(".composition-grid")).toBeTruthy();
  });

  it("renders the 4 rule-of-thirds lines", () => {
    const { container } = render(<CompositionGrid visible={true} />);
    expect(container.querySelectorAll(".grid-line")).toHaveLength(4);
    expect(container.querySelector(".grid-v1")).toBeTruthy();
    expect(container.querySelector(".grid-v2")).toBeTruthy();
    expect(container.querySelector(".grid-h1")).toBeTruthy();
    expect(container.querySelector(".grid-h2")).toBeTruthy();
  });
});

describe("CompositionGrid — pinned to the picture", () => {
  function Pinned() {
    const ref = { current: null as HTMLVideoElement | null };
    const video = document.createElement("video");
    Object.defineProperty(video, "videoWidth", { value: 1920 });
    for (const [k, v] of Object.entries({ offsetLeft: 40, offsetTop: 10, offsetWidth: 600, offsetHeight: 300 })) {
      Object.defineProperty(video, k, { value: v });
    }
    ref.current = video;
    return <CompositionGrid visible videoRef={ref} />;
  }

  // The thirds must fall on the image, not on the black bars around it.
  it("covers exactly the video, not its black surround", () => {
    const { container } = render(<Pinned />);
    const grid = container.querySelector(".composition-grid") as HTMLElement;
    expect(grid.style.left).toBe("40px");
    expect(grid.style.top).toBe("10px");
    expect(grid.style.width).toBe("600px");
    expect(grid.style.height).toBe("300px");
  });

  it("still renders (full container) before the video size is known", () => {
    const { container } = render(<CompositionGrid visible />);
    expect((container.querySelector(".composition-grid") as HTMLElement).style.width).toBe("");
  });
});

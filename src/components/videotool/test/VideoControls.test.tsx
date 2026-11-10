import "./setup";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import VideoControls from "../components/VideoControls";

describe("VideoControls", () => {
  const defaultProps = {
    currentTime: 0,
    duration: 100,
    isPlaying: false,
    onPlayPause: vi.fn(),
    onSeek: vi.fn(),
  };

  it("renders play button when paused", () => {
    render(<VideoControls {...defaultProps} />);
    const btn = screen.getByRole("button");
    expect(btn).toBeTruthy();
  });

  it("calls onPlayPause when play button is clicked", () => {
    const onPlayPause = vi.fn();
    render(<VideoControls {...defaultProps} onPlayPause={onPlayPause} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onPlayPause).toHaveBeenCalledOnce();
  });

  it("displays current time and duration", () => {
    const { container } = render(<VideoControls {...defaultProps} currentTime={65} duration={120} />);
    const timeEl = container.querySelector(".vc-time")!;
    expect(timeEl.textContent).toMatch(/1:05/);
    expect(timeEl.textContent).toMatch(/2:00/);
  });

  it("shows pause icon when playing", () => {
    const { container } = render(<VideoControls {...defaultProps} isPlaying={true} />);
    // Pause icon has two rect elements
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBe(2);
  });

  it("calls onSeek when seekbar is clicked", () => {
    const onSeek = vi.fn();
    const { container } = render(<VideoControls {...defaultProps} onSeek={onSeek} duration={100} />);
    const seekbar = container.querySelector(".seekbar")!;
    Object.defineProperty(seekbar, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 100, top: 0, bottom: 0, right: 100, height: 10 }),
    });
    seekbar.setPointerCapture = vi.fn();
    fireEvent.pointerDown(seekbar, { clientX: 50, buttons: 1 });
    expect(onSeek).toHaveBeenCalledWith(expect.closeTo(50, 0));
  });
});

// ─── Seekbar interaction ─────────────────────────────────────────────────────

describe("VideoControls seekbar", () => {
  function setup(props: Partial<React.ComponentProps<typeof VideoControls>> = {}) {
    const onSeek = vi.fn();
    const onPlayPause = vi.fn();
    const { container } = render(
      <VideoControls
        currentTime={0}
        duration={100}
        isPlaying={false}
        onPlayPause={onPlayPause}
        onSeek={onSeek}
        {...props}
      />,
    );
    const bar = container.querySelector(".seekbar") as HTMLElement;
    bar.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 10, width: 200, height: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    bar.setPointerCapture = vi.fn();
    return { container, bar, onSeek, onPlayPause };
  }

  it("seeks to the clicked position", () => {
    const { bar, onSeek } = setup();
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(50);
  });

  it("keeps seeking while dragging", () => {
    const { bar, onSeek } = setup();
    fireEvent.pointerDown(bar, { clientX: 20, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 120, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(60);
  });

  it("stops seeking once the pointer is released", () => {
    const { bar, onSeek } = setup();
    fireEvent.pointerDown(bar, { clientX: 20, pointerId: 1 });
    fireEvent.pointerUp(bar, { pointerId: 1 });
    onSeek.mockClear();
    fireEvent.pointerMove(bar, { clientX: 180, pointerId: 1 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("clamps a seek past the end to the duration", () => {
    const { bar, onSeek } = setup();
    fireEvent.pointerDown(bar, { clientX: 500, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(100);
  });

  it("clamps a seek before the start to zero", () => {
    const { bar, onSeek } = setup();
    fireEvent.pointerDown(bar, { clientX: -50, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("shows a hover marker and previews the hovered time", () => {
    const { container, bar } = setup({ currentTime: 10 });
    fireEvent.pointerMove(bar, { clientX: 150, pointerId: 1 });
    expect(container.querySelector(".seekbar-hover-marker")).toBeTruthy();
    expect(container.querySelector(".seekbar-tooltip")?.textContent).toBe("1:15");
  });

  it("drops the hover marker when the pointer leaves", () => {
    const { container, bar } = setup();
    fireEvent.pointerMove(bar, { clientX: 150, pointerId: 1 });
    fireEvent.pointerLeave(bar);
    expect(container.querySelector(".seekbar-hover-marker")).toBeNull();
  });

  it("falls back to the current time in the tooltip when not hovering", () => {
    const { container } = setup({ currentTime: 30 });
    expect(container.querySelector(".seekbar-tooltip")?.textContent).toBe("0:30");
  });

  it("does not divide by zero before a video is loaded", () => {
    const { container, bar, onSeek } = setup({ duration: 0 });
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(0);
    expect((container.querySelector(".seekbar-fill") as HTMLElement).style.width).toBe("0%");
  });
});

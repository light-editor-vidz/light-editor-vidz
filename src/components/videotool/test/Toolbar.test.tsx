import "./setup";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import Toolbar from "../components/Toolbar";
import { LangProvider } from "../i18n";
import type { EditorState } from "../types";
import type { StabilizeLevel } from "../hooks/useHistory";

const baseState: EditorState = {
  videoPath: "/tmp/v.mp4",
  videoUrl: "file:///tmp/v.mp4",
  duration: 100,
  speed: 1,
  muted: false,
  cutSegments: [],
  crop: null,
  filter: "none",
  rotation: 0,
  straighten: 0,
  perspectiveHorizontal: 0,
  perspectiveVertical: 0,
  subtitles: null,
  stabilize: "off",
};

function makeProps(
  overrides: Partial<EditorState> = {},
  callbacks: Partial<{
    onSpeedChange: (s: number) => void;
    onSpeedChangeLive: (s: number) => void;
    onCommit: () => void;
    onStabilizeChange: (l: StabilizeLevel) => void;
    onMuteToggle: () => void;
    onCropToggle: () => void;
    onCropReset: () => void;
    onFilterToggle: () => void;
    onGeometryToggle: () => void;
    onSubtitlesToggle: () => void;
  }> = {},
  flags: Partial<{ showCrop: boolean; showFilters: boolean; showGeometry: boolean; showSubtitles: boolean }> = {},
) {
  return {
    state: { ...baseState, ...overrides },
    showCrop: false,
    showFilters: false,
    showGeometry: false,
    showSubtitles: false,
    ...flags,
    onSpeedChange: vi.fn(),
    onSpeedChangeLive: vi.fn(),
    onCommit: vi.fn(),
    onStabilizeChange: vi.fn(),
    onMuteToggle: vi.fn(),
    onCropToggle: vi.fn(),
    onCropReset: vi.fn(),
    onFilterToggle: vi.fn(),
    onGeometryToggle: vi.fn(),
    onSubtitlesToggle: vi.fn(),
    ...callbacks,
  };
}

function r(props: ReturnType<typeof makeProps>) {
  return render(
    <LangProvider>
      <Toolbar {...props} />
    </LangProvider>,
  );
}

describe("Toolbar", () => {
  it("renders all tool sections", () => {
    const { container } = r(makeProps());
    expect(container.querySelectorAll(".tool-section").length).toBeGreaterThanOrEqual(5);
  });

  it("displays current speed as Nx", () => {
    const { container } = r(makeProps({ speed: 1.5 }));
    expect(container.querySelector(".speed-display")?.textContent).toBe("1.5x");
  });

  it("calls onSpeedChange when a speed preset is clicked", () => {
    const onSpeedChange = vi.fn();
    const { container } = r(makeProps({}, { onSpeedChange }));
    const preset = container.querySelectorAll(".preset-btn")[0] as HTMLButtonElement;
    fireEvent.click(preset);
    expect(onSpeedChange).toHaveBeenCalledWith(0.25);
  });

  it("marks the active speed preset", () => {
    const { container } = r(makeProps({ speed: 2 }));
    const active = container.querySelector(".preset-btn.active");
    expect(active?.textContent).toBe("2x");
  });

  it("reports slider moves as a live change, not a history entry", () => {
    const onSpeedChange = vi.fn();
    const onSpeedChangeLive = vi.fn();
    const { container } = r(makeProps({}, { onSpeedChange, onSpeedChangeLive }));
    const slider = container.querySelector(".speed-slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "4" } });
    expect(onSpeedChangeLive).toHaveBeenCalledWith(1.25);
    expect(onSpeedChange).not.toHaveBeenCalled();
  });

  it("closes the gesture when the slider is released", () => {
    const onCommit = vi.fn();
    const { container } = r(makeProps({}, { onCommit }));
    const slider = container.querySelector(".speed-slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "4" } });
    fireEvent.pointerUp(slider);
    expect(onCommit).toHaveBeenCalled();
  });

  it("keeps preset buttons as discrete, immediately-undoable edits", () => {
    const onSpeedChange = vi.fn();
    const onSpeedChangeLive = vi.fn();
    const { container } = r(makeProps({}, { onSpeedChange, onSpeedChangeLive }));
    const presets = container.querySelectorAll(".preset-btn");
    fireEvent.click(presets[presets.length - 1]);
    expect(onSpeedChange).toHaveBeenCalledWith(4);
    expect(onSpeedChangeLive).not.toHaveBeenCalled();
  });

  it("shows muted label when muted", () => {
    const { container } = r(makeProps({ muted: true }));
    expect(container.textContent).toMatch(/muted|muet/i);
  });

  it("calls onMuteToggle on audio button click", () => {
    const onMuteToggle = vi.fn();
    const { container } = r(makeProps({}, { onMuteToggle }));
    const audioSection = container.querySelectorAll(".tool-section")[4];
    const btn = audioSection.querySelector("button")!;
    fireEvent.click(btn);
    expect(onMuteToggle).toHaveBeenCalledOnce();
  });

  it('shows the "set crop" button when no crop is active', () => {
    const { container } = r(makeProps());
    expect(container.textContent).toMatch(/set crop|recadrer/i);
  });

  it("shows the applied crop dimensions when crop is set", () => {
    const { container } = r(makeProps({ crop: { x: 0, y: 0, w: 320, h: 240 } }));
    expect(container.textContent).toMatch(/320.*240/);
  });

  it('shows the "Adjust" + "Reset" buttons when crop is set', () => {
    const { container } = r(makeProps({ crop: { x: 0, y: 0, w: 320, h: 240 } }));
    expect(container.textContent).toMatch(/adjust|ajuster/i);
    expect(container.textContent).toMatch(/reset|réinitialiser/i);
  });

  it("shows the crop hint while in crop mode", () => {
    const { container } = r(makeProps({}, {}, { showCrop: true }));
    expect(container.querySelector(".crop-hint")).toBeTruthy();
  });

  it("calls onCropToggle and onCropReset", () => {
    const onCropToggle = vi.fn();
    const onCropReset = vi.fn();
    const { container } = r(makeProps({ crop: { x: 0, y: 0, w: 10, h: 10 } }, { onCropToggle, onCropReset }));
    const buttons = container.querySelectorAll("button");
    // adjust button is first, reset second
    fireEvent.click(buttons[3]); // geom/filter buttons come before crop section
    // Just verify clicks work by clicking labelled buttons
    const adjustBtn = Array.from(buttons).find((b) => /adjust|ajuster/i.test(b.textContent || ""))!;
    const resetBtn = Array.from(buttons).find((b) => /reset|réinit/i.test(b.textContent || ""))!;
    fireEvent.click(adjustBtn);
    fireEvent.click(resetBtn);
    expect(onCropToggle).toHaveBeenCalled();
    expect(onCropReset).toHaveBeenCalled();
  });

  it("calls onFilterToggle", () => {
    const onFilterToggle = vi.fn();
    const { container } = r(makeProps({}, { onFilterToggle }));
    const filterBtn = container.querySelectorAll(".tool-toggle-btn")[1];
    fireEvent.click(filterBtn);
    expect(onFilterToggle).toHaveBeenCalledOnce();
  });

  it("calls onGeometryToggle", () => {
    const onGeometryToggle = vi.fn();
    const { container } = r(makeProps({}, { onGeometryToggle }));
    const geomBtn = container.querySelectorAll(".tool-toggle-btn")[0];
    fireEvent.click(geomBtn);
    expect(onGeometryToggle).toHaveBeenCalledOnce();
  });

  it("marks the filter button as accent when filter panel is shown", () => {
    const { container } = r(makeProps({}, {}, { showFilters: true }));
    const filterBtn = container.querySelectorAll(".tool-toggle-btn")[1];
    expect(filterBtn.className).toContain("active-accent");
  });

  it("marks geometry button as ok-state when a transform is applied", () => {
    const { container } = r(makeProps({ rotation: 90 }));
    const geomBtn = container.querySelectorAll(".tool-toggle-btn")[0];
    expect(geomBtn.className).toContain("active-ok");
  });

  it("shows cut count when there are cut segments", () => {
    const { container } = r(
      makeProps({
        cutSegments: [
          { id: "a", start: 0, end: 10 },
          { id: "b", start: 20, end: 30 },
        ],
      }),
    );
    expect(container.querySelector(".trim-count")?.textContent).toMatch(/2/);
  });

  it("does not render trim count when no cuts", () => {
    const { container } = r(makeProps());
    expect(container.querySelector(".trim-count")).toBeNull();
  });
});

describe("Toolbar — labels", () => {
  const renderBar = (overrides: Partial<EditorState>) =>
    render(
      <LangProvider>
        <Toolbar {...makeProps(overrides)} />
      </LangProvider>,
    );

  // The raw id used to be printed capitalised: "Upside_down", "Bright".
  it("shows the translated name of the active filter, not its id", () => {
    const { container } = renderBar({ filter: "upside_down" });
    const text = container.textContent ?? "";
    expect(text).toContain("Upside Down");
    expect(text).not.toContain("Upside_down");
  });

  it("lights the geometry button for a straighten angle alone", () => {
    const { container } = renderBar({ straighten: 5 });
    expect(container.querySelectorAll(".tool-toggle-btn")[0].className).toContain("active-ok");
  });

  it("leaves the geometry button plain when nothing is set", () => {
    const { container } = renderBar({});
    expect(container.querySelectorAll(".tool-toggle-btn")[0].className).not.toContain("active-ok");
  });
});

describe("Toolbar — version", () => {
  it("does not show the version: it is in the About box", () => {
    const { container } = render(
      <LangProvider>
        <Toolbar {...makeProps()} />
      </LangProvider>,
    );
    expect(container.querySelector(".toolbar-version")).toBeNull();
    expect(container.textContent).not.toMatch(/v\d+\.\d+/);
  });
});

describe("Toolbar — stabilisation", () => {
  const renderBar = (
    overrides: Partial<EditorState> = {},
    cb: Partial<{ onStabilizeChange: (l: StabilizeLevel) => void }> = {},
  ) =>
    render(
      <LangProvider>
        <Toolbar {...makeProps(overrides, cb)} />
      </LangProvider>,
    );
  const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll(".stab-btn")) as HTMLElement[];

  it("offers off, light, normal and strong", () => {
    const { container } = renderBar();
    expect(buttons(container)).toHaveLength(4);
  });
  it("marks the current level", () => {
    const { container } = renderBar({ stabilize: "normal" });
    const pressed = buttons(container).filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0].className).toContain("active");
  });
  it.each([
    ["light", 1],
    ["normal", 2],
    ["strong", 3],
    ["off", 0],
  ] as const)("picking %s reports it", (level, index) => {
    const onStabilizeChange = vi.fn();
    const { container } = renderBar({ stabilize: level === "off" ? "strong" : "off" }, { onStabilizeChange });
    fireEvent.click(buttons(container)[index]);
    expect(onStabilizeChange).toHaveBeenCalledWith(level);
  });
  it("explains that it is applied at export, only when it is on", () => {
    expect(
      renderBar({ stabilize: "off" }).container.querySelector(".trim-hint + .trim-hint, .stab-options + .trim-hint"),
    ).toBeNull();
    expect(renderBar({ stabilize: "light" }).container.querySelector(".stab-options + .trim-hint")).toBeTruthy();
  });
});

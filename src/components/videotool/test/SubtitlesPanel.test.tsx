import "./setup";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SubtitlesPanel from "../components/SubtitlesPanel";
import { DEFAULT_SUBTITLE_STYLE } from "../types";
import type { SubtitlesState } from "../types";
import { LangProvider } from "../i18n";

function renderWithI18n(ui: React.ReactElement) {
  return render(<LangProvider>{ui}</LangProvider>);
}

const loaded: SubtitlesState = {
  fileName: "captions.srt",
  cues: [{ id: 1, start: 0, end: 2, text: "hello world" }],
  style: DEFAULT_SUBTITLE_STYLE,
  animation: "word-pop",
};

function makeProps(overrides: Partial<React.ComponentProps<typeof SubtitlesPanel>> = {}) {
  return {
    subtitles: null,
    onImport: vi.fn(),
    onStyleChange: vi.fn(),
    onAnimationChange: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  window.electronAPI.openSubtitleFile = vi.fn().mockResolvedValue(null);
});

const SRT = "1\n00:00:00,000 --> 00:00:02,000\nhello world\n\n2\n00:00:02,000 --> 00:00:04,000\nsecond line\n";

describe("SubtitlesPanel — empty state", () => {
  it("offers an import button and no styling controls", () => {
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps()} />);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector(".subtitles-hint")).toBeTruthy();
    expect(container.querySelector(".subtitles-anim-grid")).toBeNull();
  });

  it("parses the picked file and reports its cues with the bare file name", async () => {
    const onImport = vi.fn();
    window.electronAPI.openSubtitleFile = vi.fn().mockResolvedValue({
      filePath: "/home/u/Videos/captions.srt",
      content: SRT,
    });
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps({ onImport })} />);
    fireEvent.click(container.querySelector("button")!);

    await waitFor(() => expect(onImport).toHaveBeenCalled());
    const [fileName, cues] = onImport.mock.calls[0];
    expect(fileName).toBe("captions.srt");
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ id: 1, start: 0, end: 2, text: "hello world" });
  });

  it("reports nothing when the picker is cancelled", async () => {
    const onImport = vi.fn();
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps({ onImport })} />);
    fireEvent.click(container.querySelector("button")!);
    await waitFor(() => expect(window.electronAPI.openSubtitleFile).toHaveBeenCalled());
    expect(onImport).not.toHaveBeenCalled();
  });

  it("handles a Windows-style path", async () => {
    const onImport = vi.fn();
    window.electronAPI.openSubtitleFile = vi.fn().mockResolvedValue({
      filePath: "C:\\Users\\u\\subs.srt",
      content: SRT,
    });
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps({ onImport })} />);
    fireEvent.click(container.querySelector("button")!);
    await waitFor(() => expect(onImport).toHaveBeenCalledWith("subs.srt", expect.any(Array)));
  });
});

describe("SubtitlesPanel — loaded state", () => {
  it("shows the file name and a remove button", () => {
    const onRemove = vi.fn();
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps({ subtitles: loaded, onRemove })} />);
    expect(screen.getByText("captions.srt")).toBeTruthy();
    fireEvent.click(container.querySelector(".subtitles-remove")!);
    expect(onRemove).toHaveBeenCalled();
  });

  it("lists every animation mode", () => {
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps({ subtitles: loaded })} />);
    expect(container.querySelectorAll(".subtitles-anim-card")).toHaveLength(7);
  });

  it("marks the active animation", () => {
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps({ subtitles: loaded })} />);
    const active = container.querySelectorAll(".subtitles-anim-card.active");
    expect(active).toHaveLength(1);
  });

  it("reports an animation change", () => {
    const onAnimationChange = vi.fn();
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps({ subtitles: loaded, onAnimationChange })} />);
    const cards = container.querySelectorAll(".subtitles-anim-card");
    fireEvent.click(cards[cards.length - 1]);
    expect(onAnimationChange).toHaveBeenCalledWith("typewriter");
  });
});

describe("SubtitlesPanel — style controls", () => {
  function styleAfterChange(selector: string, value: string, index = 0) {
    const onStyleChange = vi.fn();
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps({ subtitles: loaded, onStyleChange })} />);
    const el = container.querySelectorAll(selector)[index] as HTMLElement;
    fireEvent.change(el, { target: { value } });
    return onStyleChange.mock.calls[0]?.[0];
  }

  it("changes the font family", () => {
    expect(styleAfterChange(".subtitles-select", "Impact")).toMatchObject({ fontFamily: "Impact" });
  });

  it("changes the font size as a number", () => {
    expect(styleAfterChange(".subtitles-slider", "8", 0)).toMatchObject({ fontSize: 8 });
  });

  it("changes the outline width as a number", () => {
    expect(styleAfterChange(".subtitles-slider", "4", 1)).toMatchObject({ outlineWidth: 4 });
  });

  it("changes the background opacity as a number", () => {
    expect(styleAfterChange(".subtitles-slider", "0.5", 2)).toMatchObject({ backgroundOpacity: 0.5 });
  });

  it.each([
    [0, "color"],
    [1, "outlineColor"],
    [2, "backgroundColor"],
  ])("changes colour input %i (%s)", (index, key) => {
    expect(styleAfterChange('input[type="color"]', "#ff0000", index)).toMatchObject({ [key]: "#ff0000" });
  });

  it("keeps the rest of the style untouched when patching one field", () => {
    const next = styleAfterChange(".subtitles-select", "Georgia");
    expect(next).toEqual({ ...DEFAULT_SUBTITLE_STYLE, fontFamily: "Georgia" });
  });

  it("offers three positions and reports the chosen one", () => {
    const onStyleChange = vi.fn();
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps({ subtitles: loaded, onStyleChange })} />);
    const buttons = container.querySelectorAll(".subtitles-position-row button");
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[0]);
    expect(onStyleChange).toHaveBeenCalledWith(expect.objectContaining({ position: "top" }));
  });
});

describe("SubtitlesPanel — accent colour", () => {
  // The accent only means anything for the mode that highlights one word.
  it("is hidden unless word-highlight is active", () => {
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps({ subtitles: loaded })} />);
    expect(container.querySelectorAll('input[type="color"]')).toHaveLength(3);
  });

  it("appears for word-highlight", () => {
    const { container } = renderWithI18n(
      <SubtitlesPanel {...makeProps({ subtitles: { ...loaded, animation: "word-highlight" } })} />,
    );
    expect(container.querySelectorAll('input[type="color"]')).toHaveLength(4);
  });

  it("reports an accent change", () => {
    const onStyleChange = vi.fn();
    const { container } = renderWithI18n(
      <SubtitlesPanel
        {...makeProps({
          subtitles: { ...loaded, animation: "word-highlight" },
          onStyleChange,
        })}
      />,
    );
    const inputs = container.querySelectorAll('input[type="color"]');
    fireEvent.change(inputs[3], { target: { value: "#00ff00" } });
    expect(onStyleChange).toHaveBeenCalledWith(expect.objectContaining({ accentColor: "#00ff00" }));
  });
});

describe("SubtitlesPanel — undo granularity and errors", () => {
  it("sends slider changes through the live callback and closes the gesture on release", () => {
    const onStyleChange = vi.fn();
    const onStyleChangeLive = vi.fn();
    const onCommit = vi.fn();
    const { container } = renderWithI18n(
      <SubtitlesPanel {...makeProps({ subtitles: loaded, onStyleChange, onStyleChangeLive, onCommit })} />,
    );
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "8" } });
    expect(onStyleChangeLive).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 8 }));
    expect(onStyleChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(onCommit).toHaveBeenCalled();
  });

  it("does the same for colour pickers", () => {
    const onStyleChangeLive = vi.fn();
    const onCommit = vi.fn();
    const { container } = renderWithI18n(
      <SubtitlesPanel {...makeProps({ subtitles: loaded, onStyleChangeLive, onCommit })} />,
    );
    const color = container.querySelector('input[type="color"]') as HTMLInputElement;
    fireEvent.change(color, { target: { value: "#ff0000" } });
    expect(onStyleChangeLive).toHaveBeenCalledWith(expect.objectContaining({ color: "#ff0000" }));
    fireEvent.blur(color);
    expect(onCommit).toHaveBeenCalled();
  });

  it("falls back to the plain callback when no live one is provided", () => {
    const onStyleChange = vi.fn();
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps({ subtitles: loaded, onStyleChange })} />);
    fireEvent.change(container.querySelector('input[type="range"]') as HTMLInputElement, { target: { value: "9" } });
    expect(onStyleChange).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 9 }));
  });

  it("reports a file with no usable cue instead of importing nothing", async () => {
    window.electronAPI.openSubtitleFile = vi
      .fn()
      .mockResolvedValue({ filePath: "/x/empty.srt", content: "not a subtitle file" });
    const onImport = vi.fn();
    const onError = vi.fn();
    renderWithI18n(<SubtitlesPanel {...makeProps({ onImport, onError })} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("empty"));
    expect(onImport).not.toHaveBeenCalled();
  });

  it("reports a file that cannot be read instead of leaving an unhandled rejection", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    window.electronAPI.openSubtitleFile = vi.fn().mockRejectedValue(new Error("EACCES"));
    const onError = vi.fn();
    renderWithI18n(<SubtitlesPanel {...makeProps({ onError })} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("read"));
    log.mockRestore();
  });
});

describe("SubtitlesPanel — fonts", () => {
  it("only offers families that exist on every platform", () => {
    const { container } = renderWithI18n(<SubtitlesPanel {...makeProps({ subtitles: loaded })} />);
    const fonts = Array.from(container.querySelectorAll("select option")).map((o) => o.textContent);
    expect(fonts).toContain("Arial");
    expect(fonts).toContain("sans-serif");
    for (const missing of ["Calibri", "Segoe UI", "Futura", "Century Gothic", "Palatino"])
      expect(fonts).not.toContain(missing);
  });
});

describe("SubtitlesPanel — generated subtitles", () => {
  const generated = [{ id: 7, label: "#1", cues: loaded.cues }];

  it("lists the generated subtitles, to use or delete", () => {
    const onUseGenerated = vi.fn();
    const onDiscardGenerated = vi.fn();
    renderWithI18n(<SubtitlesPanel {...makeProps({ generated, onUseGenerated, onDiscardGenerated })} />);
    expect(screen.getByText(/#1 · 1 subtitles/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(onUseGenerated).toHaveBeenCalledWith(generated[0]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDiscardGenerated).toHaveBeenCalledWith(7);
  });

  it("keeps the list next to the loaded subtitles", () => {
    renderWithI18n(<SubtitlesPanel {...makeProps({ subtitles: loaded, generated })} />);
    expect(screen.getByText("Generated subtitles")).toBeInTheDocument();
  });
});

import "./setup";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import CutEditor from "../components/CutEditor";
import { LangProvider } from "../i18n";

function renderWithI18n(ui: React.ReactElement) {
  return render(<LangProvider>{ui}</LangProvider>);
}

const seg = { id: "seg1", start: 10, end: 30 };

describe("CutEditor", () => {
  it("shows placeholder when no segment is selected", () => {
    renderWithI18n(<CutEditor seg={null} duration={100} onTimeInput={vi.fn()} onDelete={vi.fn()} onSeek={vi.fn()} />);
    expect(screen.getByText(/click a cut zone/i)).toBeTruthy();
  });

  it("renders start and end inputs when a segment is selected", () => {
    renderWithI18n(<CutEditor seg={seg} duration={100} onTimeInput={vi.fn()} onDelete={vi.fn()} onSeek={vi.fn()} />);
    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveValue("0:10.0");
    expect(inputs[1]).toHaveValue("0:30.0");
  });

  it("calls onDelete when delete button is clicked", () => {
    const onDelete = vi.fn();
    renderWithI18n(<CutEditor seg={seg} duration={100} onTimeInput={vi.fn()} onDelete={onDelete} onSeek={vi.fn()} />);
    fireEvent.click(screen.getByText(/delete/i));
    expect(onDelete).toHaveBeenCalledWith("seg1");
  });

  it("calls onSeek with seg.start when start seek button clicked", () => {
    const onSeek = vi.fn();
    renderWithI18n(<CutEditor seg={seg} duration={100} onTimeInput={vi.fn()} onDelete={vi.fn()} onSeek={onSeek} />);
    const seekButtons = screen.getAllByTitle(/jump/i);
    fireEvent.click(seekButtons[0]);
    expect(onSeek).toHaveBeenCalledWith(10);
  });

  it("calls onTimeInput on blur of start input", () => {
    const onTimeInput = vi.fn();
    renderWithI18n(
      <CutEditor seg={seg} duration={100} onTimeInput={onTimeInput} onDelete={vi.fn()} onSeek={vi.fn()} />,
    );
    const [startInput] = screen.getAllByRole("textbox");
    fireEvent.change(startInput, { target: { value: "0:05.0" } });
    fireEvent.blur(startInput);
    expect(onTimeInput).toHaveBeenCalledWith("seg1", "start", "0:05.0");
  });

  it("calls onTimeInput on Enter key in end input", () => {
    const onTimeInput = vi.fn();
    renderWithI18n(
      <CutEditor seg={seg} duration={100} onTimeInput={onTimeInput} onDelete={vi.fn()} onSeek={vi.fn()} />,
    );
    const [, endInput] = screen.getAllByRole("textbox");
    act(() => endInput.focus());
    fireEvent.change(endInput, { target: { value: "0:35.0" } });
    fireEvent.keyDown(endInput, { key: "Enter" });
    expect(onTimeInput).toHaveBeenCalledWith("seg1", "end", "0:35.0");
  });

  it("updates inputs when seg changes", () => {
    const { rerender } = renderWithI18n(
      <CutEditor seg={seg} duration={100} onTimeInput={vi.fn()} onDelete={vi.fn()} onSeek={vi.fn()} />,
    );
    const newSeg = { id: "seg2", start: 50, end: 70 };
    rerender(
      <LangProvider>
        <CutEditor seg={newSeg} duration={100} onTimeInput={vi.fn()} onDelete={vi.fn()} onSeek={vi.fn()} />
      </LangProvider>,
    );
    const inputs = screen.getAllByRole("textbox");
    expect(inputs[0]).toHaveValue("0:50.0");
    expect(inputs[1]).toHaveValue("1:10.0");
  });
});

// ─── Editing lifecycle ───────────────────────────────────────────────────────
// The inputs hold a local draft while focused and only commit on blur or Enter,
// so typing a partial time never rewrites the segment mid-keystroke.

describe("CutEditor editing lifecycle", () => {
  function setup() {
    const onTimeInput = vi.fn();
    const onDelete = vi.fn();
    const onSeek = vi.fn();
    const { container } = renderWithI18n(
      <CutEditor seg={seg} duration={100} onTimeInput={onTimeInput} onDelete={onDelete} onSeek={onSeek} />,
    );
    const [startInput, endInput] = Array.from(container.querySelectorAll(".cut-editor-input")) as HTMLInputElement[];
    return { container, startInput, endInput, onTimeInput, onDelete, onSeek };
  }

  it("seeds the draft from the segment on focus", () => {
    const { startInput } = setup();
    fireEvent.focus(startInput);
    expect(startInput.value).toBe("0:10.0");
  });

  it("keeps the typed draft without committing it", () => {
    const { startInput, onTimeInput } = setup();
    fireEvent.focus(startInput);
    fireEvent.change(startInput, { target: { value: "0:1" } });
    expect(startInput.value).toBe("0:1");
    expect(onTimeInput).not.toHaveBeenCalled();
  });

  it("commits the start on blur", () => {
    const { startInput, onTimeInput } = setup();
    fireEvent.focus(startInput);
    fireEvent.change(startInput, { target: { value: "0:12.5" } });
    fireEvent.blur(startInput);
    expect(onTimeInput).toHaveBeenCalledWith("seg1", "start", "0:12.5");
  });

  it("commits the start on Enter", () => {
    const { startInput, onTimeInput } = setup();
    act(() => startInput.focus());
    fireEvent.change(startInput, { target: { value: "0:14.0" } });
    fireEvent.keyDown(startInput, { key: "Enter" });
    expect(onTimeInput).toHaveBeenCalledWith("seg1", "start", "0:14.0");
  });

  // Enter used to commit and then blur, which committed a second time: two undo
  // steps for one edit.
  it("commits exactly once on Enter", () => {
    const { startInput, onTimeInput } = setup();
    act(() => startInput.focus());
    fireEvent.change(startInput, { target: { value: "0:14.0" } });
    fireEvent.keyDown(startInput, { key: "Enter" });
    expect(onTimeInput).toHaveBeenCalledTimes(1);
  });

  // Focusing a field and leaving it hands back the display text, rounded to a
  // tenth: committing that would nudge the boundary and add an undo step.
  it("does not commit when the field was only focused and left", () => {
    const { startInput, endInput, onTimeInput } = setup();
    act(() => startInput.focus());
    act(() => startInput.blur());
    act(() => endInput.focus());
    act(() => endInput.blur());
    expect(onTimeInput).not.toHaveBeenCalled();
  });

  it("ignores other keys", () => {
    const { startInput, onTimeInput } = setup();
    fireEvent.focus(startInput);
    fireEvent.keyDown(startInput, { key: "a" });
    expect(onTimeInput).not.toHaveBeenCalled();
  });

  it("commits the end on blur", () => {
    const { endInput, onTimeInput } = setup();
    fireEvent.focus(endInput);
    fireEvent.change(endInput, { target: { value: "0:35.0" } });
    fireEvent.blur(endInput);
    expect(onTimeInput).toHaveBeenCalledWith("seg1", "end", "0:35.0");
  });

  it("commits the end on Enter", () => {
    const { endInput, onTimeInput } = setup();
    act(() => endInput.focus());
    fireEvent.change(endInput, { target: { value: "0:40.0" } });
    fireEvent.keyDown(endInput, { key: "Enter" });
    expect(onTimeInput).toHaveBeenCalledWith("seg1", "end", "0:40.0");
  });

  it("returns to the segment value after committing", () => {
    const { startInput } = setup();
    fireEvent.focus(startInput);
    fireEvent.change(startInput, { target: { value: "garbage" } });
    fireEvent.blur(startInput);
    expect(startInput.value).toBe("0:10.0");
  });

  it("jumps to the start and end of the cut", () => {
    const { container, onSeek } = setup();
    const buttons = container.querySelectorAll(".cut-editor-seek");
    fireEvent.click(buttons[0]);
    expect(onSeek).toHaveBeenCalledWith(10);
    fireEvent.click(buttons[1]);
    expect(onSeek).toHaveBeenCalledWith(30);
  });

  it("shows the cut duration", () => {
    const { container } = setup();
    expect(container.querySelector(".cut-editor-dur")?.textContent).toBe("(0:20.0)");
  });

  it("deletes the selected cut", () => {
    const { container, onDelete } = setup();
    fireEvent.click(container.querySelector(".cut-editor-delete")!);
    expect(onDelete).toHaveBeenCalledWith("seg1");
  });
});

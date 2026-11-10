import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CueEditor, { cueTime } from "./CueEditor";

const cues = [
  { id: 1, start: 1, end: 2.5, text: "Hello" },
  { id: 2, start: 3, end: 4, text: "World" },
];

describe("CueEditor", () => {
  it("formats times like an SRT file", () => {
    expect(cueTime(3723.5)).toBe("01:02:03,500");
  });

  it("applies the corrected texts, once something changed", () => {
    const onApply = vi.fn();
    render(<CueEditor cues={cues} onApply={onApply} onCancel={vi.fn()} />);
    const apply = screen.getByRole("button", { name: "Apply changes" });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Text of subtitle 2"), { target: { value: "Monde" } });
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith(["Hello", "Monde"]);
  });

  it("asks before removing an emptied subtitle", () => {
    const onApply = vi.fn();
    render(<CueEditor cues={cues} onApply={onApply} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Text of subtitle 1"), { target: { value: "  " } });
    expect(screen.getByRole("alert")).toHaveTextContent("1 empty subtitle");
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove and apply" }));
    expect(onApply).toHaveBeenCalledWith(["  ", "World"]);
  });

  it("can be discarded", () => {
    const onCancel = vi.fn();
    render(<CueEditor cues={cues} onApply={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

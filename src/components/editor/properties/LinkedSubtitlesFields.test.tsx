import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinkedSubtitlesFields } from "./LinkedSubtitlesFields";

const subtitles = {
  enabled: true,
  cues: [
    { start: 0, end: 1, text: "One" },
    { start: 1, end: 2, text: "Two" },
  ],
  font_size: 2.7,
  color: "white",
  position: "bottom",
};

describe("LinkedSubtitlesFields", () => {
  it("switches the subtitle on the scene", () => {
    const onChange = vi.fn();
    render(<LinkedSubtitlesFields subtitles={subtitles} onChange={onChange} onEditCues={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Show on the scene"));
    expect(onChange).toHaveBeenCalledWith({ ...subtitles, enabled: false });
  });

  it("sends the corrected texts, without the emptied ones", () => {
    const onEditCues = vi.fn();
    render(<LinkedSubtitlesFields subtitles={subtitles} onChange={vi.fn()} onEditCues={onEditCues} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit subtitles" }));
    fireEvent.change(screen.getByLabelText("Text of subtitle 1"), { target: { value: "Uno" } });
    fireEvent.change(screen.getByLabelText("Text of subtitle 2"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove and apply" }));
    expect(onEditCues).toHaveBeenCalledWith([{ start: 0, end: 1, text: "Uno" }]);
  });
});

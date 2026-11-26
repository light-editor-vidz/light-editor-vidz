import "./setup";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SilenceDialog from "../components/SilenceDialog";
import { LangProvider } from "../i18n";

const api = () => window.electronAPI as unknown as Record<string, ReturnType<typeof vi.fn>>;

function open(onApply = vi.fn()) {
  render(
    <LangProvider lang="en">
      <SilenceDialog videoPath="/v/a.mp4" duration={10} cues={[]} onApply={onApply} onClose={vi.fn()} />
    </LangProvider>,
  );
  return onApply;
}

describe("SilenceDialog", () => {
  it("analyses, then hands over the cuts with their margins", async () => {
    api().detectSilences = vi.fn().mockResolvedValue([{ start: 2, end: 5 }]);
    const onApply = open();
    expect(screen.getByRole("button", { name: "Add the cuts" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    expect(await screen.findByText("1 cut, 2.7 s removed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add the cuts" }));

    expect(api().detectSilences).toHaveBeenCalledWith("/v/a.mp4", -35, 0.6);
    const [[cuts]] = onApply.mock.calls;
    expect(cuts[0].start).toBeCloseTo(2.15);
    expect(cuts[0].end).toBeCloseTo(4.85);
    // Without generated subtitles there are no sentences to follow.
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("asks for a new analysis when the threshold changes", async () => {
    api().detectSilences = vi.fn().mockResolvedValue([{ start: 2, end: 5 }]);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    await screen.findByText("1 cut, 2.7 s removed");

    fireEvent.change(screen.getByRole("slider", { name: /Silence below/ }), { target: { value: "-45" } });

    expect(screen.getByRole("button", { name: "Add the cuts" })).toBeDisabled();
  });

  it("says when the video has no sound", async () => {
    api().detectSilences = vi.fn().mockResolvedValue(null);
    open();

    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));

    expect(await screen.findByText("This video has no audio track.")).toBeInTheDocument();
  });
});

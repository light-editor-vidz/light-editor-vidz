import "./setup";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import SequencesModal from "../components/SequencesModal";
import { LangProvider } from "../i18n";
import { drop } from "./dndCapture";

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  const { dnd } = await import("./dndCapture");
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      dnd.onDragEnd = props.onDragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});

const SCENES = [
  { start: 0, end: 4 },
  { start: 4, end: 9 },
  { start: 9, end: 12 },
];

function setup(detect: () => Promise<{ start: number; end: number }[]> = async () => SCENES) {
  const detectScenes = vi.fn(detect);
  window.electronAPI = { ...window.electronAPI, detectScenes, cancelFfmpeg: vi.fn(async () => {}) };
  const onCancel = vi.fn();
  const onApply = vi.fn();
  render(
    <LangProvider lang="en">
      <SequencesModal videoUrl="url:/v/a.mp4" videoPath="/v/a.mp4" onCancel={onCancel} onApply={onApply} />
    </LangProvider>,
  );
  return { detectScenes, onCancel, onApply };
}

const names = () => screen.getAllByText(/^Sequence \d+$/).map((n) => n.textContent);

beforeEach(() => vi.clearAllMocks());

describe("SequencesModal", () => {
  it("shows the whole video, then one row per detected sequence", async () => {
    const { detectScenes } = setup();
    expect(screen.getByRole("status")).toHaveTextContent("Detecting scenes…");
    await screen.findByText("Sequence 1");

    expect(detectScenes).toHaveBeenCalledWith("/v/a.mp4");
    expect(document.querySelector("video")).toHaveAttribute("src", "url:/v/a.mp4");
    expect(names()).toEqual(["Sequence 1", "Sequence 2", "Sequence 3"]);
    expect(screen.getByText("3 selected · 0:12")).toBeInTheDocument();
  });

  it("unticking a sequence removes it from the selection and the merge", async () => {
    const { onApply } = setup();
    await screen.findByText("Sequence 1");
    const row = screen.getByText("Sequence 2").closest("li")!;
    fireEvent.click(within(row).getByRole("checkbox"));

    expect(names()).toEqual(["Sequence 1", "Sequence 2", "Sequence 3"]);
    expect(screen.getByText("2 selected · 0:07")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(onApply).toHaveBeenCalledWith([
      { start: 0, end: 4 },
      { start: 9, end: 12 },
    ]);
  });

  it("reorders by drag and drop and hands them over in the new order", async () => {
    const { onApply } = setup();
    await screen.findByText("Sequence 1");
    act(() => drop(2, 1)); // Sequence 3 dropped on Sequence 2
    expect(names()).toEqual(["Sequence 1", "Sequence 3", "Sequence 2"]);

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(onApply).toHaveBeenCalledWith([
      { start: 0, end: 4 },
      { start: 9, end: 12 },
      { start: 4, end: 9 },
    ]);
  });

  it("cannot merge when no sequence is selected", async () => {
    setup();
    await screen.findByText("Sequence 1");
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);

    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(screen.getByText(/No sequence selected/)).toBeInTheDocument();
  });

  it("plays the selected sequences in order, skipping the unselected ones", async () => {
    setup();
    await screen.findByText("Sequence 1");
    fireEvent.click(within(screen.getByText("Sequence 2").closest("li")!).getByRole("checkbox"));
    const video = document.querySelector("video")!;
    video.play = vi.fn(async () => {});
    video.pause = vi.fn();

    // The preview starts on the render: first selected sequence.
    expect(video.currentTime).toBe(0);
    video.currentTime = 4; // end of sequence 1
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBe(9); // jumps over the unselected sequence 2
  });

  it("clicking a card plays that sequence from its start", async () => {
    setup();
    await screen.findByText("Sequence 2");
    const video = document.querySelector("video")!;
    const play = vi.fn(async () => {});
    video.play = play;
    const row = screen.getByText("Sequence 2").closest("li")!;
    fireEvent.click(row);

    expect(video.currentTime).toBe(4);
    expect(play).toHaveBeenCalled();
  });

  describe("loop", () => {
    async function looped(name: string) {
      setup();
      await screen.findByText(name);
      const video = document.querySelector("video")!;
      video.play = vi.fn(async () => {});
      video.pause = vi.fn();
      const row = screen.getByText(name).closest("li")!;
      fireEvent.click(row);
      return { video, row };
    }

    it("every thumbnail carries a play icon", async () => {
      setup();
      await screen.findByText("Sequence 1");
      expect(document.querySelectorAll(".seq-play-badge")).toHaveLength(3);
    });

    it("clicking a thumbnail loops its sequence in the preview", async () => {
      const { video, row } = await looped("Sequence 2");
      expect(row).toHaveClass("is-looping");
      expect(video.currentTime).toBe(4);

      video.currentTime = 9; // end of the sequence
      fireEvent.timeUpdate(video);
      expect(video.currentTime).toBe(4); // back to its start…
      expect(video.pause).not.toHaveBeenCalled(); // …without stopping
    });

    it("the player's play button leaves the loop and goes on with the whole result", async () => {
      const { video, row } = await looped("Sequence 3");
      fireEvent.click(screen.getByRole("button", { name: "Play the result" }));
      expect(row).not.toHaveClass("is-looping");

      video.currentTime = 12;
      fireEvent.timeUpdate(video);
      expect(video.pause).toHaveBeenCalled(); // the result ends: no more looping
      expect(video.currentTime).toBe(0);
    });

    it("the seek bar leaves the loop and jumps in the result", async () => {
      const { video, row } = await looped("Sequence 3");
      fireEvent.change(screen.getByRole("slider", { name: "Position in the result" }), { target: { value: "5" } });

      expect(row).not.toHaveClass("is-looping");
      expect(video.currentTime).toBe(5); // 1s into sequence 2 (4–9)
    });
  });

  it("shows a thumbnail taken in the middle of each sequence, once ready", async () => {
    const videoFrames = vi.fn(async (_path: string, times: number[]) =>
      times.map((t) => `data:image/jpeg;base64,F${t}`),
    );
    window.electronAPI = { ...window.electronAPI, videoFrames };
    setup();
    await screen.findByText("Sequence 1");
    await act(async () => {});

    expect(videoFrames).toHaveBeenCalledWith("/v/a.mp4", [2, 6.5, 10.5]);
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("img.seq-thumb"));
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      "data:image/jpeg;base64,F2",
      "data:image/jpeg;base64,F6.5",
      "data:image/jpeg;base64,F10.5",
    ]);
  });

  it("keeps the placeholder when a thumbnail is unavailable", async () => {
    window.electronAPI = { ...window.electronAPI, videoFrames: async () => ["", "", ""] };
    setup();
    await screen.findByText("Sequence 1");
    await act(async () => {});

    expect(document.querySelectorAll("img.seq-thumb")).toHaveLength(0);
    expect(document.querySelectorAll(".seq-thumb-empty")).toHaveLength(3);
  });

  it("reports a detection failure", async () => {
    setup(async () => {
      throw new Error("boom");
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not detect the scenes");
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("cancelling during detection stops ffmpeg and closes", async () => {
    const { onCancel } = setup(() => new Promise(() => {}));
    fireEvent.click(screen.getByText("Cancel"));

    expect(window.electronAPI.cancelFfmpeg).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("falls back to local streaming when the player refuses the video", async () => {
    setup();
    await screen.findByText("Sequence 1");
    await act(async () => {
      fireEvent.error(document.querySelector("video")!);
    });
    expect(document.querySelector("video")).toHaveAttribute("src", "stream:url:/v/a.mp4");
  });
});

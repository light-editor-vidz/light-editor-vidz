import { describe, expect, it } from "vitest";
import { engineErrorText } from "../engineError";
import { translations } from "../i18n";

describe("engineErrorText", () => {
  const fr = translations.fr;

  it("translates the engine's English sentences", () => {
    expect(engineErrorText("Stabilization is not available in this build of ffmpeg", fr)).toBe(
      fr.export_error_stabilization,
    );
    expect(engineErrorText("Nothing to export: every part of the video has been cut.", fr)).toBe(fr.export_nothing);
    expect(engineErrorText("the output file must differ from the source video", fr)).toBe(fr.export_error_same_file);
    expect(engineErrorText("output is the same file as the input", fr)).toBe(fr.export_error_same_file);
    expect(engineErrorText("Invalid export options: format", fr)).toBe(fr.export_error_invalid);
    expect(engineErrorText("The file has no video stream", fr)).toBe(fr.export_error_no_video);
    expect(engineErrorText("cancelled", fr)).toBe(fr.export_cancelled);
    expect(engineErrorText("Another queued export already writes to that file", fr)).toBe(
      fr.export_error_queue_conflict,
    );
    expect(engineErrorText("No sequence to merge", fr)).toBe(fr.export_error_no_sequence);
    expect(engineErrorText("Too many sequences", fr)).toBe(fr.export_error_too_many_sequences);
    expect(engineErrorText("Failed to launch ffmpeg: not found", fr)).toBe(fr.export_error_ffmpeg_missing);
    expect(engineErrorText("Cannot write the subtitles: disk full", fr)).toBe(fr.export_error_write_temp);
  });

  it("strips the IPC prefix and keeps what it does not know (ffmpeg's own message)", () => {
    expect(engineErrorText("Error invoking remote method 'x': Error: [h264] bad thing", fr)).toBe("[h264] bad thing");
  });
});

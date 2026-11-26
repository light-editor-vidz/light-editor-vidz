import { render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeliveryCheck from "../components/DeliveryCheck";
import { checkDelivery, platformOf, PLATFORMS } from "./platforms";
import type { DeliveryReport } from "./deliveryCheck";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const good: DeliveryReport = {
  duration: 45,
  size_bytes: 20_000_000,
  width: 1080,
  height: 1920,
  fps: 30,
  video_codec: "h264",
  hdr: false,
  has_audio: true,
  loudness: -14.4,
  true_peak: -1.2,
};
const tiktok = platformOf("tiktok")!;
const failed = (file: Parameters<typeof checkDelivery>[1]) =>
  checkDelivery(tiktok, file)
    .filter((i) => !i.ok)
    .map((i) => i.id);

describe("contrôle avant publication", () => {
  it("accepte un fichier conforme", () => {
    expect(failed({ ...good, ratio: 1080 / 1920 })).toEqual([]);
  });

  it("signale chaque écart", () => {
    const bad = {
      ...good,
      duration: 700,
      ratio: 16 / 9,
      height: 720,
      fps: 90,
      video_codec: "vp9",
      size_bytes: 5 * 1024 ** 3,
      hdr: true,
      loudness: -22,
      true_peak: 0.4,
    };
    expect(failed(bad)).toEqual([
      "duration",
      "aspect",
      "height",
      "fps",
      "codec",
      "size",
      "hdr",
      "loudness",
      "truePeak",
    ]);
  });

  it("donne la taille d'un petit fichier en MiB, d'un gros en GiB", () => {
    const size = (size_bytes: number) => checkDelivery(tiktok, { size_bytes })[0].value;
    expect([size(2 * 1024 ** 2), size(3 * 1024 ** 3)]).toEqual(["2.0 MiB", "3.00 GiB"]);
  });

  it("signale un fichier sans son, et un silence", () => {
    expect(failed({ has_audio: false })).toEqual(["audio"]);
    expect(failed({ has_audio: true, loudness: null })).toEqual(["loudness"]);
  });

  it("ne juge que ce qu'il sait", () => {
    expect(checkDelivery(tiktok, { duration: 10 }).map((i) => i.id)).toEqual(["duration"]);
  });

  it("a pour chaque plateforme un préréglage qu'elle accepte", () => {
    for (const p of PLATFORMS) {
      expect(p.aspects as readonly string[]).toContain(p.preset.aspect);
    }
  });
});

describe("DeliveryCheck", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("relit le fichier et liste ce qui est à vérifier", async () => {
    vi.mocked(invoke).mockResolvedValue({ ...good, loudness: -23 });

    render(<DeliveryCheck platform="tiktok" path="/out/a.mp4" />);

    expect(await screen.findByText("TikTok: 1 point to check")).toBeInTheDocument();
    expect(screen.getByText(/Loudness: -23.0 LUFS \(expected -14 ±2 LUFS\)/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("inspect_export", { path: "/out/a.mp4" });
  });

  it("dit quand le fichier ne peut pas être relu", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("gone"));
    render(<DeliveryCheck platform="reels" path="/out/b.mp4" />);
    expect(await screen.findByText("The file could not be checked.")).toBeInTheDocument();
  });
});

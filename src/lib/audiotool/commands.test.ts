import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { audioPickOutput } from "./commands";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("audioPickOutput", () => {
  it("returns the chosen path without asking when the dialog already confirmed it", async () => {
    vi.mocked(invoke).mockResolvedValue({ path: "/o/a.wav", confirm_overwrite: false });
    expect(await audioPickOutput("/o/a", "wav")).toBe("/o/a.wav");
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks before overwriting a file whose extension was completed after the dialog", async () => {
    vi.mocked(invoke).mockResolvedValue({ path: "/o/a.wav", confirm_overwrite: true });
    vi.mocked(ask).mockResolvedValueOnce(false);
    expect(await audioPickOutput("/o/a", "wav")).toBeNull();
    vi.mocked(ask).mockResolvedValueOnce(true);
    expect(await audioPickOutput("/o/a", "wav")).toBe("/o/a.wav");
  });

  it("returns null when the dialog is cancelled", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    expect(await audioPickOutput("/o/a", "wav")).toBeNull();
  });
});

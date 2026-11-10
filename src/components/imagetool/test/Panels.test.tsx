import "./setup";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ExifPanel } from "../ExifPanel";
import { HistoryPanel } from "../HistoryPanel";
import type { ExifField } from "../lib/tauri";
import type { HistoryEntry } from "../types";
import i18n from "i18next";

const fields: ExifField[] = [
  { tag: "Make", value: "Canon" },
  { tag: "Model", value: "EOS R6" },
] as ExifField[];

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("ExifPanel — states", () => {
  it("shows a loading message", () => {
    render(<ExifPanel tabId="t1" fields={[]} isLoading onStrip={vi.fn()} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("says when there is no EXIF data", () => {
    render(<ExifPanel tabId="t1" fields={[]} isLoading={false} onStrip={vi.fn()} />);
    expect(screen.getByText("No EXIF data")).toBeInTheDocument();
  });

  it("lists every field", () => {
    render(<ExifPanel tabId="t1" fields={fields} isLoading={false} onStrip={vi.fn()} />);
    expect(screen.getByText("Make")).toBeInTheDocument();
    expect(screen.getByText("Canon")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
  });
});

describe("ExifPanel — read-only list", () => {
  it("offers no per-field removal: stripping removes everything", () => {
    render(<ExifPanel tabId="t1" fields={fields} isLoading={false} onStrip={vi.fn()} />);

    expect(screen.queryByTitle("Mark for removal")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide all" })).toBeNull();
  });

  it("lists a tag twice if the file does (no duplicate-key collapse)", () => {
    const dup = [
      { tag: "Make", value: "A" },
      { tag: "Make", value: "B" },
    ] as ExifField[];
    render(<ExifPanel tabId="t1" fields={dup} isLoading={false} onStrip={vi.fn()} />);

    expect(screen.getAllByText("Make")).toHaveLength(2);
  });
});

describe("ExifPanel — stripping", () => {
  it("runs the strip and shows a busy label meanwhile", async () => {
    let release: () => void = () => {};
    const onStrip = vi.fn(
      () =>
        new Promise<void>((res) => {
          release = res;
        }),
    );
    render(<ExifPanel tabId="t1" fields={fields} isLoading={false} onStrip={onStrip} />);

    fireEvent.click(screen.getByRole("button", { name: "Save without EXIF…" }));

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save without EXIF…" })).toBeEnabled());
    expect(onStrip).toHaveBeenCalledTimes(1);
  });

  it("re-enables the button even when stripping fails", async () => {
    const onStrip = vi.fn().mockRejectedValue(new Error("write failed"));
    render(<ExifPanel tabId="t1" fields={fields} isLoading={false} onStrip={onStrip} />);

    fireEvent.click(screen.getByRole("button", { name: "Save without EXIF…" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save without EXIF…" })).toBeEnabled());
  });

  it("cannot strip without an open tab", async () => {
    const onStrip = vi.fn();
    render(<ExifPanel tabId={null} fields={fields} isLoading={false} onStrip={onStrip} />);

    const button = screen.getByRole("button", { name: "Save without EXIF…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(onStrip).not.toHaveBeenCalled();
  });
});

describe("HistoryPanel", () => {
  const history: HistoryEntry[] = [
    { key: "hist.open" },
    { key: "hist.crop", params: { w: "100", h: "100" } },
    { key: "hist.rotate", params: { deg: "+90" } },
  ];

  function setup(props: Partial<Parameters<typeof HistoryPanel>[0]> = {}) {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <HistoryPanel
        history={history}
        currentIndex={1}
        canUndo
        canRedo
        onUndo={onUndo}
        onRedo={onRedo}
        isLoading={false}
        {...props}
      />,
    );
    return { onUndo, onRedo };
  }

  it("says when nothing has happened yet", () => {
    setup({ history: [] });
    expect(screen.getByText("No actions yet")).toBeInTheDocument();
  });

  it("lists each action", () => {
    setup();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Crop 100×100")).toBeInTheDocument();
    expect(screen.getByText("Rotate +90°")).toBeInTheDocument();
  });

  it("highlights the current step and dims the redo-able ones", () => {
    setup({ currentIndex: 1 });
    expect(screen.getByText("Crop 100×100").closest("button")?.className).toContain("bg-indigo-900/60");
    expect(screen.getByText("Rotate +90°").closest("button")?.className).toContain("text-slate-600");
  });

  it("translates the entries in the active language", async () => {
    await i18n.changeLanguage("fr");
    try {
      render(
        <HistoryPanel
          history={history}
          currentIndex={0}
          canUndo={false}
          canRedo
          onUndo={vi.fn()}
          onRedo={vi.fn()}
          isLoading={false}
        />,
      );

      expect(screen.getByText("Ouverture")).toBeInTheDocument();
      expect(screen.getByText("Recadrage 100×100")).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("jumps to a step when it is clicked", async () => {
    const onJump = vi.fn();
    setup({ onJump, currentIndex: 1 });

    await userEvent.click(screen.getByText("Rotate +90°"));
    await userEvent.click(screen.getByText("Open"));

    expect(onJump).toHaveBeenNthCalledWith(1, 2);
    expect(onJump).toHaveBeenNthCalledWith(2, 0);
  });

  it("does not jump to the step it is already on", async () => {
    const onJump = vi.fn();
    setup({ onJump, currentIndex: 1 });

    await userEvent.click(screen.getByText("Crop 100×100"));

    expect(onJump).not.toHaveBeenCalled();
  });

  it("undoes and redoes", async () => {
    const { onUndo, onRedo } = setup();

    await userEvent.click(screen.getByLabelText("Undo"));
    await userEvent.click(screen.getByLabelText("Redo"));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("disables undo and redo when they are unavailable", () => {
    setup({ canUndo: false, canRedo: false });
    expect(screen.getByLabelText("Undo")).toBeDisabled();
    expect(screen.getByLabelText("Redo")).toBeDisabled();
  });

  it("disables both while an operation is running", () => {
    setup({ isLoading: true });
    expect(screen.getByLabelText("Undo")).toBeDisabled();
    expect(screen.getByLabelText("Redo")).toBeDisabled();
  });
});

import "./setup";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import QueueManager, { SHOW_QUEUE_EVENT } from "../components/QueueManager";
import { LangProvider } from "../i18n";
import type { QueueJob } from "../api";

const job = (over: Partial<QueueJob> = {}): QueueJob => ({
  id: 1,
  name: "clip.mp4",
  format: "mp4",
  status: "queued",
  progress: 0,
  outputPath: "/out/clip.mp4",
  error: null,
  ...over,
});

let push: ((jobs: QueueJob[]) => void) | null = null;
function setup(initial: QueueJob[] = []) {
  push = null;
  window.electronAPI = {
    ...window.electronAPI,
    queueList: vi.fn().mockResolvedValue(initial),
    onQueueUpdate: vi.fn((cb: (j: QueueJob[]) => void) => {
      push = cb;
      return () => {};
    }),
    queueCancel: vi.fn().mockResolvedValue(true),
    queueReveal: vi.fn().mockResolvedValue(undefined),
    queueClearFinished: vi.fn().mockResolvedValue(undefined),
  };
  return render(
    <LangProvider>
      <QueueManager />
    </LangProvider>,
  );
}
const update = (jobs: QueueJob[]) =>
  act(() => {
    push!(jobs);
  });
const pill = (c: HTMLElement) => c.querySelector(".queue-pill") as HTMLElement;

describe("QueueManager — the pill", () => {
  beforeEach(() => {
    window.localStorage?.clear?.();
  });

  it("renders nothing while there is no job", async () => {
    const { container } = setup([]);
    await waitFor(() => expect(window.electronAPI.queueList).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("appears as soon as the main process reports a job", async () => {
    const { container } = setup([]);
    update([job({ status: "running", progress: 30 })]);
    expect(pill(container).textContent).toMatch(/30%/);
    expect(pill(container).className).toContain("busy");
  });

  it("shows jobs that were already queued when the page loaded", async () => {
    const { container } = setup([job({ status: "queued" })]);
    await waitFor(() => expect(pill(container)).toBeTruthy());
  });

  it("counts the active jobs and the ones waiting", async () => {
    const { container } = setup([]);
    update([
      job({ id: 1, status: "running", progress: 10 }),
      job({ id: 2, status: "queued" }),
      job({ id: 3, status: "queued" }),
    ]);
    expect(pill(container).textContent).toMatch(/3/);
    expect(pill(container).textContent).toMatch(/2 (waiting|en attente)/);
  });

  it("says exports finished when nothing is left to do", async () => {
    const { container } = setup([]);
    update([job({ status: "done", progress: 100 })]);
    expect(pill(container).className).toContain("idle");
    expect(pill(container).textContent).toMatch(/finished|terminés/i);
  });

  it("turns red when a job failed", async () => {
    const { container } = setup([]);
    update([job({ status: "error", error: "boom" })]);
    expect(pill(container).className).toContain("failed");
  });

  it("disappears again once finished jobs are cleared", async () => {
    const { container } = setup([]);
    update([job({ status: "done" })]);
    update([]);
    expect(container.firstChild).toBeNull();
  });
});

describe("QueueManager — the window", () => {
  const open = async (jobs: QueueJob[]) => {
    const view = setup([]);
    await act(async () => {}); // let the initial snapshot settle first
    update(jobs);
    fireEvent.click(pill(view.container));
    await screen.findByRole("dialog");
    return view;
  };

  it("opens from the pill and from the app-wide event", async () => {
    const { container } = setup([]);
    update([job()]);
    act(() => {
      window.dispatchEvent(new Event(SHOW_QUEUE_EVENT));
    });
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(container.querySelector(".queue-modal")).toBeTruthy();
  });

  it("lists every job with its name, format and status", async () => {
    const { container } = await open([
      job({ id: 1, name: "a.mp4", status: "running", progress: 40 }),
      job({ id: 2, name: "b.gif", format: "gif", status: "queued" }),
      job({ id: 3, name: "c.webm", format: "webm", status: "done", progress: 100 }),
    ]);
    const rows = container.querySelectorAll(".queue-job");
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain("b.gif");
    expect(rows[1].textContent).toContain("GIF");
    expect(rows[0].className).toContain("status-running");
    expect(rows[2].className).toContain("status-done");
  });

  it("draws a progress bar for running and waiting jobs only", async () => {
    const { container } = await open([
      job({ id: 1, status: "running", progress: 55 }),
      job({ id: 2, status: "done", progress: 100 }),
    ]);
    const bars = container.querySelectorAll('[role="progressbar"]');
    expect(bars).toHaveLength(1);
    expect(bars[0].getAttribute("aria-valuenow")).toBe("55");
    expect((bars[0].firstElementChild as HTMLElement).style.width).toBe("55%");
  });

  it("cancels a waiting or running job", async () => {
    await open([job({ id: 7, status: "running", progress: 5 })]);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$|^annuler$/i }));
    expect(window.electronAPI.queueCancel).toHaveBeenCalledWith(7);
  });

  it("offers no cancel for a finished job, but shows it in the folder", async () => {
    await open([job({ id: 9, status: "done", progress: 100 })]);
    expect(screen.queryByRole("button", { name: /^cancel$|^annuler$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show in folder|afficher dans le dossier/i }));
    expect(window.electronAPI.queueReveal).toHaveBeenCalledWith(9);
  });

  it("shows why a job failed, as selectable text", async () => {
    const { container } = await open([job({ status: "error", error: "Invalid argument" })]);
    expect(container.querySelector(".queue-error")?.textContent).toBe("Invalid argument");
  });

  it("clears finished jobs, but not while everything is still active", async () => {
    await open([job({ id: 1, status: "running" })]);
    expect(screen.getByRole("button", { name: /clear finished|effacer les terminés/i })).toBeDisabled();
    act(() => {
      push!([job({ id: 1, status: "done", progress: 100 })]);
    });
    fireEvent.click(screen.getByRole("button", { name: /clear finished|effacer les terminés/i }));
    expect(window.electronAPI.queueClearFinished).toHaveBeenCalled();
  });

  it.each([
    ["the close button", () => fireEvent.click(screen.getAllByRole("button", { name: /^close$|^fermer$/i })[0])],
    ["Escape", () => fireEvent.keyDown(window, { key: "Escape" })],
    ["the backdrop", () => fireEvent.click(document.querySelector(".queue-backdrop")!)],
  ])("closes with %s", async (_n, close) => {
    await open([job()]);
    act(() => {
      close();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps updating while open", async () => {
    const { container } = await open([job({ id: 1, status: "running", progress: 10 })]);
    update([job({ id: 1, status: "running", progress: 80 })]);
    expect((container.querySelector(".queue-fill") as HTMLElement).style.width).toBe("80%");
  });
});

describe("QueueManager — ordering of the initial snapshot and pushed updates", () => {
  it("does not let a late snapshot overwrite a newer pushed update", async () => {
    let resolveList: (j: QueueJob[]) => void = () => {};
    window.electronAPI = {
      ...window.electronAPI,
      queueList: vi.fn(
        () =>
          new Promise<QueueJob[]>((res) => {
            resolveList = res;
          }),
      ),
      onQueueUpdate: vi.fn((cb: (j: QueueJob[]) => void) => {
        push = cb;
        return () => {};
      }),
    };
    const { container } = render(
      <LangProvider>
        <QueueManager />
      </LangProvider>,
    );
    update([job({ id: 5, status: "running", progress: 60 })]);
    await act(async () => {
      resolveList([]);
    }); // the stale answer arrives last
    expect(pill(container).textContent).toMatch(/60%/);
  });

  it("stops listening when unmounted", () => {
    const off = vi.fn();
    window.electronAPI = {
      ...window.electronAPI,
      queueList: vi.fn().mockResolvedValue([]),
      onQueueUpdate: vi.fn(() => off),
    };
    render(
      <LangProvider>
        <QueueManager />
      </LangProvider>,
    ).unmount();
    expect(off).toHaveBeenCalled();
  });
});

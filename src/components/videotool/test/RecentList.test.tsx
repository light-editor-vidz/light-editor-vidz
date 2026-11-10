import "./setup";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RecentList from "../components/RecentList";
import DropZone from "../components/DropZone";
import { LangProvider } from "../i18n";
import type { RecentEntry } from "../api";

const entry = (n: number): RecentEntry => ({
  kind: "video",
  path: `/home/u/dir${n}/file${n}.mp4`,
  name: `file${n}.mp4`,
  dir: `/home/u/dir${n}`,
  openedAt: n,
});
const handlers = () => ({ onOpen: vi.fn(), onRemove: vi.fn(), onClear: vi.fn() });
const r = (items: RecentEntry[], h = handlers()) => ({
  h,
  ...render(
    <LangProvider>
      <RecentList items={items} {...h} />
    </LangProvider>,
  ),
});

describe("RecentList", () => {
  it("renders nothing when the list is empty", () => {
    expect(r([]).container.firstChild).toBeNull();
  });
  it("shows name and folder of each entry", () => {
    const { container } = r([entry(1), entry(2)]);
    const items = container.querySelectorAll(".recent-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("file1.mp4");
    expect(items[0].textContent).toContain("/home/u/dir1");
  });
  it("shows the extension of each video", () => {
    const { container } = r([entry(1)]);
    expect(container.querySelector(".recent-kind")?.textContent).toBe("MP4");
  });
  it("shows at most five", () => {
    expect(r(Array.from({ length: 9 }, (_, i) => entry(i))).container.querySelectorAll(".recent-item")).toHaveLength(5);
  });
  it("opens the clicked entry", () => {
    const { h, container } = r([entry(1), entry(2)]);
    fireEvent.click(container.querySelectorAll(".recent-open")[1]);
    expect(h.onOpen).toHaveBeenCalledWith(entry(2).path);
  });
  it("gives the full path as a tooltip", () => {
    const { container } = r([entry(1)]);
    expect(container.querySelector(".recent-open")?.getAttribute("title")).toBe(entry(1).path);
  });
  it("removes one entry", () => {
    const { h } = r([entry(1)]);
    fireEvent.click(screen.getByRole("button", { name: /remove from the list|retirer de la liste/i }));
    expect(h.onRemove).toHaveBeenCalledWith(entry(1).path);
  });
  it("clears the list", () => {
    const { h } = r([entry(1)]);
    fireEvent.click(screen.getByRole("button", { name: /^clear$|^effacer$/i }));
    expect(h.onClear).toHaveBeenCalled();
  });
});

describe("DropZone with recent files", () => {
  it("shows the list on the home screen and forwards the actions", () => {
    const onOpenRecent = vi.fn();
    const onRemoveRecent = vi.fn();
    const onClearRecent = vi.fn();
    const { container } = render(
      <LangProvider>
        <DropZone
          onDrop={vi.fn()}
          onOpen={vi.fn()}
          recent={[entry(1)]}
          onOpenRecent={onOpenRecent}
          onRemoveRecent={onRemoveRecent}
          onClearRecent={onClearRecent}
        />
      </LangProvider>,
    );
    fireEvent.click(container.querySelector(".recent-open")!);
    fireEvent.click(container.querySelector(".recent-remove")!);
    fireEvent.click(container.querySelector(".recent-clear")!);
    expect(onOpenRecent).toHaveBeenCalledWith(entry(1).path);
    expect(onRemoveRecent).toHaveBeenCalledWith(entry(1).path);
    expect(onClearRecent).toHaveBeenCalled();
  });
  it("shows nothing extra without recent files", () => {
    const { container } = render(
      <LangProvider>
        <DropZone onDrop={vi.fn()} onOpen={vi.fn()} />
      </LangProvider>,
    );
    expect(container.querySelector(".recent")).toBeNull();
  });
});

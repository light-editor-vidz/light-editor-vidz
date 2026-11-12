import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import AddToProjects from "./AddToProjects";
import { noDestination } from "../lib/exportDestination";
import { listRecentProjects } from "../lib/commands";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../lib/commands", () => ({ listRecentProjects: vi.fn() }));

beforeEach(() => {
  vi.mocked(listRecentProjects).mockResolvedValue([
    { path: "/p/a.lvproj", name: "Alpha", width: 1, height: 1, duration: 1 },
    { path: "/p/b.lvproj", name: "Beta", width: 1, height: 1, duration: 1 },
  ]);
});

describe("AddToProjects", () => {
  it("lists the recent projects once enabled and allows several", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<AddToProjects selected={[]} onChange={onChange} toComputer onToComputer={vi.fn()} />);
    expect(listRecentProjects).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Add to a project"));
    fireEvent.click(await screen.findByLabelText("Alpha"));
    expect(onChange).toHaveBeenLastCalledWith(["/p/a.lvproj"]);
    rerender(<AddToProjects selected={["/p/a.lvproj"]} onChange={onChange} toComputer onToComputer={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Beta"));
    expect(onChange).toHaveBeenLastCalledWith(["/p/a.lvproj", "/p/b.lvproj"]);
  });

  it("can pick another project folder", async () => {
    vi.mocked(open).mockResolvedValue("/other/c.lvproj");
    const onChange = vi.fn();
    render(<AddToProjects selected={[]} onChange={onChange} toComputer onToComputer={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Add to a project"));
    fireEvent.click(await screen.findByRole("button", { name: "Another project…" }));
    expect(await screen.findByLabelText("c.lvproj")).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(["/other/c.lvproj"]);
  });

  it("offers the computer as a destination that can be switched off", () => {
    const onToComputer = vi.fn();
    render(<AddToProjects selected={[]} onChange={vi.fn()} toComputer onToComputer={onToComputer} />);
    const box = screen.getByLabelText("On my computer");
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(onToComputer).toHaveBeenCalledWith(false);
  });

  it("asks for a destination when neither the computer nor a project is chosen", () => {
    const { rerender } = render(
      <AddToProjects selected={[]} onChange={vi.fn()} toComputer={false} onToComputer={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Choose where to export");
    rerender(<AddToProjects selected={["/p/a.lvproj"]} onChange={vi.fn()} toComputer={false} onToComputer={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("tells whether an export has somewhere to go", () => {
    expect(noDestination(false, [])).toBe(true);
    expect(noDestination(true, [])).toBe(false);
    expect(noDestination(false, ["/p/a.lvproj"])).toBe(false);
  });

  it("clears the choice when switched off", async () => {
    const onChange = vi.fn();
    render(<AddToProjects selected={["/p/a.lvproj"]} onChange={onChange} toComputer onToComputer={vi.fn()} />);
    const box = screen.getByLabelText("Add to a project");
    fireEvent.click(box);
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

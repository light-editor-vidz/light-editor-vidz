import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppMenu, { type MenuEntry } from "./AppMenu";

const open = () => fireEvent.click(screen.getByRole("button", { name: "File" }));

describe("AppMenu", () => {
  const items: MenuEntry[] = [
    { label: "New", onClick: vi.fn(), shortcut: "Ctrl+N" },
    "separator",
    { label: "Quit", onClick: vi.fn(), disabled: true },
  ];

  it("starts closed", () => {
    render(<AppMenu label="File" items={items} />);
    expect(screen.queryByRole("button", { name: /New/ })).not.toBeInTheDocument();
  });

  it("opens on click and marks the trigger", () => {
    render(<AppMenu label="File" items={items} />);

    open();

    expect(screen.getByRole("button", { name: /New/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File" })).toHaveClass("open");
  });

  it("closes on a second click", () => {
    render(<AppMenu label="File" items={items} />);
    open();

    open();

    expect(screen.queryByRole("button", { name: /New/ })).not.toBeInTheDocument();
  });

  it("shows the shortcut next to an entry", () => {
    render(<AppMenu label="File" items={items} />);
    open();
    expect(screen.getByText("Ctrl+N")).toBeInTheDocument();
  });

  it("renders separators between groups", () => {
    const { container } = render(<AppMenu label="File" items={items} />);
    open();
    expect(container.querySelectorAll(".app-menu-separator")).toHaveLength(1);
  });

  it("runs an entry and closes", () => {
    const onClick = vi.fn();
    render(<AppMenu label="File" items={[{ label: "New", onClick }]} />);
    open();

    fireEvent.click(screen.getByRole("button", { name: "New" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });

  it("greys out a disabled entry", () => {
    render(<AppMenu label="File" items={items} />);
    open();
    expect(screen.getByRole("button", { name: "Quit" })).toBeDisabled();
  });

  it("closes when clicking outside", () => {
    render(<AppMenu label="File" items={items} />);
    open();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("button", { name: /New/ })).not.toBeInTheDocument();
  });

  it("stays open when clicking inside", () => {
    const { container } = render(<AppMenu label="File" items={items} />);
    open();

    fireEvent.mouseDown(container.querySelector(".app-menu-dropdown")!);

    expect(screen.getByRole("button", { name: /New/ })).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<AppMenu label="File" items={items} />);
    open();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("button", { name: /New/ })).not.toBeInTheDocument();
  });

  it("ignores other keys", () => {
    render(<AppMenu label="File" items={items} />);
    open();

    fireEvent.keyDown(window, { key: "a" });

    expect(screen.getByRole("button", { name: /New/ })).toBeInTheDocument();
  });

  it("renders extra children inside the dropdown", () => {
    render(
      <AppMenu label="File">
        <span>extra content</span>
      </AppMenu>,
    );
    open();
    expect(screen.getByText("extra content")).toBeInTheDocument();
  });

  it("copes with no items at all", () => {
    const { container } = render(<AppMenu label="File" />);
    open();
    expect(container.querySelector(".app-menu-dropdown")).toBeInTheDocument();
  });

  it("detaches its listeners once closed", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    render(<AppMenu label="File" items={items} />);
    open();

    open();

    expect(remove).toHaveBeenCalledWith("mousedown", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
    remove.mockRestore();
  });
});

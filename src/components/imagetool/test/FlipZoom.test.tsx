import "./setup";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FlipControls } from "../FlipControls";
import { ZoomSelect } from "../ZoomSelect";

describe("FlipControls", () => {
  function setup(props: Partial<Parameters<typeof FlipControls>[0]> = {}) {
    const handlers = { onFlipH: vi.fn(), onFlipV: vi.fn() };
    render(<FlipControls isLoading={false} {...handlers} {...props} />);
    return handlers;
  }

  it("flips horizontally", async () => {
    const { onFlipH } = setup();
    await userEvent.click(screen.getByLabelText("Flip horizontal"));
    expect(onFlipH).toHaveBeenCalledTimes(1);
  });

  it("flips vertically", async () => {
    const { onFlipV } = setup();
    await userEvent.click(screen.getByLabelText("Flip vertical"));
    expect(onFlipV).toHaveBeenCalledTimes(1);
  });

  it("disables the flips while busy", () => {
    setup({ isLoading: true });
    expect(screen.getByLabelText("Flip horizontal")).toBeDisabled();
    expect(screen.getByLabelText("Flip vertical")).toBeDisabled();
  });
});

describe("ZoomSelect", () => {
  const presets = [0.25, 0.5, 1, 2];

  function setup(zoom = 1) {
    const onChange = vi.fn();
    render(<ZoomSelect zoom={zoom} presets={presets} onChange={onChange} />);
    return { onChange };
  }

  it("shows the zoom as a percentage", () => {
    setup(0.5);
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("50%");
  });

  it("marks a zoom that is not one of the presets", () => {
    setup(0.73);
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("73% *");
  });

  it("keeps the preset list closed until asked", () => {
    setup();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens and closes the list on click", async () => {
    setup();

    await userEvent.click(screen.getByLabelText("Zoom level"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Zoom level"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("lists every preset and marks the active one", async () => {
    setup(1);
    await userEvent.click(screen.getByLabelText("Zoom level"));

    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["25%", "50%", "100%", "200%"]);
    expect(options[2]).toHaveAttribute("aria-selected", "true");
  });

  it("reports the chosen preset and closes", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByLabelText("Zoom level"));

    await userEvent.click(screen.getByRole("option", { name: "200%" }));

    expect(onChange).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes when clicking outside", async () => {
    setup();
    await userEvent.click(screen.getByLabelText("Zoom level"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("stays open when clicking inside the list", async () => {
    setup();
    await userEvent.click(screen.getByLabelText("Zoom level"));

    fireEvent.mouseDown(screen.getByRole("listbox"));

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});

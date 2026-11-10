import "./setup";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CanvasResizeDialog } from "../CanvasResizeDialog";

function setup(props: Partial<Parameters<typeof CanvasResizeDialog>[0]> = {}) {
  const onResize = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <CanvasResizeDialog
      open
      originalWidth={800}
      originalHeight={400}
      isLoading={false}
      onResize={onResize}
      onClose={onClose}
      {...props}
    />,
  );
  return { onResize, onClose, ...view };
}

const widthBox = () => screen.getAllByRole("spinbutton")[0];
const heightBox = () => screen.getAllByRole("spinbutton")[1];
const applyButton = () => screen.getByRole("button", { name: "Apply" });

describe("CanvasResizeDialog — rendering", () => {
  it("renders nothing while closed", () => {
    const { container } = setup({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("starts from the original size", () => {
    setup();
    expect(screen.getByText("Original: 800 × 400 px — new size must be ≥ original")).toBeInTheDocument();
    expect(widthBox()).toHaveValue(800);
    expect(heightBox()).toHaveValue(400);
  });

  it("re-seeds itself when reopened on another image", () => {
    const { rerender } = setup();
    fireEvent.change(widthBox(), { target: { value: "1200" } });

    rerender(
      <CanvasResizeDialog
        open
        originalWidth={640}
        originalHeight={480}
        isLoading={false}
        onResize={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(widthBox()).toHaveValue(640);
    expect(heightBox()).toHaveValue(480);
  });

  it("starts centred and unlocked", () => {
    setup();
    expect(screen.getByText("Center")).toBeInTheDocument();
    expect(screen.getByTitle("Lock ratio")).toBeInTheDocument();
  });
});

describe("CanvasResizeDialog — size fields", () => {
  it("accepts a larger canvas", () => {
    setup();

    fireEvent.change(widthBox(), { target: { value: "1000" } });

    expect(widthBox()).toHaveValue(1000);
    expect(applyButton()).toBeEnabled();
  });

  it("refuses a canvas smaller than the image", () => {
    setup();

    fireEvent.change(widthBox(), { target: { value: "400" } });

    expect(applyButton()).toBeDisabled();
  });

  it("treats a non-numeric width as empty, disables Apply, and restores it on blur", () => {
    setup();

    fireEvent.change(widthBox(), { target: { value: "abc" } });
    expect(widthBox()).toHaveValue(null);
    expect(applyButton()).toBeDisabled();

    fireEvent.blur(widthBox());
    expect(widthBox()).toHaveValue(800);
  });

  it("refuses a canvas beyond the size limit and says why", () => {
    setup();

    fireEvent.change(widthBox(), { target: { value: "30000" } });
    fireEvent.change(heightBox(), { target: { value: "30000" } });

    expect(applyButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/too large/i);
  });

  it("snaps a too-small width back on blur", () => {
    setup();

    fireEvent.change(widthBox(), { target: { value: "100" } });
    fireEvent.blur(widthBox());

    expect(widthBox()).toHaveValue(800);
  });

  it("snaps a too-small height back on blur", () => {
    setup();

    fireEvent.change(heightBox(), { target: { value: "10" } });
    fireEvent.blur(heightBox());

    expect(heightBox()).toHaveValue(400);
  });

  it("treats a non-numeric height as empty and restores it on blur", () => {
    setup();

    fireEvent.change(heightBox(), { target: { value: "xyz" } });
    expect(heightBox()).toHaveValue(null);

    fireEvent.blur(heightBox());
    expect(heightBox()).toHaveValue(400);
  });
});

describe("CanvasResizeDialog — ratio lock", () => {
  it("links the height to the width once locked", async () => {
    setup();
    await userEvent.click(screen.getByTitle("Lock ratio"));

    fireEvent.change(widthBox(), { target: { value: "1600" } });

    expect(heightBox()).toHaveValue(800);
  });

  it("links the width to the height once locked", async () => {
    setup();
    await userEvent.click(screen.getByTitle("Lock ratio"));

    fireEvent.change(heightBox(), { target: { value: "800" } });

    expect(widthBox()).toHaveValue(1600);
  });

  it("keeps the linked side at least as large as the original on blur", async () => {
    setup();
    await userEvent.click(screen.getByTitle("Lock ratio"));

    fireEvent.change(widthBox(), { target: { value: "100" } });
    fireEvent.blur(widthBox());

    expect(widthBox()).toHaveValue(800);
    expect(heightBox()).toHaveValue(400);
  });

  it("keeps the linked width at least the original on height blur", async () => {
    setup();
    await userEvent.click(screen.getByTitle("Lock ratio"));

    fireEvent.change(heightBox(), { target: { value: "10" } });
    fireEvent.blur(heightBox());

    expect(heightBox()).toHaveValue(400);
    expect(widthBox()).toHaveValue(800);
  });

  it("can be unlocked again", async () => {
    setup();
    await userEvent.click(screen.getByTitle("Lock ratio"));
    await userEvent.click(screen.getByTitle("Unlock ratio"));

    fireEvent.change(widthBox(), { target: { value: "1600" } });

    expect(heightBox()).toHaveValue(400);
  });
});

describe("CanvasResizeDialog — anchor", () => {
  it("offers nine anchors", () => {
    setup();
    // 9 anchors + the ratio-lock button + Cancel + Apply
    expect(screen.getAllByRole("button")).toHaveLength(12);
  });

  it("remembers the chosen anchor", async () => {
    const { onResize } = setup();
    const anchorButtons = screen.getAllByRole("button").slice(1, 10);

    await userEvent.click(anchorButtons[0]);
    fireEvent.change(widthBox(), { target: { value: "1000" } });
    await userEvent.click(applyButton());

    expect(onResize).toHaveBeenCalledWith(1000, 400, "top-left", [255, 255, 255, 255]);
    expect(screen.getByText("Top left")).toBeInTheDocument();
  });
});

describe("CanvasResizeDialog — fill colour", () => {
  it("defaults to opaque white", async () => {
    const { onResize } = setup();

    fireEvent.change(widthBox(), { target: { value: "1000" } });
    await userEvent.click(applyButton());

    expect(onResize).toHaveBeenCalledWith(1000, 400, "center", [255, 255, 255, 255]);
  });

  it("converts the picked hex to RGB", async () => {
    const { onResize } = setup();

    fireEvent.change(screen.getByDisplayValue("#ffffff"), { target: { value: "#336699" } });
    fireEvent.change(widthBox(), { target: { value: "1000" } });
    await userEvent.click(applyButton());

    expect(onResize).toHaveBeenCalledWith(1000, 400, "center", [0x33, 0x66, 0x99, 255]);
  });

  it("sends a zero alpha and disables the picker when transparent", async () => {
    const { onResize } = setup();

    await userEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByDisplayValue("#ffffff")).toBeDisabled();

    fireEvent.change(widthBox(), { target: { value: "1000" } });
    await userEvent.click(applyButton());

    expect(onResize).toHaveBeenCalledWith(1000, 400, "center", [255, 255, 255, 0]);
  });
});

describe("CanvasResizeDialog — actions", () => {
  it("cancels without resizing", async () => {
    const { onResize, onClose } = setup();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onResize).not.toHaveBeenCalled();
  });

  it("shows a busy label while applying", () => {
    setup({ isLoading: true });
    expect(screen.getByRole("button", { name: "Applying…" })).toBeDisabled();
  });
});

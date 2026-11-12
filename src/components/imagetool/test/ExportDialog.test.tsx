import "./setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ExportDialog } from "../ExportDialog";

// jsdom doesn't implement showModal/close, patch them
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

function renderDialog(props: Partial<Parameters<typeof ExportDialog>[0]> = {}) {
  const defaults = {
    open: true,
    isLoading: false,
    onExport: vi.fn(),
    onClose: vi.fn(),
  };
  return render(<ExportDialog {...defaults} {...props} />);
}

describe("ExportDialog", () => {
  it("renders when open", () => {
    renderDialog({ open: true });
    expect(screen.getByText("Export Image")).toBeInTheDocument();
  });

  it("quality slider is hidden for PNG format (default)", () => {
    renderDialog();
    expect(screen.queryByTestId("quality-slider")).not.toBeInTheDocument();
  });

  it("quality slider is visible when JPEG is selected", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("radio", { name: /jpeg/i }));
    expect(screen.getByTestId("quality-slider")).toBeInTheDocument();
  });

  it("WebP is lossless: no quality slider, and the dialog says so", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("radio", { name: /webp/i }));
    expect(screen.queryByTestId("quality-slider")).not.toBeInTheDocument();
    expect(screen.getByText(/without loss/i)).toBeInTheDocument();
  });

  it("warns that transparency turns white in JPEG", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("radio", { name: /jpeg/i }));
    expect(screen.getByText(/become white/i)).toBeInTheDocument();
  });

  it("exports WebP without a quality value", async () => {
    const onExport = vi.fn();
    renderDialog({ onExport });
    await userEvent.click(screen.getByRole("radio", { name: /webp/i }));
    await userEvent.click(screen.getByTestId("export-button"));
    expect(onExport).toHaveBeenCalledWith("webp", undefined);
  });

  it("starts from the current default format each time it opens", async () => {
    const { rerender } = render(
      <ExportDialog open isLoading={false} defaultFormat="png" onExport={vi.fn()} onClose={vi.fn()} />,
    );
    rerender(<ExportDialog open={false} isLoading={false} defaultFormat="png" onExport={vi.fn()} onClose={vi.fn()} />);

    rerender(<ExportDialog open isLoading={false} defaultFormat="jpeg" onExport={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /jpeg/i })).toBeChecked();
  });

  it("quality slider is hidden for BMP", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("radio", { name: /bmp/i }));
    expect(screen.queryByTestId("quality-slider")).not.toBeInTheDocument();
  });

  it("quality slider is hidden for TIFF", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("radio", { name: /tiff/i }));
    expect(screen.queryByTestId("quality-slider")).not.toBeInTheDocument();
  });

  it("Export button calls onExport with format PNG and no quality", async () => {
    const onExport = vi.fn();
    renderDialog({ onExport });
    await userEvent.click(screen.getByTestId("export-button"));
    expect(onExport).toHaveBeenCalledWith("png", undefined);
  });

  it("Export button calls onExport with JPEG and quality 90", async () => {
    const onExport = vi.fn();
    renderDialog({ onExport });
    await userEvent.click(screen.getByRole("radio", { name: /jpeg/i }));
    await userEvent.click(screen.getByTestId("export-button"));
    expect(onExport).toHaveBeenCalledWith("jpeg", 90);
  });

  it("Cancel button calls onClose", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Export button is disabled without a destination", () => {
    renderDialog({ noDestination: true });
    expect(screen.getByTestId("export-button")).toBeDisabled();
  });

  it("Export button is disabled while loading", () => {
    renderDialog({ isLoading: true });
    expect(screen.getByTestId("export-button")).toBeDisabled();
  });
});

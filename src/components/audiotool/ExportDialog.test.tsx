import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ExportDialog from "./ExportDialog";

function setup(props: Partial<Parameters<typeof ExportDialog>[0]> = {}) {
  const handlers = {
    onFormat: vi.fn(),
    onWavDepth: vi.fn(),
    onExport: vi.fn(),
    onCancel: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <ExportDialog
      format="wav"
      wavDepth="float32"
      problem=""
      processing={false}
      progress={0}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("ExportDialog", () => {
  it("propose les cinq formats, celui du moment étant sélectionné", () => {
    setup({ format: "flac" });

    for (const name of ["WAV", "MP3", "FLAC", "OGG", "M4A"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "FLAC" })).toHaveAttribute("aria-pressed", "true");
  });

  it("change de format", () => {
    const { onFormat } = setup();

    fireEvent.click(screen.getByRole("button", { name: "MP3" }));

    expect(onFormat).toHaveBeenCalledWith("mp3");
  });

  it("le format des échantillons n'existe que pour un WAV", () => {
    const { onWavDepth } = setup();
    fireEvent.change(screen.getByLabelText("WAV sample format"), { target: { value: "pcm16" } });
    expect(onWavDepth).toHaveBeenCalledWith("pcm16");
  });

  it("le masque pour les autres formats", () => {
    setup({ format: "mp3" });
    expect(screen.queryByLabelText("WAV sample format")).not.toBeInTheDocument();
  });

  it("exporte au clic", () => {
    const { onExport } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    expect(onExport).toHaveBeenCalled();
  });

  it("explique pourquoi l'export est refusé, et le désactive", () => {
    setup({ problem: "The fade in (3.00 s) is longer than the audio kept" });

    expect(screen.getByRole("status")).toHaveTextContent("longer than the audio kept");
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("Annuler et la croix ferment la fenêtre", () => {
    const { onClose } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("Échap ferme la fenêtre", () => {
    const { onClose } = setup();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  describe("pendant l'export", () => {
    it("montre l'avancement et ne se ferme plus", () => {
      const { onClose } = setup({ processing: true, progress: 40 });

      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
      expect(screen.getByRole("button", { name: "Processing… 40%" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
      fireEvent.keyDown(window, { key: "Escape" });
      fireEvent.click(document.querySelector(".modal-backdrop") as HTMLElement);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("Annuler arrête l'export au lieu de masquer la fenêtre", () => {
      const { onCancel, onClose } = setup({ processing: true, progress: 10 });

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onCancel).toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("fige le choix du format", () => {
      setup({ processing: true });
      expect(screen.getByRole("button", { name: "MP3" })).toBeDisabled();
    });
  });
});

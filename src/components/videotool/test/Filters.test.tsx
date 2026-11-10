import "./setup";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Filters from "../components/Filters";
import { VIDEO_FILTERS } from "../utils/filters";
import { LangProvider } from "../i18n";

function renderWithI18n(ui: React.ReactElement) {
  return render(<LangProvider>{ui}</LangProvider>);
}

const defaultProps = {
  activeFilterId: "none",
  onSelect: vi.fn(),
};

describe("Filters", () => {
  it("renders all filter cards", () => {
    renderWithI18n(<Filters {...defaultProps} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(VIDEO_FILTERS.length);
  });

  it("marks the active filter card", () => {
    const { container } = renderWithI18n(<Filters {...defaultProps} activeFilterId="grayscale" />);
    const active = container.querySelectorAll(".filter-card.active");
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toMatch(/gris|grayscale/i);
  });

  it("calls onSelect with the filter id when a card is clicked", () => {
    const onSelect = vi.fn();
    renderWithI18n(<Filters {...defaultProps} onSelect={onSelect} />);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith(VIDEO_FILTERS[1].id);
  });

  it("shows placeholder text when no frameDataUrl is provided", () => {
    const { container } = renderWithI18n(<Filters {...defaultProps} />);
    const placeholders = container.querySelectorAll(".preview-placeholder");
    expect(placeholders.length).toBe(VIDEO_FILTERS.length);
  });

  it("shows img previews when frameDataUrl is provided", () => {
    const { container } = renderWithI18n(<Filters {...defaultProps} frameDataUrl="data:image/jpeg;base64,abc" />);
    const imgs = container.querySelectorAll(".filter-preview-img");
    expect(imgs).toHaveLength(VIDEO_FILTERS.length);
    expect(container.querySelectorAll(".preview-placeholder")).toHaveLength(0);
  });

  it("applies CSS filter style to img previews", () => {
    const { container } = renderWithI18n(<Filters {...defaultProps} frameDataUrl="data:image/jpeg;base64,abc" />);
    const imgs = container.querySelectorAll(".filter-preview-img");
    const idx = VIDEO_FILTERS.findIndex((f) => f.id === "grayscale");
    expect(imgs[idx]?.getAttribute("style")).toContain("grayscale(100%)");
  });

  it("applies transform style for mirror filter", () => {
    const { container } = renderWithI18n(<Filters {...defaultProps} frameDataUrl="data:image/jpeg;base64,abc" />);
    const imgs = container.querySelectorAll(".filter-preview-img");
    const idx = VIDEO_FILTERS.findIndex((f) => f.id === "mirror");
    const style = imgs[idx]?.getAttribute("style") ?? "";
    expect(style).toContain("scaleX(-1)");
    expect(style).toContain("filter: none");
  });
});

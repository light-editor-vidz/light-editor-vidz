import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NumberField } from "./NumberField";
import { formatNumber } from "../../../lib/format";

function setup(props: Partial<Parameters<typeof NumberField>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(<NumberField value={5} onChange={onChange} {...props} />);
  return { onChange, input: screen.getByRole("spinbutton") as HTMLInputElement, ...view };
}

describe("NumberField", () => {
  it("affiche la valeur sans zéros inutiles", () => {
    expect(setup({ value: 12.5 }).input.value).toBe("12.5");
    expect(formatNumber(3.14159, 2)).toBe("3.14");
    expect(formatNumber(NaN, 2)).toBe("");
  });

  it("accepte les décimales", () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: "12.5" } });
    expect(onChange).toHaveBeenCalledWith(12.5);
  });

  it("vider le champ n'envoie rien (pas de 0 forcé) et le champ revient à la valeur à la sortie", () => {
    const { input, onChange } = setup({ value: 7 });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    fireEvent.blur(input);
    expect(input.value).toBe("7");
  });

  it("borne la valeur envoyée à min et max", () => {
    const { input, onChange } = setup({ min: 1, max: 10 });
    fireEvent.change(input, { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.change(input, { target: { value: "99" } });
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it("suit une valeur modifiée ailleurs quand il n'a pas le focus", () => {
    const { input, rerender, onChange } = setup({ value: 1 });
    rerender(<NumberField value={9} onChange={onChange} />);
    expect(input.value).toBe("9");
  });

  it("ne réécrit pas le texte en cours de frappe", () => {
    const { input, rerender, onChange } = setup({ value: 1 });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2.5" } });
    rerender(<NumberField value={2.5} onChange={onChange} />);
    expect(input.value).toBe("2.5");
  });
});

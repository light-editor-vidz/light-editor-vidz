import { Type, Image as ImageIcon, Video as VideoIcon, Shapes } from "lucide-react";
import type { Animation } from "../../../bindings/Animation";
import type { AnimationType } from "../../../bindings/AnimationType";
import type { BlendMode } from "../../../bindings/BlendMode";
import type { Easing } from "../../../bindings/Easing";
import type { Element } from "../../../bindings/Element";
import type { ImagePanType } from "../../../bindings/ImagePanType";
import type { TextAlign } from "../../../bindings/TextAlign";
import type { VerticalAlign } from "../../../bindings/VerticalAlign";

/** Listes d'options et libellés partagés par les panneaux de propriétés (hors des fichiers de
 * composants, pour que le rechargement à chaud de React reste valide). */

export const ANIMATION_OPTIONS: { type: AnimationType; labelKey: string }[] = [
  { type: "fade", labelKey: "properties.animFade" },
  { type: "slide-left", labelKey: "properties.animSlideLeft" },
  { type: "slide-right", labelKey: "properties.animSlideRight" },
  { type: "slide-up", labelKey: "properties.animSlideUp" },
  { type: "slide-down", labelKey: "properties.animSlideDown" },
  { type: "fade-left", labelKey: "properties.animFadeLeft" },
  { type: "fade-right", labelKey: "properties.animFadeRight" },
  { type: "fade-up", labelKey: "properties.animFadeUp" },
  { type: "fade-down", labelKey: "properties.animFadeDown" },
  { type: "zoom-in", labelKey: "properties.animZoomIn" },
  { type: "zoom-out", labelKey: "properties.animZoomOut" },
  { type: "rotate", labelKey: "properties.animRotate" },
  { type: "flip", labelKey: "properties.animFlip" },
  { type: "blur", labelKey: "properties.animBlur" },
  { type: "bounce", labelKey: "properties.animBounce" },
  { type: "drop", labelKey: "properties.animDrop" },
  { type: "skew-left", labelKey: "properties.animSkewLeft" },
  { type: "skew-right", labelKey: "properties.animSkewRight" },
  { type: "roll", labelKey: "properties.animRoll" },
  { type: "spin", labelKey: "properties.animSpin" },
];

export const TEXT_ONLY_ANIMATION_OPTIONS: { type: AnimationType; labelKey: string }[] = [
  { type: "typewriter", labelKey: "properties.animTypewriter" },
  { type: "word-reveal", labelKey: "properties.animWordReveal" },
  { type: "line-reveal", labelKey: "properties.animLineReveal" },
];

export const EASING_OPTIONS: { value: Easing; labelKey: string }[] = [
  { value: "linear", labelKey: "properties.easingLinear" },
  { value: "power1-in", labelKey: "properties.easingPower1In" },
  { value: "power1-out", labelKey: "properties.easingPower1Out" },
  { value: "power1-in-out", labelKey: "properties.easingPower1InOut" },
  { value: "power2-in", labelKey: "properties.easingPower2In" },
  { value: "power2-out", labelKey: "properties.easingPower2Out" },
  { value: "power2-in-out", labelKey: "properties.easingPower2InOut" },
  { value: "power3-in", labelKey: "properties.easingPower3In" },
  { value: "power3-out", labelKey: "properties.easingPower3Out" },
  { value: "power3-in-out", labelKey: "properties.easingPower3InOut" },
  { value: "bounce", labelKey: "properties.easingBounce" },
];

export const DEFAULT_ANIMATION: Animation = {
  animation_type: "fade",
  direction: "in",
  duration: 0.6,
  easing: "power2-out",
  with_fade: true,
};

export const BLEND_MODES: BlendMode[] = ["normal", "multiply", "screen", "overlay", "darken", "lighten"];

export const BLEND_MODE_LABEL_KEYS: Record<BlendMode, string> = {
  normal: "properties.blendNormal",
  multiply: "properties.blendMultiply",
  screen: "properties.blendScreen",
  overlay: "properties.blendOverlay",
  darken: "properties.blendDarken",
  lighten: "properties.blendLighten",
};

export const PAN_OPTIONS: { value: ImagePanType | ""; labelKey: string }[] = [
  { value: "", labelKey: "properties.kenBurnsNone" },
  { value: "zoomIn", labelKey: "properties.panZoomIn" },
  { value: "zoomOut", labelKey: "properties.panZoomOut" },
  { value: "panLeft", labelKey: "properties.panLeft" },
  { value: "panRight", labelKey: "properties.panRight" },
  { value: "panUp", labelKey: "properties.panUp" },
  { value: "panDown", labelKey: "properties.panDown" },
];

export const ICON_BY_TYPE: Record<Element["type"], React.ReactNode> = {
  text: <Type size={12} />,
  image: <ImageIcon size={12} />,
  video: <VideoIcon size={12} />,
  shape: <Shapes size={12} />,
};

export const FIT_MODES = ["cover", "stretch", "fit-largest", "fit-width", "fit-height"] as const;

export const FIT_MODE_LABEL_KEYS: Record<(typeof FIT_MODES)[number], string> = {
  cover: "properties.fitCover",
  stretch: "properties.fitStretch",
  "fit-largest": "properties.fitLargest",
  "fit-width": "properties.fitWidth",
  "fit-height": "properties.fitHeight",
};

/** Hauteur de ligne appliquée (preview et export) quand elle n'est pas réglée. */
export const DEFAULT_LINE_HEIGHT = 1.25;

export const TEXT_ALIGN_OPTIONS: TextAlign[] = ["left", "center", "right"];

export const TEXT_ALIGN_LABELS: Record<TextAlign, string> = { left: "⟵", center: "•", right: "⟶" };

export const VERTICAL_ALIGN_OPTIONS: VerticalAlign[] = ["top", "middle", "bottom"];

export const VERTICAL_ALIGN_LABELS: Record<VerticalAlign, string> = { top: "⤒", middle: "•", bottom: "⤓" };

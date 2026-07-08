import type { VariantRecipe } from "@/types";

type Rgb = {
  r: number;
  g: number;
  b: number;
};

type Hsl = {
  h: number;
  s: number;
  l: number;
};

const palette = [
  { id: "emerald", name: "Emerald", hex: "#08c18a" },
  { id: "ink", name: "Ink", hex: "#121330" },
  { id: "violet", name: "Violet", hex: "#7f4cff" },
  { id: "sky", name: "Sky", hex: "#1c91e7" },
  { id: "amber", name: "Amber", hex: "#ffc738" },
  { id: "rose", name: "Rose", hex: "#f44336" },
  { id: "mint", name: "Mint", hex: "#cef3e8" },
  { id: "mono", name: "Mono", hex: "#717181" },
];

export const variantRecipes: VariantRecipe[] = palette.map((item) => {
  const rgb = hexToRgb(item.hex);
  const hsl = rgbToHsl(rgb);
  const invert = clamp(Math.round(18 + hsl.l * 62), 20, 78);
  const brightness = clamp(Math.round(70 + hsl.l * 55), 64, 136);
  const saturation = clamp(Math.round(220 + hsl.s * 780), 180, 1050);
  const hue = Math.round(hsl.h - 48);

  return {
    ...item,
    tintFilter: `brightness(0) saturate(100%) invert(${invert}%) sepia(100%) saturate(${saturation}%) hue-rotate(${hue}deg) brightness(${brightness}%) contrast(96%)`,
    hueFilter: `hue-rotate(${Math.round(hsl.h)}deg) saturate(${clamp(Math.round(90 + hsl.s * 115), 90, 190)}%) contrast(102%)`,
    shadow: `0 18px 44px ${rgba(rgb, 0.24)}`,
  };
});

export function findVariant(id: string): VariantRecipe {
  return variantRecipes.find((variant) => variant.id === id) ?? variantRecipes[0];
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rp = r / 255;
  const gp = g / 255;
  const bp = b / 255;
  const max = Math.max(rp, gp, bp);
  const min = Math.min(rp, gp, bp);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l };
  }

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = 0;

  if (max === rp) {
    h = 60 * (((gp - bp) / delta) % 6);
  } else if (max === gp) {
    h = 60 * ((bp - rp) / delta + 2);
  } else {
    h = 60 * ((rp - gp) / delta + 4);
  }

  return { h: h < 0 ? h + 360 : h, s, l };
}

function rgba({ r, g, b }: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

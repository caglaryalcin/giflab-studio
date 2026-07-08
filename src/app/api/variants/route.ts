import { variantRecipes } from "@/lib/color-variants";

export async function GET() {
  return Response.json({
    items: variantRecipes,
    modes: ["original", "tint", "hue"],
  });
}

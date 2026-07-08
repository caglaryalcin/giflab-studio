import { GifArchiveApp } from "@/components/GifArchiveApp";
import { variantRecipes } from "@/lib/color-variants";
import { demoCatalogItems } from "@/lib/demo-catalog";

export default function Home() {
  return <GifArchiveApp initialItems={demoCatalogItems} variants={variantRecipes} />;
}

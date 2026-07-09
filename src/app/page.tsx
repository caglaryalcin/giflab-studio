import { GifArchiveApp } from "@/components/GifArchiveApp";
import { variantRecipes } from "@/lib/color-variants";
import { getGifCatalog } from "@/lib/gif-catalog";

const initialCatalogLimit = 120;

export default async function Home() {
  const catalog = await getGifCatalog({ limit: initialCatalogLimit });

  return (
    <GifArchiveApp
      initialCategories={catalog.categories}
      initialItems={catalog.items}
      initialTotal={catalog.total}
      variants={variantRecipes}
    />
  );
}

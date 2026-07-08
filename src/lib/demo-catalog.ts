import type { GifItem } from "@/types";

const demoSources = [
  "/media/assets/icons/main/giflab.svg",
  "/media/assets/icons/main/mobile-menu.svg",
  "/media/assets/icons/main/arrow-down.svg",
  "/media/assets/icons/slot/search.svg",
  "/media/assets/icons/slot/search-clear.svg",
  "/media/assets/icons/blocks/button-arrow-right.svg",
  "/media/assets/icons/blocks/dots-circle-right.svg",
  "/media/assets/icons/brands/instagram.svg",
  "/media/assets/icons/brands/x.svg",
  "/media/assets/icons/brands/youtube.svg",
  "/media/assets/icons/brands/discord.svg",
  "/media/assets/icons/brands/dribbble.svg",
];

export const demoCatalogItems: GifItem[] = [
  createDemoItem("demo-01", "Cloud sync", "Interface", demoSources[0]),
  createDemoItem("demo-02", "Social pulse", "Marketing", demoSources[1]),
  createDemoItem("demo-03", "Checkout loop", "Commerce", demoSources[2]),
  createDemoItem("demo-04", "Analytics wave", "Data", demoSources[3]),
  createDemoItem("demo-05", "Security mark", "System", demoSources[4]),
  createDemoItem("demo-06", "Message spark", "Communication", demoSources[5]),
  createDemoItem("demo-07", "Upload motion", "System", demoSources[6]),
  createDemoItem("demo-08", "Creative stroke", "Design", demoSources[7]),
  createDemoItem("demo-09", "Location ping", "Travel", demoSources[8]),
  createDemoItem("demo-10", "Automation ring", "Productivity", demoSources[9]),
  createDemoItem("demo-11", "Notification beat", "Communication", demoSources[10]),
  createDemoItem("demo-12", "Launch badge", "Marketing", demoSources[11]),
];

function createDemoItem(
  id: string,
  title: string,
  category: string,
  src: string,
): GifItem {
  return {
    id,
    title,
    fileName: `${title.toLowerCase().replaceAll(" ", "-")}.gif`,
    src,
    category,
    bytes: 128000,
    updatedAt: "2026-07-06T00:00:00.000Z",
    origin: "demo",
  };
}

const BANGUMI_ORIGIN = "https://bgm.tv";

export function normalizeBangumiImageUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${BANGUMI_ORIGIN}${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  return "";
}

export function getBangumiImage(
  images: Record<string, unknown> | null | undefined,
  keys: string[] = ["large", "common", "medium", "small", "grid"],
): string {
  if (!images) return "";
  for (const key of keys) {
    const url = normalizeBangumiImageUrl(images[key]);
    if (url) return url;
  }
  return "";
}

export function handleImageError(event: Event, fallback = ""): void {
  const image = event.currentTarget as HTMLImageElement | null;
  if (!image || image.dataset.fallback) return;
  image.dataset.fallback = "true";
  if (fallback) image.src = fallback;
  else image.removeAttribute("src");
}

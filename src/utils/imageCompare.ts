/**
 * Minimal perceptual hash (pHash) for comparing anime cover images.
 * Uses a 16×16 grayscale downsample → average threshold → 256-bit hash.
 * Score mapping: identical → +50, half-threshold → 0, ≥ threshold → -50.
 */

const HASH_SIZE = 16;
const HAMMING_MATCH_THRESHOLD = 80;

/** Load an image URL into an HTMLImageElement, with timeout */
function loadImage(url: string, timeoutMs = 4000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => {
      img.src = "";
      resolve(null);
    }, timeoutMs);

    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

/** Compute a 256-bit perceptual hash from an image */
function computePHash(img: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = HASH_SIZE;
    canvas.height = HASH_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, HASH_SIZE, HASH_SIZE);
    const imageData = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE);
    const pixels = imageData.data;

    // Convert to grayscale
    const gray: number[] = [];
    for (let i = 0; i < pixels.length; i += 4) {
      gray.push((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3);
    }

    // Average
    const avg = gray.reduce((a, b) => a + b, 0) / gray.length;

    // Hash: each bit is 1 if pixel > average
    let hash = "";
    for (const g of gray) {
      hash += g >= avg ? "1" : "0";
    }
    return hash;
  } catch {
    return null;
  }
}

/** Hamming distance between two hash strings */
function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
}

export interface ImageCompareResult {
  score: number;
  distance: number;
}

/**
 * Compare two image URLs for visual similarity.
 * Returns score -50 ~ +50 (positive=similar, negative=different) + hamming distance.
 * Returns null if either image fails to load (CORS, timeout, etc.).
 */
export async function compareImages(
  urlA: string | undefined,
  urlB: string | undefined,
): Promise<ImageCompareResult | null> {
  if (!urlA || !urlB) return null;

  const [imgA, imgB] = await Promise.all([
    loadImage(urlA),
    loadImage(urlB),
  ]);

  if (!imgA || !imgB) return null;

  const hashA = computePHash(imgA);
  const hashB = computePHash(imgB);

  if (!hashA || !hashB) return null;

  const dist = hammingDistance(hashA, hashB);

  // Score mapping: identical → +50, half-threshold → 0, ≥ threshold → -50
  // dist 0 → 50, dist 40 → 0, dist 80 → -50
  const score = dist >= HAMMING_MATCH_THRESHOLD
    ? -50
    : Math.round(50 - (100 * dist / HAMMING_MATCH_THRESHOLD));
  return { score, distance: dist };
}

/** Pick a "best" image URL from a Tenrai images object */
export function TenraiImageUrl(
  images: { jpg?: { image_url?: string | null; small_image_url?: string | null } } | undefined,
): string | undefined {
  return images?.jpg?.image_url ?? images?.jpg?.small_image_url ?? undefined;
}

/** Pick a "best" image URL from a Bangumi images record */
export function bgmImageUrl(
  images: Record<string, string | undefined> | undefined,
): string | undefined {
  return images?.grid || images?.small || images?.common || undefined;
}

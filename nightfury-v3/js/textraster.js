// Text -> 16-row bitmap. Latin text uses the crisp 2x pixel font; Tamil / emoji use
// canvas rendering with a luminance threshold (same metrics as v2, which were tuned
// on the real panel). Cache is keyed by text *and* font readiness so a raster made
// before Noto Sans Tamil loaded is never reused afterwards (v2 bug).
import { Bitmap } from "./bitmap.js";
import { isPixelFontText, renderText } from "./font5x7.js";

export const TAMIL_FONT = "'Noto Sans Tamil'";
const FONT_SPEC = `bold 13px ${TAMIL_FONT}, -apple-system, system-ui, sans-serif`;
const THRESHOLD = 80;

/** Pure: RGBA pixels -> 1-bit bitmap using the v2 luminance threshold. */
export function thresholdImageData(pixels, width, height, threshold = THRESHOLD) {
  const bmp = new Bitmap(width, height);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const lum = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
    bmp.data[i] = lum > threshold ? 1 : 0;
  }
  return bmp;
}

/** Pixel-font raster, padded to 16 rows (glyphs occupy rows 1..14). */
export function pixelRaster(text) {
  const inner = renderText(text.toUpperCase(), { scale: 2 });
  const bmp = new Bitmap(inner.width + 4, 16);
  bmp.blit(inner, 2, 1);
  return bmp;
}

export function createRasterizer({ document: doc = globalThis.document, pixelFont = () => true } = {}) {
  let canvas = null;
  let ctx = null;
  let fontEpoch = 0;
  const cache = new Map();

  if (doc?.fonts?.addEventListener) {
    doc.fonts.addEventListener("loadingdone", () => { fontEpoch++; cache.clear(); });
  }

  function canvasRaster(text) {
    if (!canvas) {
      canvas = doc.createElement("canvas");
      canvas.height = 16;
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    }
    ctx.font = FONT_SPEC;
    const width = Math.max(1, Math.ceil(ctx.measureText(text).width) + 4);
    canvas.width = width;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, 16);
    ctx.fillStyle = "#fff";
    ctx.font = FONT_SPEC;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text, 2, 8.5);
    return thresholdImageData(ctx.getImageData(0, 0, width, 16).data, width, 16);
  }

  function rasterize(text) {
    const s = String(text ?? "");
    const usePixel = pixelFont() && isPixelFontText(s);
    const key = `${usePixel ? "p" : "c" + fontEpoch}|${s}`;
    let bmp = cache.get(key);
    if (!bmp) {
      bmp = usePixel ? pixelRaster(s) : canvasRaster(s);
      if (cache.size > 200) cache.clear();
      cache.set(key, bmp);
    }
    return bmp;
  }

  /** Make sure the Tamil web font is ready before rasterising for hardware. */
  async function ready(text) {
    if (!doc?.fonts?.load) return;
    try {
      await Promise.race([doc.fonts.load(FONT_SPEC, text || "அ"), new Promise((r) => setTimeout(r, 1500))]);
    } catch { /* fall back to system font */ }
  }

  return { rasterize, ready };
}

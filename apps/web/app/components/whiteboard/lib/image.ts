/** Downscale an image data URL to at most `maxSide` px on the longest edge,
 *  then re-encode as JPEG so the payload stays small enough to broadcast. */
export function compressImageDataUrl(dataUrl: string, maxSide: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const imgEl = new Image();
    imgEl.onload = () => {
      const longest = Math.max(imgEl.width, imgEl.height);
      const scale = longest > maxSide ? maxSide / longest : 1;
      const w = Math.round(imgEl.width * scale);
      const h = Math.round(imgEl.height * scale);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.drawImage(imgEl, 0, 0, w, h);
      // PNGs with transparency become opaque when exported as JPEG; for small
      // PNGs that's fine here since we only care about image imports, not UI.
      resolve(c.toDataURL("image/jpeg", quality));
    };
    imgEl.onerror = reject;
    imgEl.src = dataUrl;
  });
}

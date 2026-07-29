import { useEffect, useState, type ImgHTMLAttributes } from "react";

const scaleCache = new Map<string, number>();
const pendingScaleCache = new Map<string, Promise<number>>();

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

async function analyzeVisibleProductScale(src: string, targetFill: number) {
  const cacheKey = `${src}|${targetFill}`;
  const cached = scaleCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const pending = pendingScaleCache.get(cacheKey);
  if (pending) return pending;

  const analysis = new Promise<number>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const maxSampleSize = 160;
        const ratio = Math.min(
          1,
          maxSampleSize / Math.max(image.naturalWidth, image.naturalHeight),
        );
        const width = Math.max(1, Math.round(image.naturalWidth * ratio));
        const height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return resolve(1);

        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        const cornerIndexes = [
          0,
          (width - 1) * 4,
          (height - 1) * width * 4,
          (height * width - 1) * 4,
        ];
        const background = cornerIndexes.reduce(
          (sum, index) => ({
            r: sum.r + pixels[index],
            g: sum.g + pixels[index + 1],
            b: sum.b + pixels[index + 2],
            a: sum.a + pixels[index + 3],
          }),
          { r: 0, g: 0, b: 0, a: 0 },
        );
        background.r /= 4;
        background.g /= 4;
        background.b /= 4;
        background.a /= 4;

        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        let foregroundPixels = 0;

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const alpha = pixels[index + 3];
            if (alpha < 24) continue;

            const colorDistance =
              Math.abs(pixels[index] - background.r)
              + Math.abs(pixels[index + 1] - background.g)
              + Math.abs(pixels[index + 2] - background.b);
            const alphaDistance = Math.abs(alpha - background.a);
            const foreground =
              background.a < 80 ? alpha > 32 : colorDistance > 42 || alphaDistance > 32;
            if (!foreground) continue;

            foregroundPixels += 1;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }

        if (foregroundPixels < width * height * 0.004 || maxX < minX || maxY < minY) {
          return resolve(1);
        }

        const occupiedWidth = (maxX - minX + 1) / width;
        const occupiedHeight = (maxY - minY + 1) / height;
        const occupiedSize = Math.max(occupiedWidth, occupiedHeight);
        resolve(clamp(targetFill / occupiedSize, 0.9, 1.48));
      } catch {
        resolve(1);
      }
    };
    image.onerror = () => resolve(1);
    image.src = src;
  }).then((scale) => {
    scaleCache.set(cacheKey, scale);
    pendingScaleCache.delete(cacheKey);
    return scale;
  });

  pendingScaleCache.set(cacheKey, analysis);
  return analysis;
}

interface ProductImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  targetFill?: number;
}

export function ProductImage({
  src,
  targetFill = 0.74,
  className,
  style,
  ...props
}: ProductImageProps) {
  const cacheKey = src ? `${src}|${targetFill}` : "";
  const [scale, setScale] = useState(() => (cacheKey ? scaleCache.get(cacheKey) ?? 1 : 1));

  useEffect(() => {
    let active = true;
    if (!src) {
      setScale(1);
      return () => {
        active = false;
      };
    }

    setScale(scaleCache.get(cacheKey) ?? 1);
    analyzeVisibleProductScale(src, targetFill).then((nextScale) => {
      if (active) setScale(nextScale);
    });
    return () => {
      active = false;
    };
  }, [src, targetFill, cacheKey]);

  return (
    <img
      {...props}
      src={src}
      className={className}
      style={{ ...style, transform: `scale(${scale})` }}
    />
  );
}

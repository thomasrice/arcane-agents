import type { LoadedOutpostMap } from "../../tileMapLoader";
import { clamp, worldToScreen, type ViewportState } from "../../viewportMath";

const occlusionOverlayAlpha = 0.98;
const flameMaskVersion = "v4";
const flameRegionMaskCache = new Map<string, { canvas: HTMLCanvasElement; heatCoverage: number }>();

export function drawOutpostPreviewBackgroundLayer(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  mapData: LoadedOutpostMap,
  image: HTMLImageElement
): void {
  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;
  const topLeft = worldToScreen(0, 0, viewport);

  context.save();
  context.imageSmoothingEnabled = true;
  context.drawImage(image, topLeft.x, topLeft.y, worldWidth * viewport.scale, worldHeight * viewport.scale);
  context.restore();
}

export function drawOutpostOcclusionOverlayLayer(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  width: number,
  height: number,
  mapData: LoadedOutpostMap,
  image: HTMLImageElement
): void {
  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;
  const sourceScaleX = image.naturalWidth / worldWidth;
  const sourceScaleY = image.naturalHeight / worldHeight;

  context.save();
  context.imageSmoothingEnabled = true;

  for (const rect of mapData.occlusionRects) {
    const screen = worldToScreen(rect.x, rect.y, viewport);
    const drawWidth = rect.width * viewport.scale;
    const drawHeight = rect.height * viewport.scale;

    if (screen.x > width || screen.y > height || screen.x + drawWidth < 0 || screen.y + drawHeight < 0) {
      continue;
    }

    context.globalAlpha = occlusionOverlayAlpha;
    context.drawImage(
      image,
      rect.x * sourceScaleX,
      rect.y * sourceScaleY,
      rect.width * sourceScaleX,
      rect.height * sourceScaleY,
      screen.x,
      screen.y,
      drawWidth,
      drawHeight
    );
  }

  context.restore();
}

export function drawAmbientFlameEffectsLayer(
  context: CanvasRenderingContext2D,
  viewport: ViewportState,
  width: number,
  height: number,
  mapData: LoadedOutpostMap,
  backgroundImage: HTMLImageElement,
  nowMs: number
): void {
  if (mapData.ambientFlameRects.length === 0) {
    return;
  }

  const worldWidth = mapData.width * mapData.tileSize;
  const worldHeight = mapData.height * mapData.tileSize;
  const sourceScaleX = backgroundImage.naturalWidth / worldWidth;
  const sourceScaleY = backgroundImage.naturalHeight / worldHeight;
  const timeSeconds = nowMs / 1000;

  type FlameCluster = {
    id: number;
    phase: number;
    centerX: number;
    centerY: number;
    radius: number;
    boundsX: number;
    boundsY: number;
    boundsWidth: number;
    boundsHeight: number;
    cells: LoadedOutpostMap["ambientFlameRects"];
  };

  const clusters = new Map<number, FlameCluster>();
  for (const rect of mapData.ambientFlameRects) {
    let cluster = clusters.get(rect.clusterId);
    if (!cluster) {
      cluster = {
        id: rect.clusterId,
        phase: rect.clusterId * 1.37,
        centerX: rect.clusterCenterX,
        centerY: rect.clusterCenterY,
        radius: rect.clusterRadius,
        boundsX: rect.clusterBoundsX,
        boundsY: rect.clusterBoundsY,
        boundsWidth: rect.clusterBoundsWidth,
        boundsHeight: rect.clusterBoundsHeight,
        cells: []
      };
      clusters.set(rect.clusterId, cluster);
    }
    cluster.cells.push(rect);
  }

  for (const cluster of clusters.values()) {
    const phase = cluster.phase;
    const boundsScreen = worldToScreen(cluster.boundsX, cluster.boundsY, viewport);
    const drawWidth = cluster.boundsWidth * viewport.scale;
    const drawHeight = cluster.boundsHeight * viewport.scale;
    const cullPadding = Math.max(6, Math.max(drawWidth, drawHeight) * 0.35);

    if (
      boundsScreen.x + drawWidth < -cullPadding ||
      boundsScreen.y + drawHeight < -cullPadding ||
      boundsScreen.x > width + cullPadding ||
      boundsScreen.y > height + cullPadding
    ) {
      continue;
    }

    const flicker =
      0.26 +
      Math.sin(timeSeconds * 8.1 + phase) * 0.06 +
      Math.sin(timeSeconds * 13.7 + phase * 1.9) * 0.045;
    const lateralDrift = Math.sin(timeSeconds * 4.6 + phase * 1.3) * drawWidth * 0.003;
    const jitterY = Math.cos(timeSeconds * 3.4 + phase * 0.8) * drawHeight * 0.008;
    const widthScale = 0.996 + Math.sin(timeSeconds * 6.7 + phase * 0.9) * 0.015;
    const heightScale = 0.992 + Math.sin(timeSeconds * 5.9 + phase * 1.1) * 0.02;
    const scaledWidth = drawWidth * widthScale;
    const scaledHeight = drawHeight * heightScale;
    const drawX = boundsScreen.x + lateralDrift - (scaledWidth - drawWidth) * 0.5;
    const drawY = boundsScreen.y + jitterY - (scaledHeight - drawHeight);
    const sourceX = cluster.boundsX * sourceScaleX;
    const sourceY = cluster.boundsY * sourceScaleY;
    const sourceWidth = Math.max(1, cluster.boundsWidth * sourceScaleX);
    const sourceHeight = Math.max(1, cluster.boundsHeight * sourceScaleY);
    const flameMask = getOrCreateFlameRegionMask(backgroundImage, sourceX, sourceY, sourceWidth, sourceHeight, cluster.id);
    if (flameMask.heatCoverage <= 0.004) {
      continue;
    }

    context.save();
    context.imageSmoothingEnabled = true;
    context.globalCompositeOperation = "screen";
    context.globalAlpha = clamp(flicker, 0.12, 0.42);
    const feather = Math.max(0.45, viewport.scale * 0.18);
    context.drawImage(flameMask.canvas, drawX, drawY, scaledWidth, scaledHeight);
    context.globalAlpha *= 0.24;
    context.drawImage(flameMask.canvas, drawX - feather, drawY, scaledWidth, scaledHeight);
    context.drawImage(flameMask.canvas, drawX + feather, drawY, scaledWidth, scaledHeight);
    context.drawImage(flameMask.canvas, drawX, drawY - feather, scaledWidth, scaledHeight);
    context.drawImage(flameMask.canvas, drawX, drawY + feather, scaledWidth, scaledHeight);

    context.globalCompositeOperation = "lighter";
    context.globalAlpha = clamp(flicker * 0.2, 0.05, 0.16);
    context.drawImage(flameMask.canvas, drawX, drawY, scaledWidth, scaledHeight);
    context.restore();
  }

  for (const cluster of clusters.values()) {
    const phase = cluster.phase;
    const pulse = 0.88 + Math.sin(timeSeconds * 3.4 + phase * 0.7) * 0.12;
    const clusterScreenX = (cluster.centerX + viewport.offsetX) * viewport.scale;
    const clusterScreenY = (cluster.centerY + viewport.offsetY) * viewport.scale;
    const glowRadius = Math.max(6, cluster.radius * viewport.scale * (0.7 + pulse * 0.25));

    if (
      clusterScreenX < -glowRadius ||
      clusterScreenY < -glowRadius ||
      clusterScreenX > width + glowRadius ||
      clusterScreenY > height + glowRadius
    ) {
      continue;
    }

    context.save();
    context.globalCompositeOperation = "lighter";
    const glow = context.createRadialGradient(clusterScreenX, clusterScreenY, 0, clusterScreenX, clusterScreenY, glowRadius);
    glow.addColorStop(0, "rgba(255, 214, 132, 0.22)");
    glow.addColorStop(0.35, "rgba(255, 168, 80, 0.14)");
    glow.addColorStop(0.7, "rgba(255, 128, 48, 0.06)");
    glow.addColorStop(1, "rgba(255, 98, 28, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(clusterScreenX, clusterScreenY, glowRadius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function getOrCreateFlameRegionMask(
  backgroundImage: HTMLImageElement,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  clusterId: number
): { canvas: HTMLCanvasElement; heatCoverage: number } {
  const normalizedX = Math.floor(sourceX);
  const normalizedY = Math.floor(sourceY);
  const normalizedWidth = Math.max(1, Math.ceil(sourceWidth));
  const normalizedHeight = Math.max(1, Math.ceil(sourceHeight));
  const cacheKey = [
    flameMaskVersion,
    backgroundImage.currentSrc || backgroundImage.src,
    clusterId,
    normalizedX,
    normalizedY,
    normalizedWidth,
    normalizedHeight
  ].join(":");

  const cached = flameRegionMaskCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const canvas = document.createElement("canvas");
  canvas.width = normalizedWidth;
  canvas.height = normalizedHeight;
  const canvasContext = canvas.getContext("2d", { willReadFrequently: true });
  if (!canvasContext) {
    const fallback = { canvas, heatCoverage: 0 };
    flameRegionMaskCache.set(cacheKey, fallback);
    return fallback;
  }

  canvasContext.clearRect(0, 0, normalizedWidth, normalizedHeight);
  canvasContext.drawImage(
    backgroundImage,
    normalizedX,
    normalizedY,
    normalizedWidth,
    normalizedHeight,
    0,
    0,
    normalizedWidth,
    normalizedHeight
  );

  try {
    const sourceImage = canvasContext.getImageData(0, 0, normalizedWidth, normalizedHeight);
    const sourcePixels = sourceImage.data;
    const pixelCount = normalizedWidth * normalizedHeight;
    const heatValues = new Float32Array(pixelCount);

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const pixelOffset = pixelIndex * 4;
      const red = sourcePixels[pixelOffset] / 255;
      const green = sourcePixels[pixelOffset + 1] / 255;
      const blue = sourcePixels[pixelOffset + 2] / 255;
      const alpha = sourcePixels[pixelOffset + 3] / 255;

      const value = Math.max(red, green, blue);
      const minChannel = Math.min(red, green, blue);
      const delta = value - minChannel;
      const saturation = value <= 0 ? 0 : delta / value;
      let hue = 0;
      if (delta > 0.0001) {
        if (value === red) {
          hue = ((green - blue) / delta) % 6;
        } else if (value === green) {
          hue = (blue - red) / delta + 2;
        } else {
          hue = (red - green) / delta + 4;
        }
        hue *= 60;
        if (hue < 0) {
          hue += 360;
        }
      }

      const inFlameHue = hue >= 20 && hue <= 54;
      const warmBalance = red > green * 0.94 && green > blue * 1.16;
      const satGate = saturation > 0.34;
      const brightGate = value > 0.5;
      const potentialCore = hue >= 34 && hue <= 66 && value > 0.8 && saturation > 0.24 && blue < 0.56;

      let heat = 0;
      if ((inFlameHue && warmBalance && satGate && brightGate) || potentialCore) {
        const hueWeight = inFlameHue ? 1 : 0.45;
        const satWeight = clamp((saturation - 0.3) / 0.52, 0, 1);
        const valueWeight = clamp((value - 0.48) / 0.44, 0, 1);
        const orangeBias = clamp((red - blue) / 0.5, 0, 1);
        const yellowBias = clamp((green - blue) / 0.44, 0, 1);
        heat = hueWeight * (satWeight * 0.42 + valueWeight * 0.24 + orangeBias * 0.2 + yellowBias * 0.14);
      }

      if (saturation < 0.24 || value < 0.38) {
        heat *= 0;
      }

      heatValues[pixelIndex] = clamp(heat * alpha, 0, 1);
    }

    let peakHeat = 0;
    for (let index = 0; index < heatValues.length; index += 1) {
      peakHeat = Math.max(peakHeat, heatValues[index]);
    }
    const adaptiveThreshold = clamp(Math.max(0.52, peakHeat * 0.72), 0.52, 0.82);

    const smoothedValues = new Float32Array(pixelCount);
    for (let y = 0; y < normalizedHeight; y += 1) {
      for (let x = 0; x < normalizedWidth; x += 1) {
        const index = y * normalizedWidth + x;
        const north = y > 0 ? heatValues[index - normalizedWidth] : heatValues[index];
        const south = y < normalizedHeight - 1 ? heatValues[index + normalizedWidth] : heatValues[index];
        const west = x > 0 ? heatValues[index - 1] : heatValues[index];
        const east = x < normalizedWidth - 1 ? heatValues[index + 1] : heatValues[index];
        smoothedValues[index] = clamp((heatValues[index] * 6 + north + south + west + east) / 10, 0, 1);
      }
    }

    const seedThreshold = clamp(Math.max(adaptiveThreshold + 0.16, peakHeat * 0.82), 0.62, 0.94);
    const growThreshold = clamp(adaptiveThreshold * 0.9, 0.45, 0.74);
    const connectedMask = new Uint8Array(pixelCount);
    const queue: number[] = [];

    for (let index = 0; index < pixelCount; index += 1) {
      if (smoothedValues[index] >= seedThreshold) {
        connectedMask[index] = 1;
        queue.push(index);
      }
    }

    while (queue.length > 0) {
      const index = queue.pop()!;
      const x = index % normalizedWidth;
      const y = Math.floor(index / normalizedWidth);

      const visit = (nextIndex: number): void => {
        if (connectedMask[nextIndex] === 1) {
          return;
        }
        if (smoothedValues[nextIndex] < growThreshold) {
          return;
        }
        connectedMask[nextIndex] = 1;
        queue.push(nextIndex);
      };

      if (x > 0) visit(index - 1);
      if (x < normalizedWidth - 1) visit(index + 1);
      if (y > 0) visit(index - normalizedWidth);
      if (y < normalizedHeight - 1) visit(index + normalizedWidth);
    }

    const outputImage = canvasContext.createImageData(normalizedWidth, normalizedHeight);
    const outputPixels = outputImage.data;
    let hotPixelCount = 0;

    for (let index = 0; index < pixelCount; index += 1) {
      const connectedHeat = connectedMask[index] === 1 ? smoothedValues[index] : 0;
      const thresholdedHeat =
        connectedHeat > adaptiveThreshold ? clamp((connectedHeat - adaptiveThreshold) / (1 - adaptiveThreshold), 0, 1) : 0;
      const outputOffset = index * 4;

      outputPixels[outputOffset] = 255;
      outputPixels[outputOffset + 1] = Math.round(168 + thresholdedHeat * 82);
      outputPixels[outputOffset + 2] = Math.round(68 + thresholdedHeat * 60);
      outputPixels[outputOffset + 3] = Math.round(clamp(thresholdedHeat * thresholdedHeat * 255 * 1.45, 0, 255));

      if (thresholdedHeat > 0.08) {
        hotPixelCount += 1;
      }
    }

    canvasContext.clearRect(0, 0, normalizedWidth, normalizedHeight);
    canvasContext.putImageData(outputImage, 0, 0);
    const result = {
      canvas,
      heatCoverage: hotPixelCount / Math.max(1, pixelCount)
    };
    flameRegionMaskCache.set(cacheKey, result);
    return result;
  } catch {
    const fallback = { canvas, heatCoverage: 0 };
    flameRegionMaskCache.set(cacheKey, fallback);
    return fallback;
  }
}

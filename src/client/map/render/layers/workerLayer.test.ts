import { describe, expect, it } from "vitest";
import { defaultZoomScale, maxZoomScale } from "../../mapRuntimeConstants";
import { drawWorkerNameplates } from "./workerLayer";

function renderNameplate(viewportScale: number): { fontSize: number; height: number } {
  const rectangles: Array<{ height: number }> = [];
  const textFonts: string[] = [];
  let currentFont = "";
  const context = {
    get font() {
      return currentFont;
    },
    set font(value: string) {
      currentFont = value;
    },
    save() {},
    restore() {},
    measureText(text: string) {
      return { width: text.length * Number.parseFloat(currentFont) * 0.5 } as TextMetrics;
    },
    fillRect(_x: number, _y: number, _width: number, height: number) {
      rectangles.push({ height });
    },
    fillText() {
      textFonts.push(currentFont);
    }
  } as unknown as CanvasRenderingContext2D;

  drawWorkerNameplates(context, [{ anchorX: 100, topY: 80, label: "Agent" }], 0, viewportScale);

  return {
    fontSize: Number.parseFloat(textFonts[0] ?? "0"),
    height: rectangles[0]?.height ?? 0
  };
}

function renderSilencedNameplate(): string[] {
  const rectangleFillStyles: string[] = [];
  let fillStyle = "";
  const context = {
    font: "",
    textAlign: "center",
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyle = typeof value === "string" ? value : "";
    },
    save() {},
    restore() {},
    measureText() {
      return { width: 40 } as TextMetrics;
    },
    fillRect() {
      rectangleFillStyles.push(fillStyle);
    },
    fillText() {}
  } as unknown as CanvasRenderingContext2D;

  drawWorkerNameplates(
    context,
    [{ anchorX: 100, topY: 80, label: "Agent", silenced: true }],
    0,
    defaultZoomScale
  );
  return rectangleFillStyles;
}

describe("drawWorkerNameplates", () => {
  it("keeps worker labels proportional as the map zooms in", () => {
    const defaultLabel = renderNameplate(defaultZoomScale);
    const zoomedLabel = renderNameplate(maxZoomScale);
    const zoomRatio = maxZoomScale / defaultZoomScale;

    expect(defaultLabel).toEqual({ fontSize: 12, height: 18 });
    expect(zoomedLabel.fontSize).toBeCloseTo(defaultLabel.fontSize * zoomRatio, 0);
    expect(zoomedLabel.height).toBeCloseTo(defaultLabel.height * zoomRatio, 5);
  });

  it("uses a subdued bordered name bar for silenced characters", () => {
    expect(renderSilencedNameplate()).toEqual([
      "rgba(19, 29, 30, 0.76)",
      "rgba(129, 162, 157, 0.82)",
      "rgba(129, 162, 157, 0.82)"
    ]);
  });
});

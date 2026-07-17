import { useEffect, useState } from "react";
import type { LoadedOutpostMap } from "../tileMapLoader";

export interface MapPreviewImage {
  mapPreviewImage: HTMLImageElement | undefined;
  mapPreviewLoadError: string | undefined;
}

/** Loads the outpost background image for the current map, tracking load failures. */
export function useMapPreviewImage(mapData: LoadedOutpostMap | undefined): MapPreviewImage {
  const [mapPreviewImage, setMapPreviewImage] = useState<HTMLImageElement | undefined>(undefined);
  const [mapPreviewLoadError, setMapPreviewLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setMapPreviewImage(undefined);
    setMapPreviewLoadError(undefined);

    if (!mapData) {
      return () => {
        cancelled = true;
      };
    }

    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setMapPreviewImage(image);
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setMapPreviewLoadError(`Failed to load map preview image: ${mapData.backgroundImageUrl}`);
      }
    };
    image.src = mapData.backgroundImageUrl;

    return () => {
      cancelled = true;
    };
  }, [mapData]);

  return { mapPreviewImage, mapPreviewLoadError };
}

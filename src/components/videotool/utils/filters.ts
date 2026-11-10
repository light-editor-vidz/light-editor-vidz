import filters from "../../../../crates/video-export/src/filters.json";

export interface FilterDefinition {
  id: string;
  nameEn: string;
  nameFr: string;
  css: string;
  ffmpeg: string;
}

// Shared with the main process (src/shared/filters.json), so the live preview
// and the export are described by the same table.
export const VIDEO_FILTERS: FilterDefinition[] = filters;

export const getFilterById = (id: string) => VIDEO_FILTERS.find((f) => f.id === id) || VIDEO_FILTERS[0];

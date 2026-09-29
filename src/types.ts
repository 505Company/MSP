export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SourceRef = {
  slideIndex: number;
  objectIds: string[];
  box?: Box;
};

export type NormalizedElement = {
  id: string;
  objectId: string;
  objectName: string;
  slideIndex: number;
  kind: "text" | "image" | "shape" | "line" | "group" | "chart" | "table" | "smartArt" | "media" | "unknown";
  semanticRole: "title" | "subtitle" | "body" | "caption" | "label" | "metric" | "logo" | "image" | "icon" | "divider" | "background" | "decoration" | "unknown";
  box: Box;
  textPreview?: string;
  colors: string[];
  typography: TypographyObservation[];
  warnings: string[];
};

export type TypographyObservation = {
  fontFamily: string;
  fontSizePt: number;
  fontWeight: number;
  italic: boolean;
};

export type ProfileResult = {
  profile: Record<string, unknown>;
  summary: {
    slideCount: number;
    objectCount: number;
    objectCounts: Record<string, number>;
    themeNames: string[];
    slides: Array<{
      slideIndex: number;
      objectCount: number;
      kinds: Record<string, number>;
      textSamples: string[];
    }>;
  };
};

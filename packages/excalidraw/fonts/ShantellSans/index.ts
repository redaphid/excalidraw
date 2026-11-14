import {
  FONT_FAMILY,
  getFontVariationSettings,
  GOOGLE_FONTS_RANGES,
} from "@excalidraw/common";

import { type ExcalidrawFontFaceDescriptor } from "../Fonts";

// Shantell Sans 1.011, SIL Open Font License 1.1 (./OFL.txt): one variable
// font with the axes wght, INFM, BNCE and SPAC, Latin only, upright only.
import Latin from "./ShantellSans-Variable-3c8f5f88.woff2";

export const ShantellSansFontFaces: ExcalidrawFontFaceDescriptor[] = [
  {
    uri: Latin,
    descriptors: {
      unicodeRange: GOOGLE_FONTS_RANGES.LATIN,
      // the family's own face is its regular instance; a text with
      // `fontAxes` draws with a face made for its instance (`Fonts`)
      variationSettings: getFontVariationSettings(FONT_FAMILY["Shantell Sans"]),
    },
  },
];

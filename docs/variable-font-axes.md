# Variable font axes on text

A text element in a variable font family can carry axis values, and the canvas renderer, the exporter and text measurement all use that instance of the font.

```ts
{ type: "text", fontFamily: FONT_FAMILY["Shantell Sans"], fontAxes: { wght: 650, BNCE: 40 } }
```

## The data

- `fontAxes?: Readonly<Record<string, number>>` on `ExcalidrawTextElement`, keyed by OpenType axis tag. Absent means the family's regular instance. One element has one instance; a sentence with differently set words is several text elements.
- `FONT_METADATA[family].axes` lists a variable family's axes with `min`, `default` and `max`. `min` and `max` are the font file's `fvar` values (`Fonts.test.ts` reads the shipped woff2 and fails when they drift). `default` is what an absent axis means, the regular instance; for Shantell Sans that is `wght` 400, while the file's own default is 300.
- `normalizeFontAxes` (`packages/common/src/font-axes.ts`) drops tags the family lacks and values that are not finite numbers, clamps the rest to the axis and rounds them to whole units. `restore` and `newTextElement` call it, so elements in a scene hold only values the font has. Whole units keep the instances countable.

## How an instance reaches the canvas

Canvas 2D has no setter for variation axes: `ctx.font` reaches `wght` only, through its weight. So each instance gets its own font faces, registered under a family name derived from the axes, and the font string names that family:

```
96px "Shantell Sans wght650 BNCE40", Shantell Sans, sans-serif, Segoe UI Emoji
```

- `getFontInstanceFamily` gives the name: the family, then each axis off its default, in the registry's axis order. The regular instance is the family itself.
- `getFontString` and `getFontFamilyString` take `fontAxes`, so every caller that passes a text element measures and draws in its instance. The family itself follows in the list, so text shows in the regular instance until the instance's faces load.
- `Fonts.loadSceneFonts` and `Fonts.loadElementsFonts` (which `exportToCanvas` awaits) make a `FontFace` per registered face of the family with the `variationSettings` descriptor naming every axis, add them to `document.fonts` and load them. A document keeps the faces of the 64 instances asked for most recently beyond those the last load needed (`RecentlyUsed`, `MAX_INSTANCE_FACES`) and deletes the rest from `document.fonts`.

Measured in Chromium 153: an instance face draws pixel for pixel what a weight-range face draws at the same `wght`, and `measureText` equals the DOM's width under CSS `font-variation-settings` for `wght`, `INFM`, `BNCE` and `SPAC`. A canvas element's own `font-variation-settings` style also reaches its text, but only while the canvas is in the document, which the measuring canvas is not.

## Base

The branch `feat/variable-font-axes` is based on `v1.9.0` (230142c2), the release draw pins. `v1.9.1` (65589719) exists on `master` and the branch is not rebased onto it. Two of the files this branch changes also changed in v1.9.1, in the same places:

- `packages/common/src/utils.ts`: v1.9.1 replaces `getFontSizeUpscale` with `getFontRenderScale`, directly above `getFontString`.
- `packages/element/src/renderElement.ts`: v1.9.1 rewrites the text drawing block around the `getFontString` call that this branch passes `fontAxes` to.

A rebase keeps both sides in each. v1.9.1 also changes `packages/element/src/textMeasurements.ts` and `packages/excalidraw/wysiwyg/textWysiwyg.tsx`, which this branch does not touch but which measure and edit text, so the checks in this document need running again after it.

Local builds of this branch are versioned `1.9.0-fontaxes.N`, so a tarball of it cannot be taken for a release. The version is stamped at build time by draw's `bench/hillclimb/build-fork.mjs` and never committed here.

## Not done yet

- SVG export: `generateFontFaceDeclarations` inlines the family's file but writes no `font-variation-settings`, so an exported SVG shows the regular instance.
- The text editor (`textWysiwyg`) shows the regular instance while a text is edited.
- No UI sets `fontAxes`.
- Shantell Sans ships upright and Latin only (no `ital` axis). Its license, `OFL.txt`, sits beside the font in the source tree and is not copied into `dist`.
- Firefox and Safari are unverified.

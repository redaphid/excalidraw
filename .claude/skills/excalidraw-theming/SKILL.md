---
name: excalidraw-theming
description: This skill should be used when writing or fixing a theme for this Excalidraw fork's `css` prop, or when asked to "make an Excalidraw theme", "restyle the editor", "theme the canvas", "change the grid", "make the pen look like X", "fix contrast in the color picker", "add a theme to the playground", or "shoot the theme screenshots". Covers which custom properties matter, contrast rules on themed backgrounds, grid design, dark-mode color limits, pitfalls found the hard way, and the screenshot, inspect and fix loop.
---

# Excalidraw theming

A theme is one CSS string passed to `<Excalidraw css={...}>`. It restyles the DOM UI like any stylesheet, and it sets custom properties that the editor reads to paint the canvas and to choose defaults for new elements. The full variable reference is `docs/theming.md`. Read it before writing a theme. This skill covers how to make a theme good.

Sample themes live in `playground/themes/*.css`. Copy the closest one rather than starting empty. The first line of each file is `/* Name. mode: light|dark */`. The playground reads it to set the editor's theme prop.

## The loop

Treat a theme as unfinished until its screenshots are read.

1. Write or edit `playground/themes/<id>.css`.
2. Shoot it:
   ```sh
   node scripts/theme-screenshots/shoot.mjs --themes <id> --out theme-screenshots/dev
   ```
   Add `--viewports desktop` for a fast first look, `--states pen` for the pen, `--video` for a live pen recording, and `--browser firefox` or `--browser webkit` for a cross-engine check.
3. Read every PNG it printed: canvas, selected, colorpicker, menu, dialog, pen, penzoom, at desktop, tablet and phone.
4. List what is ugly, broken or unreadable. Fix the biggest problem first, in the theme or in the library.
5. Shoot again into a new folder (`pass2`, `pass3`) so passes can be compared.

Never edit sources while a shoot runs if the harness server watches files. The harness disables HMR and watching for this reason. A reload mid-run destroys the page and kills the pass.

A scripted pen stroke sent right after `setActiveTool` can arrive before the tool commits and turn into a selection drag. The harness waits for the tool and throws if a stroke is missing. Keep that check: in pass 1 the Westworld Night close-up was missing its first stroke, and it looked like a rendering bug.

Build a contact sheet per pass with the harness's `--contact selected`. At thumbnail size, twins show: four bead themes were indistinguishable there, and one was cut.

## Selectors: use `:scope`

The editor wraps the CSS in `@scope ([data-excalidraw-id="…"])`. Inside `@scope`, a plain selector is a descendant of the scope root, so `.excalidraw { … }` never matches the editor root. Set variables on `:scope`.

The editor's dark-mode variables sit on `.excalidraw.theme--dark`, which outranks `:scope`. Set variables on both so the theme holds in either mode:

```css
:scope,
:scope.theme--dark { … }
```

Prefix every component rule with `:scope `. The library writes `.excalidraw .frame-breadcrumb`, which is (0,2,0). A bare `.frame-breadcrumb` inside `@scope` is (0,1,0) and loses without any warning. In pass 1 every component override in every theme lost this way, and nothing looked broken until the screenshots were compared with the CSS.

The properties panel's headings are `.selected-shape-actions h3` and `.selected-shape-actions legend`. Check class names in `packages/excalidraw/components` before guessing: `.panelColumn` does not exist.

`@font-face` and `@import` are invalid inside `@scope`. Use the bundled fonts (`Liberation Sans`, `Cascadia`, `Nunito`, `Excalifont`, `Virgil`, `Lilita One`, `Comic Shanns`, `Assistant`) or system fonts.

## Variables that carry a theme

Set these first. They cover most of the visible surface:

- Canvas: `--canvas-background`, `--canvas-grid-color`, `--canvas-grid-bold-color`, `--canvas-grid-style`, `--color-selection`, `--canvas-frame-color`, `--canvas-frame-width`.
- Stroke character: `--element-stroke-width`, `--element-roughness`, `--element-roundness`, `--element-font-family`, `--element-end-arrowhead`, `--element-arrow-type`, `--element-freedraw-variability`, `--element-freedraw-width`.
- Swatches: `--color-picks-stroke`, `--color-picks-background`, `--color-palette-stroke`, `--color-palette-background`.
- UI: `--ui-font`, `--island-bg-color`, `--text-primary-color`, `--color-primary`, `--color-surface-primary-container` (selected tool), `--button-hover-bg`, `--default-border-color`, `--border-radius-lg`, `--shadow-island`, `--modal-shadow`, `--overlay-bg-color`.

`--button-gray-1`, `--button-gray-2` and `--button-gray-3` fill every panel button. Keep them close to the panel color. Brutalist pass 1 set them to the hover accent, and every button in the panel turned acid yellow.

## Stroke character is half the theme

Colors alone leave the default blunt whiteboard look: medium strokes, rough.js wobble, round corners, a hand-drawn font, fat arrowheads and a marker pen. Decide each one for the theme's instrument:

| Instrument | width | roughness | roundness | font | arrowhead | freedraw (variability, width, thinning, taper) |
| --- | --- | --- | --- | --- | --- | --- |
| Technical pen (drafting) | `thin` | `0` | `sharp` | `Liberation Sans` | `arrow` or `bar` | `variable`, `0.2`, `0.2`, `4` |
| CAD trace | `thin` | `0` | `sharp` | `Cascadia` | `triangle` | `constant`, `0.2` |
| Pencil (sketchbook) | `medium` | `2` | `round` | `Excalifont` | `arrow` | `variable`, `0.35`, `0.75`, `6` |
| Marker (brutalist) | `bold` | `0` | `sharp` | `Cascadia` | `triangle` | `constant`, `2.5` |
| Phosphor trace (terminal) | `thin` | `0` | `sharp` | `Cascadia` | `arrow` | `constant`, `0.35` |
| Neon tube (synthwave) | `medium` | `0` | `round` | `Nunito` | `arrow` | `constant`, `1.1` |

Freedraw widths are small numbers on the fork's scale: `0.2` is a hairline, `1` is about 3 px, `2.5` is a fat marker. A `constant` pen ignores pressure. Pick `variable` whenever pressure should show, and control how much with thinning.

Judge the pen at 2.5x (`penzoom`), not at 100%. In pass 1, fifteen of nineteen themes drew the same thin even hairline, and the 100% shots hid it.

`triangle` heads are heavy next to thin strokes. Use `arrow` for slender drafting heads.

Line caps and joins are fixed (round). Do not promise a theme butt caps.

## Contrast and legibility

- Text on a fill uses the element's stroke color. Keep background washes pale (the picker's shade 1) so ink text stays readable. A mid-tone fill under ink text fails. E-ink pass 1 put text on a black fill.
- The picker grid shows shade 4 of each stroke entry and shade 1 of each background entry when nothing is selected. Put the ink at index 4 and the wash at index 1.
- A palette entry the same color as the panel disappears from the grid. Every entry needs contrast against `--island-bg-color`.
- Popovers, the color picker and dialogs use `--island-bg-color` and `--popup-bg-color`. On a dark canvas, check the menu and help dialog: dialog text uses `--text-primary-color`, and secondary text uses `--color-gray-60` and `--keybinding-color`.
- The canvas-background swatch in the main menu shows the scene's own background. Check the menu state for a mismatch with the painted canvas.

## Dark themes and the element filter

In dark mode the editor shows element colors through a lightness-inverting filter, so the scene stays portable between modes. For a dark theme:

- Write element and palette colors as their light-mode equivalents. Black ink displays near-white.
- The filter can't display saturated light colors. Displayed white tops out at `#ededed`. Bright yellow is impossible, and cyan becomes a muted teal. Magenta, orange and violet survive.
- To get the stored color for a color you want displayed, use `removeDarkModeFilter` from `@excalidraw/common`. `theme-screenshots/tools/palette.ts` wraps it for whole palettes (run it with `npx vite-node -c playground/vite.config.mts`).
- Canvas, grid and UI colors are never filtered. Put the neon there.

## The grid carries the theme

- Graph paper: `--canvas-grid-style: solid`, minor lines at about 0.15 to 0.2 alpha and major lines at about 0.45 in one hue. Majors fall every `gridStep` (5) lines.
- Ruled notebook: the same color for both levels.
- Quiet: minor alpha 0 and a faint major only.
- In the fork's screen-unit authoring, the grid steps to the next power of `gridStep` below 100% zoom. Judge a graph-paper grid at exactly 100%, where the minor step is 20.

## Restraint: structural, not decorative

For drafting, architectural and museum-style themes, every element on screen must do a job. In each pass, ask of every screenshot: "is anything here decorative rather than structural?" Remove it if so.

No paper textures, grain, stains, vignettes, aged edges or "old map" effects. The parchment is a flat, warm off-white. The sophistication comes from an exact limited palette, thin precise graphite lines, a faint graph-paper grid, generous space and crisp type. The user rejected the cheesy version before seeing it. Hold every theme in this family to "would this look at home in a high-prestige title sequence?"

## Performance

The editor reads the custom properties only on mount, scene load, `css` change and theme change. A theme adds no work per frame. The CSS can still be slow:

- No `backdrop-filter` over the canvas: it re-blurs on every repaint. Glass gets its frost from translucency and a bright edge.
- No animated gradients or animated shadows.
- A static gradient behind a transparent canvas (`--canvas-background: transparent` plus a `background` on `:scope`) is free.

`node scripts/theme-screenshots/bench.mjs --theme <id>` pans and zooms a 2,000-element scene and reports frame times, `getComputedStyle` calls and canvas creations. The last two must match the run without `--theme`.

## Cross-engine checks

The editor needs `@scope` (Chrome 118, Safari 17.4, Firefox 146). An older browser gets the CSS unscoped, with `:scope` rewritten to the root's attribute selector. Avoid features that fail silently in one engine:

- Safe: custom properties, `linear-gradient`, `radial-gradient`, `box-shadow`, `outline`, `letter-spacing`, `text-transform`.
- `color-mix()`: Firefox 113 and later, Safari 16.2 and later. Fine, but a fallback color is cheap insurance.
- `:has()`: Firefox 121 and later. Do not make a theme depend on it.
- `backdrop-filter`: avoid for performance, as above.

Shoot one state per theme in Firefox and WebKit with `--browser`.

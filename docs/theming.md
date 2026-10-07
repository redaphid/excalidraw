# Theming the editor with CSS

The fork's `<Excalidraw>` takes a `css` prop: a stylesheet for that editor. It can restyle any part of the UI, and it can set custom properties that the editor reads to paint its canvas and to pick the defaults for new elements. With no `css`, the editor renders exactly as before.

![The same scene in twelve of the sample themes](theming/contact-desktop.png)

## Theme an editor

Pass the CSS as a string. `:scope` is the editor.

```tsx
import { Excalidraw } from "@excalidraw/excalidraw";
import drafting from "./drafting.css?raw";

<Excalidraw css={drafting} theme="light" />;
```

```css
:scope {
  /* the canvas */
  --canvas-background: #ebe4d6;
  --canvas-grid-color: rgba(84, 118, 145, 0.2);
  --canvas-grid-bold-color: rgba(84, 118, 145, 0.48);
  --canvas-grid-style: solid;

  /* new elements */
  --element-stroke-width: thin;
  --element-roughness: 0;
  --element-roundness: sharp;
  --element-font-family: "Liberation Sans";
  --element-end-arrowhead: arrow;

  /* the UI, through the editor's own variables */
  --island-bg-color: #f1ebdf;
  --color-primary: #1b2129;
  --border-radius-lg: 2px;
}

:scope .frame-breadcrumb {
  border-radius: 2px;
}
```

The sample themes in [`playground/themes`](../playground/themes) are complete examples. Run the playground (`yarn build:playground`, or the screenshot harness below) and pick one from the theme menu at the top right.

## How the css prop is applied

The editor renders the CSS in a `<style>` element inside its root, wrapped in `@scope`. The root and each of the editor's portals (modals render into `document.body`) carry `data-excalidraw-id`, and each is a scope root:

```css
@scope ([data-excalidraw-id="…"]) {
  /* your css */
}
```

So:

- `:scope` matches the editor root and each portal root. Set custom properties there.
- Plain selectors such as `.frame-breadcrumb` match inside this editor only. A second editor on the page is not affected.
- The library writes its component rules as `.excalidraw .frame-breadcrumb`. Inside `@scope`, a bare `.frame-breadcrumb` is less specific and loses. Write `:scope .frame-breadcrumb`: it ties, and the theme wins because it comes later.
- A selector that starts above the editor, such as `body .excalidraw`, matches nothing.
- `@import` and `@font-face` are not allowed inside `@scope`. Load fonts in the host page.
- In a browser without `@scope` support, the editor inserts the CSS unscoped and replaces `:scope` with the root's attribute selector.

The editor's own stylesheet sets its variables on `.excalidraw` and, for dark mode, on `.excalidraw.theme--dark`. The second selector is more specific than `:scope`, so a theme that must hold in dark mode sets its variables on both:

```css
:scope,
:scope.theme--dark {
  --island-bg-color: #0c3160;
}
```

## What the editor reads, and when

Most of the editor is DOM, and the `css` prop styles it like any stylesheet. The canvases are painted in JavaScript, so the editor reads a fixed set of custom properties from its root with `getComputedStyle`:

- when it mounts,
- when the scene finishes loading,
- when the `css` prop changes,
- when the theme switches between light and dark.

It parses them once into a plain object and keeps that object until a read finds a different value. The renderers use the object. Nothing is read per frame, per element, or on scroll or zoom, and a theme does not invalidate the element bitmap caches.

Two groups of properties are read:

- **Canvas colors** repaint the canvases: background, grid, selection, handles and frames.
- **New-element defaults** are written to `appState` (`currentItemStrokeWidthKey`, `currentItemRoughness`, and the rest). The toolbar and the properties panel start on them, and new elements take them. Elements already in the scene keep their own style.

New-element defaults are written when they differ from the last read. A light and dark toggle that changes nothing keeps the picks the user made since. When the scene loads, the defaults are written again, because loading restores `appState`.

A value the editor can't parse is ignored, and the built-in value stays.

## Custom properties

### Canvas

| Property | Value | Default |
| --- | --- | --- |
| `--canvas-background` | any CSS color, or `transparent` to show the root's own `background` | the scene's `viewBackgroundColor` |
| `--canvas-grid-color` | any CSS color | `#e5e5e5` |
| `--canvas-grid-bold-color` | any CSS color, for every `gridStep`th line | `#dddddd` |
| `--canvas-grid-style` | `dashed` or `solid` minor lines | `dashed` |
| `--color-selection` | any CSS color: selection outlines, handles, lasso | `#6965db` |
| `--canvas-handle-fill` | any CSS color: inside of the resize handles | `#ffffff` |
| `--canvas-frame-color` | any CSS color | `#bbbbbb` |
| `--canvas-frame-width` | outline width in screen pixels | `2` |
| `--canvas-frame-name-color` | any CSS color (frame names are DOM) | `#999999` |

`--canvas-background` replaces only the default white background. When the user picks another canvas background, the editor paints that one. Exports never use theme colors.

Theme colors are painted as written in both light and dark mode. The dark-mode filter does not apply to them.

### New elements

| Property | Values | Sets |
| --- | --- | --- |
| `--element-stroke-color` | hex color | `currentItemStrokeColor` |
| `--element-background-color` | hex color or `transparent` | `currentItemBackgroundColor` |
| `--element-fill-style` | `hachure`, `cross-hatch`, `solid`, `zigzag` | `currentItemFillStyle` |
| `--element-stroke-width` | `thin` (1), `medium` (2), `bold` (4) | `currentItemStrokeWidthKey` |
| `--element-stroke-style` | `solid`, `dashed`, `dotted` | `currentItemStrokeStyle` |
| `--element-roughness` | `0` (architect), `1` (artist), `2` (cartoonist) | `currentItemRoughness` |
| `--element-roundness` | `round`, `sharp` | `currentItemRoundness` |
| `--element-font-family` | a font name from `FONT_FAMILY` or its number | `currentItemFontFamily` |
| `--element-font-size` | a positive number | `currentItemFontSize` |
| `--element-start-arrowhead`, `--element-end-arrowhead` | an `Arrowhead` name, or `none` | `currentItemStartArrowhead`, `currentItemEndArrowhead` |
| `--element-arrow-type` | `sharp`, `round`, `elbow` | `currentItemArrowType` |
| `--element-freedraw-variability` | `variable` (pressure and taper) or `constant` (an even line) | `currentItemStrokeVariability` |
| `--element-freedraw-width` | a positive number, the pen size | `currentItemFreedrawStrokeWidth` |
| `--element-freedraw-thinning` | `-1` to `1`: how much pressure narrows a `variable` stroke (default `0.6`) | `strokeOptions.thinning` on new strokes |
| `--element-freedraw-taper` | a positive number: how far each end of a `variable` stroke tapers, in stroke widths | `strokeOptions.taper` on new strokes |

Element colors are stored in the scene, so they must be hex.

Thinning and taper are stored on each new freedraw stroke, so a stroke keeps its look in any theme. A stroke without them renders as before, and loading a scene adds neither.

The font names are `Excalifont`, `Virgil`, `Nunito`, `Lilita One`, `Comic Shanns`, `Liberation Sans`, `Cascadia`, `Assistant` and `Helvetica`. The editor bundles all of them except `Helvetica`, which is the system font, so the UI can use them in `--ui-font` too.

### Color picker

| Property | Value |
| --- | --- |
| `--color-picks-stroke`, `--color-picks-background` | up to five hex colors: the quick swatches in the properties panel |
| `--color-palette-stroke`, `--color-palette-background` | comma-separated entries, each one hex color or five shades from lightest to darkest: the picker's palette grid |

The picks are written to `appState.colorTopPicks`, so a user's own pins replace them in the same way. The hex input still accepts any color.

When the picker opens with nothing selected, it shows shade 4 of each stroke entry and shade 1 of each background entry. Put the ink at index 4 and a pale wash at index 1.

### UI

The UI reads the editor's existing variables, defined in [`packages/excalidraw/css/theme.scss`](../packages/excalidraw/css/theme.scss). These carry most of a theme:

| Variable | Used for |
| --- | --- |
| `--ui-font` | every UI label |
| `--island-bg-color`, `--popup-bg-color`, `--sidebar-bg-color` | panels, toolbars, popovers, sidebars |
| `--text-primary-color`, `--color-on-surface`, `--icon-fill-color` | text and icons |
| `--color-primary` and its `-darker`, `-darkest`, `-hover`, `-light` variants | the brand color: active tool, sliders, links |
| `--color-surface-primary-container`, `--color-on-primary-container` | the selected tool and option |
| `--button-hover-bg`, `--button-active-bg`, `--color-surface-high` | button states |
| `--default-border-color`, `--dialog-border-color`, `--input-border-color` | borders |
| `--border-radius-md`, `--border-radius-lg` | corners |
| `--shadow-island`, `--modal-shadow`, `--sidebar-shadow` | panel and dialog edges |
| `--overlay-bg-color` | the backdrop behind dialogs |
| `--keybinding-color`, `--color-gray-60` | secondary text |

Anything else is a selector away: the `css` prop is a stylesheet, so `.frame-breadcrumb`, `.Island` or `.ToolIcon__icon` can be restyled directly.

## Dark themes

In dark mode the editor displays element colors through a filter: it inverts lightness and keeps hue. So a scene looks right in both modes, and a theme's element colors follow the same rule:

- Write `--element-*` and palette colors as the light-mode color. Black ink displays as near-white.
- The filter can't display saturated light colors. Displayed white tops out at `#ededed`. A stored color that displays as bright yellow does not exist, and cyan comes out a muted teal. Magenta, orange and violet survive.
- Canvas and UI colors are not filtered. A neon grid on a dark canvas is fine.

`removeDarkModeFilter` from `@excalidraw/common` turns a color you want to see in dark mode into the color to store.

## Recipes

### Graph paper

Draw both grid levels solid, with the minor lines faint:

```css
:scope {
  --canvas-grid-style: solid;
  --canvas-grid-color: rgba(84, 118, 145, 0.2);
  --canvas-grid-bold-color: rgba(84, 118, 145, 0.48);
}
```

The bold line falls on every `gridStep`th line (5 by default). The grid shows only while grid mode is on.

### A drafting pen

```css
:scope {
  --element-stroke-width: thin;
  --element-roughness: 0;
  --element-roundness: sharp;
  --element-arrow-type: sharp;
  --element-end-arrowhead: arrow;
  --element-freedraw-variability: variable;
  --element-freedraw-width: 0.2;
  --element-freedraw-thinning: 0.2;
  --element-freedraw-taper: 4;
}
```

A low `thinning` keeps the line even under pressure, and a short taper finishes each stroke like an ink pen lifting. A pencil wants the opposite: `thinning: 0.75` and `taper: 6`. A marker is `constant` with a large width.

### A gradient behind the canvas

Make the canvas transparent and give the root a background. The browser composites the canvas over it, so it costs nothing per frame:

```css
:scope {
  --canvas-background: transparent;
  background: linear-gradient(105deg, #f1e3c8, #dfe3e2);
}
```

## What a theme can't change

- **Line caps and joins.** Shapes and lines are drawn with round caps and joins, baked into each element's cached bitmap. At a 1 px stroke the difference is under a pixel. Changing it would mean keying the bitmap cache on the theme.
- **New fonts on the canvas.** Elements use the bundled fonts listed above. Registering a new canvas font is a separate feature.
- **New arrowhead shapes.** The theme picks among the existing `Arrowhead` values.
- **Freedraw caps and glow.** A theme sets the pen's width, pressure response and taper. Stroke ends stay round, and there is no glow or blur.
- **Exports.** PNG and SVG exports use the scene's colors, never the theme's.

## Performance

A theme adds no work per frame. The custom properties are read only at the moments listed above, and the renderers get the parsed object by reference.

The CSS itself can still be slow. `backdrop-filter` over the canvas re-blurs on every repaint, and a large animated gradient repaints the screen. The sample Glass theme gets its frosted look from translucency and a bright edge, not from a blur.

## Screenshots

[`scripts/theme-screenshots/shoot.mjs`](../scripts/theme-screenshots/shoot.mjs) drives the playground with Playwright and shoots every theme at desktop, tablet and phone sizes, in six states, including pen strokes drawn with real pressure:

```sh
node scripts/theme-screenshots/shoot.mjs --out theme-screenshots/shots --video --contact selected
node scripts/theme-screenshots/shoot.mjs --themes swiss --viewports phone --states menu
```

It uses the browsers already installed under `ms-playwright`. It downloads nothing.

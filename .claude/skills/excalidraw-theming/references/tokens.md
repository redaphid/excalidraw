# Theme tokens

A theme's tokens are a W3C design tokens document (Design Tokens Format Module 2025.10, https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/), saved as `<name>.tokens.json`. `generateThemeCss(tokens)` from `@excalidraw/common` returns `{ css, warnings }`. It is pure (no DOM, no Node built-ins, no editor code), so a server, a Worker or an MCP tool can call it.

`THEME_TOKENS_SCHEMA` is the profile's JSON Schema. `yarn theme:gen --schema` writes it to `packages/excalidraw/themes/tokens.schema.json`, and token files point at it with `"$schema": "./tokens.schema.json"`. In the repo, `yarn theme:gen <id>` reads `packages/excalidraw/themes/<id>.tokens.json` and writes `<id>.css` beside it.

## Standard tokens

Colors are 2025.10 color objects, `{ "colorSpace": "srgb", "components": [r, g, b], "hex": "#rrggbb" }` with components from 0 to 1. Write them as the user should see them in either mode. Put `"$type": "color"` on the `color` group and every color inherits it. Any token can be an alias, `{ "$value": "{color.accent}" }`.

| Path | `$type` | Meaning | Becomes |
| --- | --- | --- | --- |
| `color.canvas` | `color` | the drawing surface | `--canvas-background`, the base of every derived surface |
| `color.ink` | `color` | the main line and text color | element stroke default, UI text (nudged to 7:1 on panels and canvas) |
| `color.accent` | `color` | the color for anything live | selection, handles, focus; mixed into the selected-tool background |
| `color.panel`, `color.active` | `color` | optional panel and selected-state colors | derived from canvas and accent when absent |
| `color.grid` | `color` | grid lines | defaults to the ink |
| `color.palette.<name>` | `color` | 4 to 12 element colors besides ink, in document order | stroke and fill palettes with 5 shades each, quick swatches |
| `font.ui` | `fontFamily` | UI font, or a fallback list | `--ui-font` |
| `font.canvas` | `fontFamily` | the font new text is drawn in, one the editor has | element font family |
| `font.size` | `dimension` | `{ "value": 16, "unit": "px" }` | element font size |
| `grid.minor`, `grid.major` | `number` | grid line alpha, 0 to 1 | the canvas grid |
| `grid.style` | `strokeStyle` | `solid` or `dashed` | the minor lines |
| `stroke.roughness` | `number` | 0, 1 or 2 | new-element roughness |
| `pen.width` | `number` | freedraw width, at most 4 | new freedraw strokes |
| `pen.thinning`, `pen.taper`, `pen.streamline` | `number` | optional: pressure thinning -1 to 1, taper in stroke widths, smoothing 0 to 1 | new freedraw strokes |
| `surface.radius` | `dimension` | panel corner radius | panels, popovers, dialogs |
| `frame.width`, `frame.alpha` | `dimension`, `number` | outline width, alpha of ink | frame outlines |

The root `$description` is one or two sentences on the look. It becomes the CSS header comment.

## The extension

Choices that are this editor's own live in `$extensions["com.hypnodroid.draw"]`. Each one is optional.

| Field | Values | Default |
| --- | --- | --- |
| `name` | display name, for the CSS header and the playground menu | `Design tokens` |
| `mode` | `light` or `dark` | dark when the canvas is dark |
| `stroke.width` | `thin`, `medium`, `bold` | `medium` |
| `stroke.roundness` | `sharp`, `round` | `round` |
| `stroke.arrowhead` | `arrow`, `bar`, `circle`, `triangle`, `diamond`, and their `_outline` forms | `arrow` |
| `stroke.arrowType` | `sharp`, `round` | `round` |
| `stroke.fill` | `solid`, `hachure`, `cross-hatch`, `zigzag` | `solid` |
| `pen.pressure` | `true` for a pressure pen, `false` for constant width | `true` |
| `surface.border` | `none`, `hairline`, `bold` | `hairline` |
| `surface.shadow` | `none`, `soft`, `long`, `hard` | `soft` |
| `washes` | four `color.palette` token names for the background swatches | the first four |
| `backdrop` | a CSS background; paints the canvas transparent and puts this behind it | none |
| `extra` | CSS appended verbatim; prefix each selector with `:scope ` | none |

## A designer's export

A file a designer exported, without this profile, still makes a theme. A missing role is looked up by name: `background`, `bg` or `paper` for the canvas, `text` or `foreground` for the ink, `primary` or `brand` for the accent, a `body` or `sans` font family or a `typography` token for the fonts. The file's other colors become the palette, in order, minus the canvas and ink. Each of those decisions is a warning, so read them.

## What the generator derives

- **Panel**: `color.panel`, or the canvas mixed 35% toward white (4% for dark themes). Inputs, hover and borders step from it toward the ink.
- **Selected state**: `color.active`, or the panel mixed with the accent. Its icon color is nudged to 4.5:1. The help dialog's keycaps get a text color that reads on it.
- **Secondary text**: the ink mixed into the panel, nudged to 4.5:1.
- **Shade ramps**: each hue stepped toward the canvas. Stroke entries put the hue at shade 4, the one the picker shows. Fill entries put a wash at shade 1, paled until ink labels on it reach 4.5:1.
- **Swatches**: the ink and the first four palette colors for strokes; transparent and the four `washes` for backgrounds.
- **Dark themes**: every element color is stored as `removeDarkModeFilter(color)`, so dark mode displays it as written, and contrast is checked on the displayed round trip.
- **Popovers**: always the opaque panel color.

## Warnings

Each warning is `{ token, from, to, reason }`, and `token` is the DTCG path behind it: `color.ink`, `color.accent`, `color.active`, `color.palette.sage`, or `$extensions["com.hypnodroid.draw"].mode`. For a color it moved, `from` and `to` are the colors before and after, and `reason` names the surface it failed on and the ratio it needed. The reader also warns about values it could not read, roles it found by name and roles it filled with defaults. Colors the generator derives itself, such as secondary text, are fixed silently.

## When to hand-edit instead

Some themes are mostly selectors: Windows 95's bevels, Risograph's off-register shadows, Sketchbook's wobbly panel corners. Put those rules in `extra`. When a theme needs control the tokens can't express, edit its CSS by hand, delete its token file, and set `generated` to false in `themes/index.json`, so the generator never overwrites the hand edits.

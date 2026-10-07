# Theme tokens

Tokens are plain JSON. `generateThemeCss(tokens)` from `@excalidraw/common` returns `{ css, warnings }`. It is pure (no DOM, no Node built-ins, no editor code), so a server or an MCP tool can call it. `THEME_TOKENS_SCHEMA` is the JSON Schema; `yarn theme:gen --schema` writes it to `playground/themes/tokens/schema.json`, and token files point at it with `"$schema": "./schema.json"`. In the repo, `yarn theme:gen <id>` reads `playground/themes/tokens/<id>.json` and writes `playground/themes/<id>.css`.

Every color is a 6-digit hex, written as the user should see it in either mode.

| Token | Meaning | Becomes |
| --- | --- | --- |
| `name` | display name | the CSS header and the playground menu |
| `mode` | `light` or `dark` | the editor's theme while this CSS is active |
| `description` | one or two sentences on the look | the CSS header comment |
| `canvas` | the drawing surface | `--canvas-background`, the base of every derived surface |
| `ink` | the main line and text color | element stroke default, UI text (nudged to 7:1 on panels and canvas) |
| `accent` | the color for anything live | selection, handles, focus; mixed into the selected-tool background |
| `palette` | 4 to 8 element colors besides ink | stroke and fill palettes with 5 shades each, quick swatches |
| `washes` | indexes into `palette` for the 4 background swatches | default `[0, 1, 2, 3]` |
| `grid` | `color`, `minor` and `major` alpha, `style` (`solid` or `dashed`) | the canvas grid |
| `type` | `ui` font, `canvas` font, `size` | `--ui-font`, element font family and size |
| `stroke` | `width`, `roughness`, `roundness`, `arrowhead`, `arrowType`, `fill` | new-element defaults |
| `pen` | `pressure` (bool), `width`, optional `thinning`, `taper`, `streamline` | freedraw defaults |
| `surface` | `radius`, `border` (`none`, `hairline`, `bold`), `shadow` (`none`, `soft`, `long`, `hard`), optional `panel`, `active` | panels, popovers, dialogs, selected states |
| `frame` | `width` in px, `alpha` of ink | frame outlines |
| `backdrop` | optional CSS background | paints the canvas transparent and puts this behind it |
| `extra` | optional CSS, appended verbatim | component rules; prefix each selector with `:scope ` |

## What the generator derives

- **Panel**: `surface.panel`, or the canvas mixed 35% toward white (4% for dark themes). Inputs, hover and borders step from it toward the ink.
- **Selected state**: `surface.active`, or the panel mixed with the accent. Its icon color is nudged to 4.5:1. The help dialog's keycaps get a text color that reads on it.
- **Secondary text**: the ink mixed into the panel, nudged to 4.5:1.
- **Shade ramps**: each hue stepped toward the canvas. Stroke entries put the hue at shade 4, the one the picker shows. Fill entries put a wash at shade 1, paled until ink labels on it reach 4.5:1.
- **Swatches**: the ink and the first four palette colors for strokes; transparent and the four `washes` for backgrounds.
- **Dark themes**: every element color is stored as `removeDarkModeFilter(color)`, so dark mode displays it as written, and contrast is checked on the displayed round trip.
- **Popovers**: always the opaque panel color.

## Warnings

Each warning is `{ token, from, to, reason }`: `token` names what caused it (`ink`, `accent`, `surface.active`, `palette[2]`), `from` and `to` are the colors before and after, and `reason` says which surface it failed on and the ratio it needed. Colors the generator derives itself, such as secondary text, are fixed silently.

## When to hand-edit instead

Some themes are mostly selectors: Windows 95's bevels, Risograph's off-register shadows, Sketchbook's wobbly panel corners. Put those rules in `extra`. When a theme needs control the tokens can't express, edit its CSS by hand and delete its token file, so the generator never overwrites the hand edits.

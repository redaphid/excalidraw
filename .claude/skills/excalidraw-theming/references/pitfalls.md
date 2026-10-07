# Pitfalls found the hard way

Each of these cost a pass. The generator handles the ones marked (gen); the rest need care in `extra` or in hand-written CSS.

## Selectors

- Inside `@scope`, a plain selector is a descendant of the scope root, so `.excalidraw { … }` never matches the editor root. Set variables on `:scope`.
- The editor's dark-mode variables sit on `.excalidraw.theme--dark`, which outranks `:scope`. Set variables on `:scope, :scope.theme--dark`. (gen)
- Prefix every component rule with `:scope `. The library writes `.excalidraw .frame-breadcrumb` (0,2,0); a bare `.frame-breadcrumb` inside `@scope` is (0,1,0) and loses silently. In pass 1 every component override in every theme lost this way.
- Look up class names in `packages/excalidraw/components` before guessing. The properties panel's headings are `.selected-shape-actions h3` and `.selected-shape-actions legend`. `.panelColumn` does not exist.
- `@font-face` and `@import` are invalid inside `@scope`. Use the bundled fonts (`Liberation Sans`, `Cascadia`, `Nunito`, `Excalifont`, `Virgil`, `Lilita One`, `Comic Shanns`, `Assistant`) or system fonts.

## Surfaces and legibility

- `--button-gray-1` and `--button-gray-2` fill every panel button. Brutalist pass 1 set them to the hover accent and every button turned acid yellow. (gen)
- The help dialog's keycaps sit on `--color-primary-light` with inherited text. High Contrast's keycaps were white on yellow, Swiss's and E-ink's black on black. (gen)
- Popovers are an `.Island` inside `[data-radix-popper-content-wrapper]` and take `--island-bg-color`, not `--popup-bg-color`. A translucent island let Glass's scene read through the palette. (gen)
- Never write `animation: none`. Dialogs fade in from opacity 0 with `animation-fill-mode: forwards`, so E-ink's help dialog vanished. Write `animation-duration: 0s` and `transition-duration: 0s`.
- Labels on a fill take the element's ink. A mid-tone wash under dark ink fails; E-ink pass 1 put text on a black fill. (gen)
- A palette entry the same color as the panel disappears from the picker grid.
- The hint under the toolbar uses `--color-gray-40` on the canvas, not a panel; on any canvas darker than near-white it vanished. (gen)
- On a mid-tone canvas, fill washes (about 32% hue) turn gray. The Cel theme needed deeper, more saturated palette hues than its reference's fills.

## Color

- A dark canvas in light mode hides ink drawn under other themes on a shared board. Use dark mode; the generator warns on `mode` otherwise.

- Dark mode's element filter can't display saturated light colors: white tops out at `#ededed`, bright yellow is impossible, cyan turns teal, and the brightest green is `#6fc76f`. Magenta, orange and violet survive. Canvas, grid and UI colors are never filtered.
- The picker grid shows shade 4 of stroke entries and shade 1 of background entries when nothing is selected. (gen)

## Pen and grid

- Judge the pen at 2.5x. In pass 1, fifteen of nineteen themes drew the same thin even hairline, and the 100% shots hid it.
- `triangle` heads are heavy next to thin strokes. Use `arrow` for drafting.
- Line caps and joins on shapes are fixed (round). Do not promise a theme butt caps.
- A stylus's first touch used to switch the pen to variable width, so a theme's constant marker swelled after one stroke. The editor now keeps the theme's choice; if a pen shot shows a constant pen swelling, that fix regressed.
- Below 100% zoom the fork's grid steps to the next power of `gridStep`. Judge graph paper at exactly 100%.

## The harness

- A source edit during a shoot reloaded the pages and killed the pass. The harness now disables HMR and file watching; do not turn them back on.
- A pen stroke sent right after `setActiveTool` became a selection drag, and the Westworld close-up lost its first stroke. The harness waits for the tool and throws if a stroke is missing.
- After drawing or zooming, the editor redraws cached strokes crisp a moment later. Without the harness's 1.5 s wait, the same build differed from itself.
- Under heavy load, the harness's waits timed out (the editor at 180 s, WebKit's page load at 30 s). Both now wait 10 minutes. Run a full pass without other heavy jobs.

## Performance

- No `backdrop-filter` over the canvas: it re-blurs on every repaint.
- No animated gradients or shadows.
- A static gradient behind a transparent canvas (`backdrop`) is free.
- `node scripts/theme-screenshots/bench.mjs --theme <id>` counts `getComputedStyle` calls and canvas creations during pan and zoom. Both must match the run without `--theme`.

## Cross-engine

The editor needs `@scope` (Chrome 118, Safari 17.4, Firefox 146). Older browsers get the CSS unscoped with `:scope` rewritten. Custom properties, gradients, `box-shadow`, `outline`, `letter-spacing` and `text-transform` are safe everywhere. Give `color-mix()` a fallback. Do not depend on `:has()`.

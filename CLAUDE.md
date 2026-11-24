# CLAUDE.md

## Project Structure

Excalidraw is a **monorepo** with a clear separation between the core library and the application:

- **`packages/excalidraw/`** - Main React component library published to npm as `@excalidraw/excalidraw`
- **`excalidraw-app/`** - Full-featured web application (excalidraw.com) that uses the library
- **`packages/`** - Core packages: `@excalidraw/common`, `@excalidraw/element`, `@excalidraw/math`, `@excalidraw/utils`
- **`examples/`** - Integration examples (NextJS, browser script)

## Development Workflow

1. **Package Development**: Work in `packages/*` for editor features
2. **App Development**: Work in `excalidraw-app/` for app-specific features
3. **Testing**: Always run `yarn test:update` before committing
4. **Type Safety**: Use `yarn test:typecheck` to verify TypeScript

## Development Commands

```bash
yarn test:typecheck  # TypeScript type checking
yarn test:update     # Run all tests (with snapshot updates)
yarn fix             # Auto-fix formatting and linting issues
```

## Architecture Notes

### Package System

- Uses Yarn workspaces for monorepo management
- Internal packages use path aliases (see `vitest.config.mts`)
- Build system uses esbuild for packages, Vite for the app
- TypeScript throughout with strict configuration

## Hard fork (draw-only, branches `hardfork/*`)

Draw is this fork's only consumer. Path C cuts what only upstream needed, in stages, on `hardfork/*` branches and prereleases, never on `master`.

- **Semver strictly.** A hard-fork build removes API and props, so it is a **major**: `2.x`. Its prereleases are `2.0.0-hardfork.N` (stage 1 is `.1`, stage 2 `.2`). Master's compatible releases stay `1.x`. Aaron, 2026-11-24: "Obey semver. A hard fork should be at least v2".
- A prerelease is never Latest (`gh release create … --prerelease --latest=false`), and its tag must not match the release workflow's `vX.Y.Z` pattern.
- `scripts/i18n-to-literals.cjs` turns `t("key")` into English literals. Draw is English only. Rerun it after merging `master`.

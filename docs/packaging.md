# Desktop packaging

Bordeaux uses electron-builder. Packaging includes the compiled Electron main/preload code and the canonical `public/renderer` renderer.

## Icons

- `build/Bordeaux.icon` is the editable Icon Composer source used for the macOS app bundle.
- `build/icon.svg` is the platform-neutral composition rendered to `build/icon.png` for Windows.
- `build/icon.icns` is the flattened DMG and CI fallback.
- `build/icon-assets/wine-glass.svg` is the shared vector mark.
- `build/icon-assets/wine-glass-foreground.svg` frames that mark on the square Icon Composer canvas.

The mark uses a red-wine gradient and warm glass outline against Bordeaux's graphite tile. Keep the foreground and platform icons in sync when revising it. Validate the Icon Composer source with:

```sh
/Applications/Icon\ Composer.app/Contents/Executables/ictool build/Bordeaux.icon \
  --export-preview macOS Light 1024 1024 1 build/icon-composer-preview.png
```

## Local builds

```sh
npm ci
npm run package:mac
```

This produces arm64 and x64 DMG/ZIP artifacts in `release/`. The local macOS packages are intentionally unsigned until a `Developer ID Application` identity and notarization credentials are configured.

`package:mac` requires Icon Composer (included with current Xcode releases) to compile `build/Bordeaux.icon`. CI uses `package:mac:ci` and the checked-in ICNS fallback when Icon Composer is unavailable.

Run `npm run package:win` on Windows to produce both an installable NSIS setup executable and a portable executable. Cross-building those targets from macOS requires Wine, so the repository's `Package desktop apps` workflow builds Windows artifacts on a Windows runner instead.

Do not advertise project file associations until main-process startup handles OS open-file events and command-line paths.

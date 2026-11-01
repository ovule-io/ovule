# Ovule identity

The mark combines an inclined organic **O** with a small seed. The shared palette
is **pale cyan + pale lavender + cool neutrals**, matching the application's window
chrome, composer and activity feedback. Artwork was generated with the built-in
ImageGen tool; the transparent masters are retained here.

## Palette and roles

The authority for brand colors is
[`brand.css`](../packages/ovule-ui/src/brand.css), imported by the shared UI theme.
The preview imports that same file rather than defining a separate brand palette.

| Token | Role |
| --- | --- |
| `--brand-cyan` (`#8BDDE5`) | Primary action fill and the cool side of the seed |
| `--brand-lavender` (`#C4B5FD`) | Secondary brand accent and the other side of the seed |
| `--brand-cyan-strong` | Small selection boundaries where the pastel is too faint |
| `--brand-lavender-strong` | Activity outlines and restrained focus decoration |
| `--brand-ink` (`#202638`) | Logo outline and high-contrast brand typography |
| `--brand-paper` (`#F7F8FC`) | Cool icon tile; use semantic surface tokens in the app |

Cyan and lavender are accents, not paragraph-text colors. Primary buttons use the
separate dark `--brand-on-cyan` foreground. Keep ordinary surfaces and focus rings
neutral; do not give each feature a separate theme.

The audit replaced the previous mint primary/sidebar values, independent purple
composer/omnibox/control-feedback colors, Office control greens and warm branding
surfaces. Status warnings/errors, categorical chart colors, third-party file icons
and authored document content retain their semantic/source colors. White document
paper is not a brand surface. No tea/forest/ivory palette remains in the identity.

## Assets

| Asset | Use |
| --- | --- |
| `logo.png` | Transparent primary mark on light surfaces |
| `app-icon-macos.png`, `app-icon.icns` | Opaque full-bleed macOS 26 artwork; the system supplies the mask |
| `app-icon.png`, `app-icon.ico` | Pre-rounded desktop artwork for Windows |
| `favicon.ico`, `favicon-dark.ico` | Theme-aware browser and preview-page favicons |
| `favicon[-dark]-16/32/48/64.png` | Actual-size small exports |
| `menuTemplate.png`, `menuTemplate@2x.png` | 18pt monochrome template, at 1x/2x |
| `masters/` | Original Dock, micro-icon and monochrome generation outputs |
| `preview.html` | Local presentation and actual-size light/dark checks |

The Dock tile is cool porcelain with a subtle cyan/lavender wash. On macOS 26 the
source is an opaque square: no baked-in rounded tile, transparent padding, bevel
or shadow. The previous transparent tile could be shrunk into a second system
tile, producing a nested icon. The browser preview simulates the mask with CSS;
it is not evidence of the actual Dock rendering. Earlier macOS versions may show
the square artwork; a separate legacy rendition requires platform-aware packaging.
The primary mark and menu template have transparent backgrounds. A macOS status item must load the
menu asset as a template for system tinting. These files do not create a status item
by themselves. App/Dock icons take effect in newly built packages.

Regenerate exports on macOS without API calls or third-party image libraries:

```sh
node scripts/brand-assets.mjs
```

This preserves the masters, resamples PNGs through `sips`, and packages PNG-backed
ICO/ICNS containers. Normal builds consume committed assets on any platform.
Favicon links use Vite-managed assets under the existing native asset route.

## Generation prompts

Mode: built-in ImageGen, transparent backgrounds; color edits reference the original
seed-in-O geometry. Preserve silhouette, inclination, negative space and proportions.

- **Primary mark:** Solid cool ink-navy `#202638` outer O; restrained pale cyan
  `#8BDDE5` to pale lavender `#C4B5FD` inner seed, lavender slightly dominant.
  Crisp graphic quality, no lettering, texture, tea/olive/forest-green cast or tile.
- **Dock icon:** Preserve the mark, tile corners and transparent exterior; cool
  porcelain `#F7F8FC` tile with a subtle cyan upper-left/lavender lower-right wash
  and short cool shadow. No warm cream, metallic/glass finish or extra objects.
- **macOS correction (built-in ImageGen edit):** Use the Dock artwork and primary
  mark as references. Preserve the seed-in-O identity and cyan/lavender palette;
  center the flat mark at about 65% canvas coverage on an opaque full-bleed cool
  porcelain square. Remove all pre-drawn rounded corners, bevels, shadows and
  transparent margins. The system supplies the final shape. No nested tile or text.
- **Menu template:** Both shapes solid black with transparent counter/background,
  approximately 80% canvas coverage, clear at 18pt, with no gradients or text.
- **Favicon:** Same cool mark at approximately 90% canvas coverage; preserve
  transparent negative space and inspect at 16/32px. No tile, lettering or shadow.
- **Dark favicon:** Preserve favicon geometry and seed; replace the outer loop
  with cool porcelain `#F7F8FC` for contrast on dark browser tabs.

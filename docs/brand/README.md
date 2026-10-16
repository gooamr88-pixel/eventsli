# Eventsli logo kit

Files for anyone producing Eventsli material outside the website: printers, sign
makers, the agency, social media. They follow the brand guide by Via Marketing
Group (October 2026).

Every file here is **generated** from the same source as the logo on the
website, so they match it exactly. Don't edit them by hand. If the logo
changes, regenerate them (see the end of this page).

## Which file to use

| File | Use it on |
|---|---|
| `eventsli-logo-full-colour.svg` / `.png` | White or light backgrounds. The primary logo. |
| `eventsli-logo-full-colour-no-tagline.svg` | Small sizes, where the tagline would be too small to read. |
| `eventsli-logo-white.svg` / `.png` | Teal or dark backgrounds (business card front, banners, the ticket stub). |
| `eventsli-logo-black.svg` / `.png` | One-colour printing: stamps, fax, engraving, newspaper ads. |
| `eventsli-mark-teal.svg` | The framed star alone, on light backgrounds (stickers, social avatars). |
| `eventsli-mark-white.svg` | The framed star alone, on teal or dark backgrounds. |
| `eventsli-app-icon.svg` / `.png` | App icons and profile pictures: the white star on a teal square. |

The SVG files are vectors and scale to any size, so prefer them for print. The
PNGs are 2400 px wide (the icon is 1024 px), with transparent backgrounds.

The tagline in these files is converted to outlines, so it prints correctly
even on a computer that doesn't have the DM Sans font.

## Colours

The guide's four colours. The website uses these exact values.

| Name | HEX | RGB | CMYK |
|---|---|---|---|
| Teal | `#0D5B5E` | 13 91 94 | 90 35 50 20 |
| Black | `#000000` | 0 0 0 | 0 0 0 100 |
| White | `#FFFFFF` | 255 255 255 | 0 0 0 0 |
| Light Grey | `#F2F4F5` | 242 244 245 | 5 3 3 0 |

## Rules from the guide

- **Clear space:** leave empty space around the logo at least as tall as the
  star (X). Nothing else should sit inside it.
- **Don't** stretch, squash or rotate the logo.
- **Don't** add shadows, outlines, glows or other effects.
- **Don't** change the colours. Use the full-colour version on light
  backgrounds, the white version on teal or dark backgrounds, and the black
  version for one-colour printing.
- Use a background with strong contrast. On a busy photo, place the logo on a
  solid teal or white area.

## Typeface

The website uses **DM Sans** (free, from Google Fonts). The brand guide pages
supplied in October 2026 don't name a typeface. If the full guide specifies
one, use the guide's choice for print.

## Regenerating

The kit is built from `frontend/src/app/components/brand/markPath.js` and
`wordmarkPath.js`, the files the website draws its logo from:

```
cd frontend
npm install --no-save opentype.js@1.3.4   # once; converts the tagline to outlines
node scripts/brandKit.js                  # this folder
node scripts/brandIcons.js                # the website's app icons and share image
```

Both scripts need Playwright installed on the machine and an internet
connection (they fetch DM Sans from Google Fonts).

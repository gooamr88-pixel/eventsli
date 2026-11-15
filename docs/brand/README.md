# Eventsli logo kit

Files for anyone producing Eventsli material outside the website: printers, sign
makers, the agency, social media. They follow the approved brand sheet
("Eventsli | Brand color guide", November 2026): white, sunshine yellow and
coral red.

Every file here is **generated** from the same source as the logo on the
website, so they match it exactly. Don't edit them by hand. If the logo
changes, regenerate them (see the end of this page).

## Which file to use

| File | Use it on |
|---|---|
| `eventsli-logo-full-colour.svg` / `.png` | White or light backgrounds. The primary logo. |
| `eventsli-logo-full-colour-no-tagline.svg` | Small sizes, where the tagline would be too small to read. |
| `eventsli-logo-white.svg` / `.png` | Dark backgrounds and photographs. The word is white; the ticket stays yellow. |
| `eventsli-logo-black.svg` / `.png` | One-colour printing: stamps, fax, engraving, newspaper ads. |
| `eventsli-mark.svg` | The yellow ticket alone (stickers, social avatars, favicons). |
| `eventsli-mark-black.svg` | The ticket alone, one colour. |
| `eventsli-app-icon.svg` / `.png` | App icons and profile pictures: the yellow ticket on near-black. |

The SVG files are vectors and scale to any size, so prefer them for print. The
PNGs are 2400 px wide (the icon is 1024 px), with transparent backgrounds.

The tagline in these files is converted to outlines, so it prints correctly
even on a computer that doesn't have the font.

## Colours

The sheet's six colours. The website uses these exact values.

| Name | HEX | RGB | Use |
|---|---|---|---|
| Pure White | `#FFFFFF` | 255 255 255 | Main background (about 70%) |
| Sunshine Yellow | `#FFCC00` | 255 204 0 | Highlights, selected filters, the logo's ticket (about 15%) |
| Coral Red | `#FF414B` | 255 65 75 | Calls to action (about 10%) |
| Near Black | `#111018` | 17 16 24 | Headlines, navigation, the logo's word (about 5%) |
| Soft Gray | `#EAEAEA` | 234 234 234 | Borders and dividers |
| Off White | `#F8F8F8` | 248 248 248 | Secondary surfaces |

**Text on coral, and coral as text.** White words on `#FF414B` measure 3.44:1,
below the 4.5:1 that accessibility guidelines (WCAG AA) ask of normal-size text.
The website therefore uses a slightly deeper coral, **`#D61F2C`**, for buttons
and links (white on it is 5.13:1), and keeps `#FF414B` for graphics: heading
bars, icons, illustrations. Do the same in print and on screens: set button
labels and small coral text on `#D61F2C`, or set them large and bold.

**Yellow is never text** on a light background (`#FFCC00` on white is 1.5:1).
Use it as a fill, with near-black words on it.

## Rules

- **Clear space:** leave empty space around the logo at least as tall as the
  ticket's star. Nothing else should sit inside it.
- **Don't** stretch, squash or re-rotate the logo. The ticket's tilt is part of
  the mark.
- **Don't** add shadows, outlines, glows or other effects.
- **Don't** change the colours. Use the full-colour version on light
  backgrounds, the white version on dark backgrounds and photographs, and the
  black version for one-colour printing.
- On a busy photo, place the logo on a solid white or near-black area.

## Typefaces

- **Montserrat** (ExtraBold, Black) for headlines. The wordmark is Montserrat
  ExtraBold Italic, converted to outlines.
- **DM Sans** for body text, forms and small labels.

Both are free from Google Fonts.

## Regenerating

The logo itself is drawn by a script, and the kit and the website's icons are
built from what it writes:

```
cd frontend
npm install --no-save opentype.js@1.3.4   # once; outlines the word and tagline
node scripts/brandLogo.js                 # the ticket and the word (markPath.js, wordmarkPath.js)
node scripts/brandKit.js                  # this folder
node scripts/brandIcons.js                # the website's favicon tile, app icons and share image
```

`brandKit.js` and `brandIcons.js` need Playwright (or `playwright-core` and an
installed Chrome) and an internet connection (they fetch fonts from Google
Fonts). The check-in app's icons are separate: `mobile/scripts/app-icons.js`
and `mobile/scripts/splash-icon.js`.

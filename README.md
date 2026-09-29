# MotoPilot website

The public site for [MotoPilot](https://github.com/massumm/motopilot), a
Bangladesh-focused motorcycle companion app for Android.

It exists for two reasons: somewhere to point people at, and a publicly
reachable privacy policy, which Google Play requires before an app can be
published even when the app collects nothing.

## What is here

| | |
|---|---|
| `index.html` | Landing page |
| `privacy.html` | Privacy policy, served at `/privacy` |
| `styles.css` | Shared styles. The palette is the app's own |
| `assets/` | Icon, wordmark and feature graphic, copied from the app repo |
| `vercel.json` | Clean URLs, and long cache headers for `/assets` |

Plain static HTML with no build step and no dependencies, so it deploys as-is
and will still deploy in five years.

## Deploying to Vercel

Import this repository at [vercel.com/new](https://vercel.com/new). Vercel
detects a static site on its own; leave the framework preset as **Other** and
leave both the build command and the output directory empty. Every push to
`main` redeploys.

To preview locally, any static server will do:

```bash
python3 -m http.server 8000
```

Note that `/privacy` only resolves without the `.html` once Vercel's
`cleanUrls` is applied — locally you want `/privacy.html`.

## Keeping the assets in step

The images are copies from the app repository, not originals. When the app's
icon changes, regenerate them there and copy across:

```bash
cp ../moto_mate/docs/store/play-icon-512.png        assets/icon.png
cp ../moto_mate/docs/store/play-feature-1024x500.png assets/feature.png
cp ../moto_mate/assets/icon/icon_foreground.png      assets/mark.png
```

## Privacy policy

`privacy.html` and `docs/PRIVACY.md` in the app repository say the same thing
and must be changed together. The app's own description of what it does is the
source of truth; this page is how the world reads it.

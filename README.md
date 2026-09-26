# Anonymous Supplementary Project Page

This repository contains a self-contained static project page prepared for
double-blind peer review.

Open `index.html` through a static HTTP server. All page assets are local; the
page does not load analytics, remote fonts, embeds, or third-party resources.

The page includes the full nine-section Gallery, paired previews, editing
variants, original scene code, and live Three.js inspectors. The main demo is
the original 1080p web video with only the branded outro removed. The retained
video and audio packets are copied without additional lossy compression.

Only resources reachable from the current interface are included. Historical
comparison pages, unused gallery templates, and private provenance paths are
excluded. Fonts are served locally; their licenses are in `static/fonts/`.

The delivery layer supports the opaque-origin sandbox used by anonymous
hosting. Classic-script packages supply manifests, original source text and
case video bytes without cross-origin fetches. Scoped DOM views preserve
scene inspection and edit transitions without accessing browser iframes.
The hosting sandbox remains intact.

Case videos are stored once in lossless resource packages and decoded to
origin-clean media blobs on demand. On anonymous hosting, the main demo uses
losslessly remuxed video/audio segments so its native progress bar can seek
without HTTP Range support or downloading the complete movie. Other hosts
retain progressive MP4 playback. Browsers without MediaSource support display
an explicit notice and retain native playback.
Fonts are embedded in the local stylesheets. In a sandbox, navigation state
uses the URL fragment while existing category and case query links still work.
Opening the bare project URL defaults to the Scene / World Editing gallery
without adding a query or fragment. Explicit category, case and saved-view
links retain their requested state.
Gaming contains eight selected cases, numbered consecutively.

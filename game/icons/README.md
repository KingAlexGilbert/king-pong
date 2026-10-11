# Approved Royal Powerup icons

These PNGs are technical derivatives of the user-supplied approved `royal-split.png`, `crown-rush.png`, and `castle-guard.png`. They retain the supplied designs, colors, and alpha; no artwork was redrawn or generated. The black-background Split reference is not bundled.

The 1254×1254 originals were cropped to their visible bounds, resized with nearest-neighbor sampling into a maximum 92×92 area, and centered on transparent 96×96 canvases. Alpha values of 1/255 outside the artwork were ignored when finding bounds; pixels within the crop were preserved before nearest-neighbor reduction. PNG encoding is lossless. Crop rectangles in source pixels (left, top, right, bottom):

| Icon | Crop | Scaled content | PNG bytes |
| --- | --- | --- | --- |
| Royal Split | 285, 284, 978, 941 | 92×87 | 8,705 |
| Crown Rush | 339, 129, 915, 1139 | 52×92 | 5,322 |
| Castle Guard | 291, 261, 964, 1016 | 82×92 | 8,929 |

The shared gameplay cache uses these same files for 36-unit pickups and 40-pixel help icons, with pixelated scaling. The pickup collection radius remains 24 units. `node tools/sync-gameplay.mjs` embeds the small PNGs in all four builds, preserving standalone native packaging. Total PNG payload: 22,956 bytes before base64 encoding.

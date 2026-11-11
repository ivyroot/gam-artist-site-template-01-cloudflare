# Example artwork files

The files in `originals/` are the high-resolution raster originals: baseline JPEG, 2400 × 2720 pixels, sRGB, quality 95 with 4:4:4 chroma sampling. They are ready to upload as the original artwork files and to save onto a compatible digital frame. They preserve the artwork's portrait aspect ratio; no particular frame model or screen ratio is assumed.

The website uses reduced 1200 × 1360 WebP previews in `public/samples/`, generated from those JPEG originals. Each public preview has a two-line watermark, “Purchase Display License” / “on Tezos”, centered in the bottom-right quadrant. Only these smaller, marked previews ship as public site assets. Upload an unmarked JPEG original through the artist admin to deliver it from private R2 after license verification; the delivery code streams the uploaded file unchanged.

When preparing your own artworks, mark public previews and keep the downloadable original unmarked. The example export script's `previewWatermarkLines` setting controls the watermark text; you can also use your artist website URL. The watermark is applied after resizing the preview; it never modifies the original JPEG or the SVG master. The admin preview uploader currently accepts prepared previews, so add your mark before uploading them.

Editable SVG masters live in `artwork-source/samples/`, outside the public directory. They are authoring files, not buyer downloads.

After editing the SVG masters, run:

```sh
npm run samples:export
```

To regenerate only web previews from the existing JPEG originals, run:

```sh
npm run samples:previews
```

Both commands use the project-pinned Sharp image tool (libvips with librsvg). No global ImageMagick or Inkscape installation is required. The SVGs request Georgia bold; this Mac has that font installed. Another machine may substitute a serif font if Georgia is unavailable, so inspect exports after regenerating masters on a different machine. Committed JPEG originals and WebP previews do not depend on installed fonts to display.

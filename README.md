# Funk With IIIF

A fun experiment made for Coghack #27.

A beat-synced disco floor of IIIF images from the Art Institute of Chicago
and the Victoria and Albert Museum.

Each lyric is tagged for nouns and adjectives, every keyword is matched to
artworks from both collections, and the artworks drop onto the floor on the
beat while the tiles flash through a rotating set of patterns. A credit for
the latest drop fades in at the top of the floor.

V&A artworks are requested live from the IIIF Image API, which lets the floor
do more than show a thumbnail: a mosaic cuts one artwork into regions and
reassembles it across a block of up to 5×3 tiles, a zoom punches into the
centre one beat at a time, and a strobe swaps between the colour and `gray`
renderings as the tile lights up. Quiet stretches of the track are filled
with random live drops.

## Artwork lookups

The API results are resolved ahead of time into `src/lyrics.json`, so playback
never waits on a search. Recurring words cycle through a pool of matches so
the same artwork does not keep landing. Re-run it after editing
`src/iiif.vtt`:

```sh
npm run fetch:artworks
```

## Harvested tiles

The AIC image server sits behind a bot rule, so its tiles are downloaded once
into `public/artworks/` and served with the site. Re-run after the lookups
change; tiles already on disk are skipped:

```sh
npm run fetch:tiles
```

The script requests one tile at a time with a `Referer` header and checks
that each response is a JPEG rather than a challenge page.

## Development

```sh
git clone git@github.com:CogappLabs/FunkWithIIIF.git
npm install
npm run dev
```

## Build

```sh
npm install
npm run build
```

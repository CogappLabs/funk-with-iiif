const ARTWORK_ROOT = "./artworks";
const TILE_SIZE = 400;
const ZOOM_STEPS = [1, 0.7, 0.5, 0.35];

export function iiifURL(base, { region = "full", size = `!${TILE_SIZE},${TILE_SIZE}`, rotation = 0, quality = "default" } = {}) {
	return `${base}/${region}/${size}/${rotation}/${quality}.jpg`;
}

/** Square tile for any artwork: a harvested file for AIC, a live request for V&A. */
export function tileURL(artwork) {
	if (artwork.source === "vam") return iiifURL(artwork.iiif, { region: "square" });
	return `${ARTWORK_ROOT}/${artwork.image_id}.jpg`;
}

/** Largest centred region with the given aspect ratio, scaled down to zoom in. */
function centredRegion({ width, height }, aspect = 1, scale = 1) {
	const regionWidth = Math.round(Math.min(width, height * aspect) * scale);
	const regionHeight = Math.round(regionWidth / aspect);
	return {
		x: Math.round((width - regionWidth) / 2),
		y: Math.round((height - regionHeight) / 2),
		width: regionWidth,
		height: regionHeight,
	};
}

function pixelRegion({ x, y, width, height }) {
	return `${x},${y},${width},${height}`;
}

const ONE_TILE = { cols: 1, rows: 1 };

/** Block shapes a mosaic can spread across, weighted towards the small ones. */
const MOSAIC_SHAPES = [
	{ cols: 2, rows: 2, weight: 4 },
	{ cols: 3, rows: 2, weight: 3 },
	{ cols: 2, rows: 3, weight: 2 },
	{ cols: 3, rows: 3, weight: 2 },
	{ cols: 4, rows: 2, weight: 1 },
	{ cols: 4, rows: 3, weight: 1 },
	{ cols: 5, rows: 3, weight: 1 },
];

function weightedPick(entries) {
	const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
	let roll = Math.random() * total;
	for (const [value, weight] of entries) {
		roll -= weight;
		if (roll < 0) return value;
	}
	return entries[0][0];
}

/** A shape that leaves at least one free row and column around it. */
function pickShape(grid) {
	const fitting = MOSAIC_SHAPES.filter((shape) => shape.cols < grid.cols && shape.rows < grid.rows);
	if (!fitting.length) return MOSAIC_SHAPES[0];
	return weightedPick(fitting.map((shape) => [shape, shape.weight]));
}

/** Cuts a region of the artwork into cells that match a block of tiles. */
function mosaicTiles(artwork, { cols, rows }, tileAspect = 1) {
	const region = centredRegion(artwork, (cols * tileAspect) / rows);
	const cellWidth = region.width / cols;
	const cellHeight = region.height / rows;
	const tiles = [];

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const cell = {
				x: Math.round(region.x + col * cellWidth),
				y: Math.round(region.y + row * cellHeight),
				width: Math.round(cellWidth),
				height: Math.round(cellHeight),
			};
			tiles.push({ frames: [iiifURL(artwork.iiif, { region: pixelRegion(cell) })] });
		}
	}

	return tiles;
}

/**
 * Each effect describes a block of tiles in row-major order. Every tile lists
 * the frames it steps through on the beat, plus an optional gray layer shown
 * while the tile is unlit. A plan with `reveal` lands one cell at a time.
 */
const EFFECTS = {
	single(artwork) {
		return { block: ONE_TILE, tiles: [{ frames: [tileURL(artwork)] }] };
	},

	/** Cuts the artwork into a grid of cells and reassembles it across a block. */
	mosaic(artwork, grid) {
		const shape = pickShape(grid);
		return { block: shape, tiles: mosaicTiles(artwork, shape, grid.tileAspect) };
	},

	/** A mosaic laid down one cell per beat, held, then peeled away. */
	build(artwork, grid) {
		const shape = pickShape(grid);
		return { block: shape, tiles: mosaicTiles(artwork, shape, grid.tileAspect), reveal: true };
	},

	/** Builds the artwork across the whole floor. */
	fill(artwork, grid) {
		const shape = { cols: grid.cols, rows: grid.rows };
		return { block: shape, tiles: mosaicTiles(artwork, shape, grid.tileAspect), reveal: true };
	},

	/** Punches in towards the centre one beat at a time. */
	zoom(artwork) {
		return {
			block: ONE_TILE,
			tiles: [
				{
					frames: ZOOM_STEPS.map((scale) =>
						iiifURL(artwork.iiif, { region: pixelRegion(centredRegion(artwork, 1, scale)) }),
					),
				},
			],
		};
	},

	/** Colour when the tile is lit, grayscale when it is not. */
	strobe(artwork) {
		return {
			block: ONE_TILE,
			tiles: [
				{
					frames: [tileURL(artwork)],
					gray: iiifURL(artwork.iiif, { region: "square", quality: "gray" }),
				},
			],
		};
	},
};

const EFFECT_WEIGHTS = { single: 2, mosaic: 4, build: 3, zoom: 2, strobe: 2 };

export function pickEffect() {
	return weightedPick(Object.entries(EFFECT_WEIGHTS));
}

/**
 * @param {Object} artwork
 * @param {{cols: number, rows: number, tileAspect: number}} grid the floor's current tile grid
 * @param {string} [name]
 */
export function planEffect(artwork, grid, name = pickEffect()) {
	return EFFECTS[name](artwork, grid);
}

/** Every URL a plan needs, so they can be fetched before the drop. */
export function planURLs(plan) {
	return plan.tiles.flatMap((tile) => [...tile.frames, tile.gray].filter(Boolean));
}

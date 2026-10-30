/**
 * The page-side half of `scripts/logo-probe.ts`.
 *
 * It lives in a plain `.js` file because tsx rewrites named closures (for
 * `Function.name`) on the way to `page.evaluate`, and the rewrite references a
 * helper that does not exist inside the page. A file injected as a script is
 * never rewriten, so the measurement runs as written.
 *
 * `globalThis.logoMeasure(args)` decodes the sheet at `args.url` and returns
 * the numbers the probe asserts on. `scale` maps the manifest's grid onto the
 * sheet: 4 for the exported PNG, `renderedWidth / grid.w` for a screenshot.
 */
globalThis.logoMeasure = async function logoMeasure(args) {
	const { url, manifest, scale, plate, backgrounds, purityFrom } = args;

	const load = async (source) => {
		const response = await fetch(source);
		const bitmap = await createImageBitmap(await response.blob());
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("no 2d context");
		ctx.drawImage(bitmap, 0, 0);
		return {
			w: bitmap.width,
			h: bitmap.height,
			data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
		};
	};

	const hex = (value) => [
		parseInt(value.slice(1, 3), 16),
		parseInt(value.slice(3, 5), 16),
		parseInt(value.slice(5, 7), 16),
	];
	const channel = (v) => {
		const c = v / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const luminance = ([r, g, b]) =>
		0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
	const ratio = (a, b) => {
		const la = luminance(a);
		const lb = luminance(b);
		return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
	};

	const sheet = await load(url);
	const at = (x, y) => {
		const i = (y * sheet.w + x) * 4;
		return [sheet.data[i], sheet.data[i + 1], sheet.data[i + 2]];
	};
	const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
	const box = (x, y, w, h) => ({
		x0: Math.round(x * scale),
		y0: Math.round(y * scale),
		x1: Math.round((x + w) * scale) - 1,
		y1: Math.round((y + h) * scale) - 1,
	});

	const plateColour = hex(plate);

	// The modal non-plate colour in the word box: the worst band of a gradient
	// letter, not the best one.
	const word = box(
		manifest.word.x,
		manifest.word.y,
		manifest.word.w,
		manifest.word.h,
	);
	const counts = new Map();
	for (let y = word.y0; y <= word.y1; y += 1) {
		for (let x = word.x0; x <= word.x1; x += 1) {
			const rgb = at(x, y);
			if (same(rgb, plateColour)) continue;
			const key = rgb.join(",");
			const entry = counts.get(key);
			if (entry) entry.n += 1;
			else counts.set(key, { rgb, n: 1 });
		}
	}
	const letter = [...counts.values()].sort((a, b) => b.n - a.n)[0].rgb;

	// The frame: its brightest *band* is what gives the badge an edge. A
	// single glint is not an edge, so a colour has to cover 2% of the ring to
	// count.
	const ring = Math.round(manifest.grid.frame * scale);
	const ringCounts = new Map();
	let ringTotal = 0;
	for (let y = 0; y < sheet.h; y += 1) {
		for (let x = 0; x < sheet.w; x += 1) {
			if (!(x < ring || y < ring || x >= sheet.w - ring || y >= sheet.h - ring)) {
				continue;
			}
			ringTotal += 1;
			const rgb = at(x, y);
			const key = rgb.join(",");
			const entry = ringCounts.get(key);
			if (entry) entry.n += 1;
			else ringCounts.set(key, { rgb, n: 1 });
		}
	}
	const perBackground = {};
	for (const background of backgrounds) {
		perBackground[background] = { rgb: [0, 0, 0], ratio: 0 };
	}
	for (const { rgb, n } of ringCounts.values()) {
		if (n / ringTotal < 0.02) continue;
		for (const background of backgrounds) {
			const r = ratio(rgb, hex(background));
			if (r > perBackground[background].ratio) {
				perBackground[background] = { rgb, ratio: r };
			}
		}
	}

	// Each glyph box holds ink, and every gap between two of them keeps columns
	// of pure plate: a merge would fill them.
	const glyphs = manifest.glyphs.map((g) => {
		const b = box(g.x, g.y, g.w, g.h);
		let ink = 0;
		let total = 0;
		for (let y = b.y0; y <= b.y1; y += 1) {
			for (let x = b.x0; x <= b.x1; x += 1) {
				total += 1;
				if (!same(at(x, y), plateColour)) ink += 1;
			}
		}
		return { letter: g.letter, ink: ink / total };
	});

	// The l's stem, a third of the way down: the thinnest stem in the face.
	const ell = manifest.glyphs.find((g) => g.letter === "l");
	let stroke = 0;
	if (ell) {
		const y = Math.round((ell.y + ell.h * 0.3) * scale);
		let x = Math.round(ell.x * scale);
		const end = Math.round((ell.x + ell.w) * scale);
		while (x < end && same(at(x, y), plateColour)) x += 1;
		while (x < end && !same(at(x, y), plateColour)) {
			stroke += 1;
			x += 1;
		}
	}

	// Every drawn pixel must be an exact colour of the source sheet.
	let purity;
	if (purityFrom) {
		const source = await load(purityFrom);
		const palette = new Set();
		for (let i = 0; i < source.data.length; i += 4) {
			palette.add(
				`${source.data[i]},${source.data[i + 1]},${source.data[i + 2]}`,
			);
		}
		let exact = 0;
		let total = 0;
		// One pixel of margin: an element screenshot can include a hairline of
		// the page at its edge, which is not the sheet's business.
		for (let y = 1; y < sheet.h - 1; y += 1) {
			for (let x = 1; x < sheet.w - 1; x += 1) {
				total += 1;
				if (palette.has(at(x, y).join(","))) exact += 1;
			}
		}
		purity = exact / total;
	}

	return {
		width: sheet.w,
		height: sheet.h,
		contrast: ratio(plateColour, letter),
		plate: plateColour,
		letter,
		frame: perBackground,
		glyphs,
		stroke,
		purity,
	};
};

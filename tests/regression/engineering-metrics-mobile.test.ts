import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("engineering metrics mobile layout", () => {
	it("stacks recent engineering cycles as cards on phones and keeps the table from md up", () => {
		const source = read("src/components/analytics/engineering-metrics.tsx");

		// The 3-column table overflows a phone; it must only render from md up.
		assert.match(source, /hidden md:block/);

		// Phones get a stacked card per cycle instead.
		assert.match(source, /md:hidden/);
		assert.match(source, /data-testid="recent-cycle-card"/);

		// Each card carries the same data the table row did: title, cycle time,
		// and the Done / In Progress state.
		assert.match(
			source,
			/data-testid="recent-cycle-card"[\s\S]*?cycle\.title[\s\S]*?cycleHours/,
		);
		assert.match(source, /Done/);
		assert.match(source, /In Progress/);
	});
});

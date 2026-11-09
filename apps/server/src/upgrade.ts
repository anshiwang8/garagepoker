/**
 * Brings table data saved by an older server up to date when a TableRoom
 * loads it, so a deploy never breaks a table that's in use.
 */
import { type HandConfig, ROW_BOARD } from "@garagepoker/engine";
import type { TableData } from "./table.js";

/**
 * Fills in what older saves lack. Returns whether anything changed.
 *
 * - `variant.board` (added with Tic-Tac-Toe Hold'em): every variant before it
 *   dealt a row of 5, so a saved hand without a board gets the row board.
 */
export function upgradeTableData(d: TableData): boolean {
	let changed = false;
	const configs: (HandConfig | undefined)[] = [
		d.hand?.config,
		d.prevHand?.config,
		d.handRecord?.record.input.config,
		d.prevRecord?.record.input.config,
	];
	for (const config of configs) {
		if (config && !config.variant.board) {
			config.variant = { ...config.variant, board: ROW_BOARD };
			changed = true;
		}
	}
	return changed;
}

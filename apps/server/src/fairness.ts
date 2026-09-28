/**
 * Provable fairness with per-card commitments (see FairnessProof in
 * @garagepoker/protocol). The Table creates the salts when it shuffles; the
 * TableRoom hashes them with Web Crypto before anything is broadcast.
 */
import { type Card, cardToString, type RandomSource } from "@garagepoker/engine";
import { type FairnessProof, fairnessLeafInput, fairnessRootInput } from "@garagepoker/protocol";

/** Server-only. The salts and deck are never sent except as a FairnessProof. */
export interface FairnessSecret {
	hand: number;
	deck: Card[];
	salts: string[];
	leaves: string[] | null;
	commitment: string | null;
}

/** One 128-bit hex salt per deck position. */
export function newSalts(count: number, random: RandomSource): string[] {
	return Array.from({ length: count }, () => {
		const words = new Uint32Array(4);
		random(words);
		return Array.from(words, (w) => w.toString(16).padStart(8, "0")).join("");
	});
}

export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Computes the per-card hashes and the commitment. */
export async function seal(secret: FairnessSecret): Promise<void> {
	secret.leaves = await Promise.all(
		secret.deck.map((card, i) => sha256Hex(fairnessLeafInput(secret.salts[i]!, i, cardToString(card)))),
	);
	secret.commitment = await sha256Hex(fairnessRootInput(secret.leaves));
}

/** The proof for a finished hand, revealing only the cards that became public. */
export function proofFor(secret: FairnessSecret, publicCards: readonly Card[]): FairnessProof | null {
	if (!secret.leaves || !secret.commitment) return null;
	const revealed = [...new Set(publicCards)]
		.map((card) => {
			const index = secret.deck.indexOf(card);
			return { index, card: cardToString(card), salt: secret.salts[index]! };
		})
		.filter((r) => r.index >= 0)
		.sort((a, b) => a.index - b.index);
	return { commitment: secret.commitment, leaves: [...secret.leaves], revealed };
}

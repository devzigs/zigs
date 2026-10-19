// The five stages of a new wallet, for the stepper of the setup page. Display only: the progress
// card keeps the steps, their counts and their texts, and the stage comes from the same counts.

/** The stages in order. Plan is done once the wallet exists. */
export const SETUP_STAGES = ["Plan", "Connect", "Verify", "Prepare", "Back up"];

/**
 * The current stage of a wallet in setup. The setup page ends at Prepare: once the wallet has
 * its address, the wallet page shows and asks for the backup files (Back up), and every other
 * state of a finished key is a stop. A stop stays at the stage where it happened.
 * @param {object} f seated, n: seats taken and seats; verify: the wallet asks for the safety
 *   number (version 2 and later); confirmed: seats that confirmed it; blocked: the text of a
 *   stop, or null.
 * @returns {{index: number, blocked: string | null}} index: into SETUP_STAGES.
 */
export function setupStage(f) {
  const index = f.seated < f.n ? 1 : f.verify && f.confirmed < f.n ? 2 : 3;
  return { index, blocked: f.blocked || null };
}

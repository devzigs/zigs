// The five stages of a new wallet, for the stepper of the setup page. Display only: the progress
// card keeps the steps, their counts and their texts, and the stage comes from the same counts.

/** The stages in order. Plan is done once the wallet exists. */
export const SETUP_STAGES = ["Plan", "Connect", "Verify", "Prepare", "Back up"];

/**
 * The current stage of a wallet in setup.
 * @param {object} f seated, n: seats taken and seats; verify: the wallet asks for the safety
 *   number (version 2 and later); confirmed: seats that confirmed it; keysDone: seats that hold
 *   their key share; checked: seats that checked the address; solPending: the Solana part of
 *   the wallet still has to set up; blocked: the text of a stop, or null.
 * @returns {{index: number, blocked: string | null}} index: into SETUP_STAGES.
 */
export function setupStage(f) {
  const prepared = f.keysDone >= f.n && f.checked >= f.n && !f.solPending;
  const index = f.seated < f.n ? 1 : f.verify && f.confirmed < f.n ? 2 : prepared ? 4 : 3;
  return { index, blocked: f.blocked || null };
}

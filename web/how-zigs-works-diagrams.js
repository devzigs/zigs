// Static, synthetic illustrations. No wallet state, keys, approvals or network access.
const text = (x, y, label, cls = "") => `<text x="${x}" y="${y}" class="${cls}" text-anchor="middle">${label}</text>`;
const line = (d, cls = "") => `<path d="${d}" class="hw-wire ${cls}"/>`;
const device = (x, y, label, phase = 1) => `<g class="hw-phase-${phase}"><rect x="${x - 25}" y="${y - 33}" width="50" height="66" rx="10" class="hw-device"/><path d="M${x - 10} ${y - 22}h20M${x - 4} ${y + 24}h8" class="hw-icon"/><circle cx="${x}" cy="${y}" r="6" class="hw-seed"/></g>${text(x, y + 52, label)}`;
const box = (x, y, label, width = 108, cls = "") => `<g class="${cls}"><rect x="${x - width / 2}" y="${y - 23}" width="${width}" height="46" rx="12" class="hw-box"/>${text(x, y + 5, label, "hw-box-label")}</g>`;
const lock = (x, y) => `<g transform="translate(${x} ${y})"><rect x="-19" y="-4" width="38" height="31" rx="7" class="hw-lock"/><path d="M-11-4v-9a11 11 0 0 1 22 0v9" class="hw-icon"/><circle cy="10" r="3" class="hw-seed"/></g>`;
const badge = (x, y, label, cls = "") => `<g class="${cls}"><circle cx="${x}" cy="${y}" r="24" class="hw-box"/>${text(x, y + 5, label, "hw-box-label")}</g>`;
const envelope = (x, y, cls = "") => `<g class="${cls}" transform="translate(${x} ${y})"><rect x="-30" y="-21" width="60" height="42" rx="8" class="hw-box"/><path d="m-28-16 28 21 28-21" class="hw-icon"/></g>`;
const check = (x, y, cls = "") => `<g class="${cls}"><circle cx="${x}" cy="${y}" r="15" class="hw-check"/><path d="m${x - 6} ${y} 4 4 8-9" class="hw-icon"/></g>`;

const scenes = {
  custody: () => line("M70 105V155L180 210M180 105V210M290 105V155L180 210")
    + line("M70 105V155L180 210M180 105V210", "hw-flow")
    + device(70, 75, "Seat 1", 1) + device(180, 75, "Seat 2", 2) + device(290, 75, "Seat 3", 3)
    + box(180, 220, "One signature", 138, "hw-phase-3") + text(180, 274, "2 distinct shares · 1 authorization", "hw-caption"),
  dkg: () => line("M80 103 280 103M100 125 180 225 260 125", "hw-flow")
    + device(80, 78, "Device A", 1) + device(280, 78, "Device B", 1)
    + envelope(180, 103, "hw-phase-2") + text(180, 158, "Encrypted exchange")
    + box(180, 239, "Agreed public key", 170, "hw-phase-3")
    + text(180, 286, "A keeps share A. B keeps share B.", "hw-caption"),
  device: () => line("M70 155H290", "hw-flow") + badge(65, 155, "PRF", "hw-phase-1")
    + lock(180, 140) + device(290, 155, "Local share", 3)
    + text(65, 210, "Passkey") + text(180, 210, "AES-GCM vault")
    + text(180, 63, "PROTECT AT REST", "hw-overline")
    + text(180, 280, "Unlock locally. Sign with the share.", "hw-caption"),
  sync: () => {
    let notes = "";
    for (let i = 0; i < 4; i++) notes += `<rect x="${45 + i * 73}" y="52" width="51" height="39" rx="7" class="hw-box"/>` + text(70 + i * 73, 77, "···");
    return notes + line("M70 100V127H180V175M290 100V127H180", "hw-flow")
      + box(180, 191, "Local viewing key", 162, "hw-phase-2")
      + line("M180 214V246", "hw-flow") + check(180, 264, "hw-phase-3")
      + text(180, 32, "COMPACT BLOCKS", "hw-overline") + text(180, 307, "Only the device recognizes its notes", "hw-caption");
  },
  payment: () => box(180, 46, "Exact payment digest", 180, "hw-phase-1")
    + line("M180 69V94H75V115M180 94H285V115M75 190V224H285V190M180 224V250", "hw-flow")
    + device(75, 152, "Approver A", 2) + device(285, 152, "Approver B", 2)
    + box(180, 270, "Proof + broadcast", 170, "hw-phase-3")
    + text(180, 315, "The chain confirms the payment", "hw-caption"),
  privacy: () => line("M65 155H295", "hw-flow") + device(57, 150, "Sender", 1)
    + envelope(180, 150, "hw-phase-2") + lock(180, 147)
    + device(303, 150, "Reader", 3)
    + text(180, 47, "CONTENT IS ENCRYPTED", "hw-overline")
    + box(180, 261, "ID · timing · IP · size", 196)
    + line("M180 194V232", "hw-metadata") + text(180, 305, "Metadata remains visible to the relay", "hw-caption"),
  solana: () => badge(65, 77, "SOL", "hw-phase-1") + text(65, 123, "Public fee payer")
    + line("M92 77H245M285 105V185M245 208H95", "hw-flow")
    + box(280, 77, "Group PDA", 112, "hw-phase-2")
    + box(280, 208, "Payee key", 112, "hw-phase-3")
    + lock(70, 196) + text(70, 256, "Hidden amount")
    + text(180, 308, "Public identifiers link the activity", "hw-caption"),
  messages: () => device(65, 100, "Write + sign", 1) + device(295, 100, "Read + verify", 3)
    + line("M92 100H265", "hw-flow") + envelope(180, 100, "hw-phase-2")
    + box(180, 213, "Encrypted relay", 160, "hw-phase-2") + line("M180 124V187", "hw-flow")
    + check(295, 210, "hw-phase-3") + text(180, 280, "Pinned key ≠ proof of a person's identity", "hw-caption"),
  recovery: () => device(65, 86, "Original seat", 1) + device(295, 86, "Same seat", 3)
    + line("M65 121V193H295V121", "hw-flow")
    + box(180, 193, ".zigsbackup", 136, "hw-phase-1") + lock(180, 140)
    + badge(180, 285, "+", "hw-phase-2") + text(180, 325, "Separate passphrase", "hw-caption")
    + text(180, 38, "ONE SEAT, RESTORED", "hw-overline"),
  trust: () => line("M65 150H295", "hw-flow")
    + badge(65, 150, "01", "hw-phase-1") + badge(180, 150, "02", "hw-phase-2") + badge(295, 150, "03", "hw-phase-3")
    + text(65, 203, "Compare") + text(180, 203, "Inspect") + text(295, 203, "Threshold")
    + text(180, 65, "CHECK DIFFERENT BOUNDARIES", "hw-overline")
    + text(180, 280, "No single check replaces the others", "hw-caption"),
};

export function guideDiagram(id) {
  // Only fixed source strings enter this SVG; no wallet or user-provided data.
  const wrapper = document.createElement("div");
  wrapper.className = "hw-art";
  wrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 350" aria-hidden="true" focusable="false">${scenes[id]()}</svg>`;
  return wrapper;
}

// Decorative, local SVG. Its timeline is presentation only, never transport readiness.
export const CAMOUFLAGE_MS = 5600;

export function privacyCamouflage() {
  const scene = document.createElement("div");
  scene.className = "pp-camouflage";
  scene.setAttribute("aria-hidden", "true");
  scene.innerHTML = `<svg viewBox="0 0 900 430" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="pp-stripes" width="76" height="430" patternUnits="userSpaceOnUse">
        <rect width="76" height="430" fill="#e8e4da"/>
        <path d="M8-10C44 50-14 111 12 169S49 272 17 337 38 402 32 442H58C68 375 38 380 51 321S80 244 51 178 64 76 39-10Z" fill="#171c20"/>
        <path d="M69-10C47 57 92 112 72 169S48 248 73 302 68 389 80 440" fill="none" stroke="#171c20" stroke-width="7"/>
      </pattern>
      <linearGradient id="pp-scene-shade" x2="0" y2="1">
        <stop stop-color="#0e141b" stop-opacity=".2"/><stop offset="1" stop-color="#0e141b" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect class="pp-stripe-field" width="900" height="430" fill="url(#pp-stripes)"/>
    <rect width="900" height="430" fill="url(#pp-scene-shade)"/>
    <ellipse class="pp-zebra-shadow" cx="444" cy="365" rx="216" ry="12" fill="#0b1015" opacity=".4"/>
    <g class="pp-zebra-walk" fill="url(#pp-stripes)" stroke="#e8e4da" stroke-width="2" stroke-linejoin="round">
      <g class="pp-zebra-outline">
        <path class="pp-zebra-leg pp-leg-back-far" d="M290 239C296 268 307 278 303 301L291 353 284 362H311L322 302 341 255Z"/>
        <path class="pp-zebra-leg pp-leg-front-far" d="M512 238L520 293 538 350 537 362H561L550 290 552 234Z"/>
        <path class="pp-zebra-tail" d="M268 195C225 209 259 258 218 273L207 289 221 284C271 266 244 222 273 212Z"/>
        <path d="M263 186C284 157 323 150 372 159L461 166C504 164 523 148 542 122L575 71 605 64 628 80 651 98 686 105 700 123 687 138 649 136 620 126C616 165 613 193 587 223L558 261C520 276 491 276 452 265L360 268C314 269 278 254 265 229 256 216 253 199 263 186Z"/>
        <path d="M574 75L565 38 576 31 592 66M595 65L604 30 616 30 616 76"/>
        <path class="pp-zebra-leg pp-leg-back-near" d="M278 227C278 254 299 279 286 304L264 350 259 363H287L309 311C329 282 325 258 322 244Z"/>
        <path class="pp-zebra-leg pp-leg-front-near" d="M532 232C528 263 519 281 520 306L512 352 504 363H532L544 309 553 267 565 238Z"/>
      </g>
      <path class="pp-zebra-detail" d="M542 125L562 91 579 69" fill="none" stroke="#171c20" stroke-width="15"/>
      <path class="pp-zebra-detail" d="M677 109L696 119 686 132 674 128Z" fill="#171c20" stroke="none"/>
      <circle class="pp-zebra-eye" cx="628" cy="103" r="4" fill="#d97857" stroke="none"/>
    </g>
    <path class="pp-scene-corner" d="M22 47V22H47M853 22H878V47M878 383V408H853M47 408H22V383" fill="none" stroke="#e8e4da" stroke-width="1"/>
  </svg>`;
  return scene;
}

// Adapted from devzigs/zigs-site main 876e358; AGPL-3.0-only.
// Original 64-unit relief glyphs. Geometry is drawn here, without an icon dependency.
const paths = [
 '<path d="m10 22 22-11 22 11-22 11zM10 32l22 11 22-11M10 42l22 11 22-11"/><path d="M32 33v7m0 5v7"/>',
 '<circle cx="32" cy="14" r="6"/><circle cx="15" cy="45" r="6"/><circle cx="49" cy="45" r="6"/><path d="m28 20-9 18m17-18 9 18M22 45h20"/><path d="m26 33 5 5 9-12"/>',
 '<path d="M32 8c7 6 14 7 20 8v16c0 13-11 21-20 25-9-4-20-12-20-25V16c6-1 13-2 20-8Z"/><path d="M32 16c5 4 10 5 13 6v10c0 9-7 15-13 18-6-3-13-9-13-18V22c3-1 8-2 13-6Z"/><path d="m26 33 4 4 9-11"/>',
 '<path d="M35 17c-8-9-23-4-23 8 0 8 10 13 18 13m-1 9c8 9 23 4 23-8 0-8-10-13-18-13"/><path d="m22 29 20 7M22 22l20 7M22 36l20 7"/>',
 '<path d="M10 14h37v27H29L17 51V41h-7Z"/><path d="M21 23h15m-15 8h10M47 24h7v25H40l-9 7v-9"/><circle cx="46" cy="48" r="1"/>',
 '<path d="M13 33V23c0-25 38-25 38 0v10M20 29v-6c0-16 24-16 24 0v9c0 11-3 18-9 24M27 31v-8c0-7 10-7 10 0v9c0 8-1 14-5 20M13 39c0 6 2 11 5 16m3-20c0 9 1 14 4 20m2-19c0 5 0 8 2 11"/>',
 '<path d="M12 18a7 7 0 0 1 7-7h26a7 7 0 0 1 7 7v28a7 7 0 0 1-7 7H19a7 7 0 0 1-7-7Z"/><circle cx="30" cy="31" r="8"/><path d="M38 23v16c0 6 10 4 10-4m-8 12c-15 8-28-2-28-14"/>',
 '<path d="M12 13h18v12H12zM12 39h18v12H12zM40 26h14v12H40zM30 19h6v26h-6M36 32h4"/><path d="m16 19 3 3 6-6m-9 29 3 3 6-6m19-10h6"/>'
];
export function icon(index,prefix='metal') {
 const id=`${prefix}-${index}`;
 return `<svg class="feature-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="#fafafa"/><stop offset=".26" stop-color="#d8d8d8"/><stop offset=".51" stop-color="#777"/><stop offset=".73" stop-color="#c4c4c4"/><stop offset="1" stop-color="#888"/></linearGradient></defs><g fill="none" stroke="#050607" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" transform="translate(0 1.7)">${paths[index]}</g><g fill="none" stroke="url(#${id})" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round">${paths[index]}</g></svg>`;
}
export const arrow='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';

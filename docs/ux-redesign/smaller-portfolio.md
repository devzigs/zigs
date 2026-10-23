# Smaller portfolio balance panel

23 October 2026 · Web presentation only · Baseline `530d2b8` plus preserved local work

Removed the panel’s fixed minimum height and stretching to the taller Shared control panel.
At wide desktop sizes, actions sit beside the balance; asset rows follow the smaller panel
immediately. Existing amounts, labels, warnings, handlers and 48px controls are preserved.

The panel decreases from **298px to 175px**. At both 1440×728 and 1503×728 the three assets
now finish at 684px, rather than 807px, with no page scrolling in the tested fixture.
Narrower layouts retain stacking and may still scroll; no content is clipped or hidden.

| View | Before | After |
| --- | --- | --- |
| Desktop · dark | [Before](visuals/smaller-portfolio/before/1440-728-dark.png) | [After](visuals/smaller-portfolio/after/1440-728-dark.png) |
| Desktop · light | [Before](visuals/smaller-portfolio/before/1440-728-light.png) | [After](visuals/smaller-portfolio/after/1440-728-light.png) |

[Validation](smaller-portfolio-validation.json): 14 matching before/after captures across
320–1503px widths in both themes. No horizontal overflow, undersized tested controls or browser
errors. Visually inspected the rendered short-desktop layouts. All 56 focused existing Overview
checks pass, including Receive, unavailable actions, disclosures, large values and preferences;
contrast tests and stylesheet parsing/minification pass. Existing identity-only assertions are
excluded as documented in the preceding density pass. Browser fixtures are isolated and unfunded.
No wallet logic or native changes. Preview remains at `http://127.0.0.1:55846/`.

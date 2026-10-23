# Approved web logo

The user-supplied side-profile zebra, number texture, red eye and original transparency are the
approved Zigs artwork. The previous front-facing zebra has been replaced in web assets only.

`web/logo.png` is the canonical asset. Header, favicon and browser shortcut links share its
versioned URL, so browsers can reuse one download and avoid a cached older logo. The legacy
`web/favicon.png` and `web/apple-touch-icon.png` URLs contain the same approved artwork.

The original 1254-by-1254 image header and compressed pixel chunks are unchanged. Only EXIF and
text metadata were removed. No recoloring, background removal, cropping or generated replacement
was applied. The header renders the complete square at 44px with `object-fit: contain`.

[Browser validation](web-brand-validation.json) covers 320px and 1440px in light/dark themes,
correct asset references, complete image loading, square dimensions and absence of page overflow.
There were no uncaught browser errors. The native app assets remain identical to main.

Earlier UI-flow screenshots predate this branding update. Current branding is shown here:

![Approved logo in the web header](visuals/web-brand/logo-header-light-320.png)

![Web shell with approved branding](visuals/web-brand/logo-light-1440.png)

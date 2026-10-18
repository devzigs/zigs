// The saved appearance (app-theme.js) applies before the first paint. This is a classic script in
// the head: the page modules run only after the whole module graph has loaded.
try {
  const theme = localStorage.getItem("zf-theme");
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
} catch {
  // No storage: the device setting stays.
}

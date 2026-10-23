// Reuse this repository's existing build tool; no React or additional bundler.
import { build } from "../../../solspike/node_modules/esbuild/lib/main.js";
import { copyFile } from "node:fs/promises";
await build({ entryPoints: ["three-entry.js"], outfile: "vendor/three.js", bundle: true,
  format: "esm", minify: true, legalComments: "eof", target: "es2022" });
await copyFile("node_modules/three/LICENSE", "vendor/THREE-LICENSE.txt");

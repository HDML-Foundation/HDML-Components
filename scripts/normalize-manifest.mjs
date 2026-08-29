/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

// `cem analyze` emits modules in filesystem-traversal order, which is
// NOT stable between runs: three consecutive runs over an unchanged
// `src/` produced the same 78 modules in three different orders
// (measured at step 35). That is harmless for a consumer reading the
// manifest and fatal for a COMMITTED one — every `npm run build`
// would report `custom-elements.json` as modified, and a real drift
// would be indistinguishable from the noise.
//
// Sorting the module list by path is sufficient: with it applied,
// three samples were byte-identical. Nothing else in the document is
// order-dependent — declarations and exports are emitted in source
// order within a module, which is stable because the source is.
//
// This runs as the second half of `npm run manifest`, so the file on
// disk is always the normalized one, and `check-dist.mjs` asserts the
// ordering so a hand-edit or a skipped normalize is caught.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "custom-elements.json",
);

const manifest = JSON.parse(fs.readFileSync(file, "utf-8"));

manifest.modules.sort((a, b) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
);

fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `normalize-manifest OK — ${manifest.modules.length} modules, ` +
    "sorted by path.",
);

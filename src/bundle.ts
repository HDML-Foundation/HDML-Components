/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The entry point of the IIFE bundle at `bin/index.min.js`
 * (RFC 016/001 §9.2) — the only module that combines all three
 * layers.
 *
 * It is **not** a published entry point: it is absent from the
 * `exports` map, and it registers no tag of its own, so it is
 * excluded from CEM analysis alongside `src/index.ts` (§9.3).
 *
 * @module bundle
 */

import "./hdio";
import "./hdql";
import "./hdvl";

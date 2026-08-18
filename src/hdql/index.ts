/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `./hdql` entry point. Registers the eleven data elements.
 *
 * The import order below is the public registration order and is
 * load-bearing: it is the same order `src/index.ts` uses, and
 * `scripts/check-dist.mjs` asserts the two lists never drift.
 *
 * @module hdql
 */

import "./HdmlConnection";
import "./HdmlModel";
import "./HdmlTable";
import "./HdmlField";
import "./HdmlJoin";
import "./HdmlConnective";
import "./HdmlFilter";
import "./HdmlFrame";
import "./HdmlFilterBy";
import "./HdmlGroupBy";
import "./HdmlSortBy";

/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `./hdvl` entry point — the display half of HDML.
 *
 * Importing it registers **all twenty-one display tags** (R11).
 * They land in one commit and never move again: the four structural
 * elements — the view, both planes and `hdml-fallback` — arrive with
 * real bodies, and the other seventeen with their tag, their family
 * and their observed attributes. Bodies arrive per slice after this.
 * This is the canonical add-then-rewire: the tag surface is fixed,
 * nothing is ever removed, and V1/V13/W1 can index a tree of real
 * elements from the first slice rather than one salted with
 * `HTMLUnknownElement`s.
 *
 * **The boot is not here, and that is deliberate.** `import`
 * declarations are hoisted and evaluated before any statement in
 * their module, so `registerProperties()` written above these
 * imports would still run *after* every `@customElement` below. The
 * two boot calls therefore live in `./base`, the one module every
 * display element imports — which makes property registration and
 * sheet construction precede any element's construction as a fact
 * of the module graph rather than as a claim about statement order.
 *
 * The root `.` entry is untouched by this: it keeps exactly its
 * twelve registrations, so no consumer authoring an HDML document
 * pays for a geometry kernel it never draws with.
 *
 * Like `./hdql`, this entry re-exports **no element class**. That
 * is not an oversight either: typedoc documents whatever an entry
 * point exports, and a Lit subclass drags in Lit's own inherited
 * members, whose JSDoc links (`{@link css}`,
 * `{@link PropertyDeclaration}`) resolve to nothing here — 190
 * warnings for two symbols per class. The registration is the
 * public surface; the classes are reached by their tags.
 *
 * @module hdvl
 */

import "./view";
import "./plane-cartesian";
import "./plane-polar";
import "./fallback";
import "./scale-continuous";
import "./scale-datetime";
import "./scale-ordinal";
import "./mark-line";
import "./mark-area";
import "./mark-bar";
import "./mark-point";
import "./mark-arc";
import "./mark-rule";
import "./layout-pie";
import "./container-cluster";
import "./container-stack";
import "./guide-axis";
import "./guide-tick";
import "./guide-label";
import "./guide-grid";
import "./guide-legend";
// §8.5: `HDML.supports` registers on `globalThis.HDML` as an import
// side effect, so it must be imported for that effect — an
// unimported module registers nothing. It exports no element and
// adds nothing to this entry's public surface.
import "./supports";

export * from "./vocabulary";

/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

/**
 * The `./hdvl` entry point — the display half of HDML.
 *
 * **It registers no tag yet, and that is deliberate, not an
 * oversight.** RFC 016/001 R11 gives `./hdvl` the twenty-one display
 * tags; the step plan lands them all at once in Slice B, so the tag
 * surface arrives in a single commit and never moves afterwards.
 *
 * The entry exists now so that the `exports` map, the `sideEffects`
 * declaration and — most of all — the `.` bundle baseline are all
 * measured **before** any display module exists to perturb them.
 *
 * @module hdvl
 */

export * from "./vocabulary";

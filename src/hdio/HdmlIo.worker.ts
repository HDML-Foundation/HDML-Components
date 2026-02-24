/**
 * @author Artem Lytvynov
 * @copyright Artem Lytvynov
 * @license Apache-2.0
 */

import { onmessage } from "./onmessage";

globalThis.self.onmessage = onmessage;

const _script = "_script";
export default _script;

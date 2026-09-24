# HDVL corpus — live data

The thirteen pages of [`html/hdvl/`](../hdvl/) rebuilt on the **`maang`** schema,
served by the local HDIO at `http://127.0.0.1:8888` as `tenant-a`. Same thirteen
pages, same twenty-nine figures, same grammar in the same order — only the data
layer moved, so a difference between a page here and its twin there is a
difference in the runtime and not in the authoring.

Every page is standalone: it declares its own `hdml-model` (a `type="query"`
table over the five MAANG tables, unioned into long form) and its own frames.
That is the **dynamic-document** path, which `access.yml` grants wholesale.
One leg of `01` is the exception and reaches the tenant's **static** document
`/maang.html?hdml-frame=maang_stock_frame`, which is granted by exact path.

## Two rules that govern every page

**Types.** HDIO's Arrow writer emits four kinds — string, int64, float64, bool
([`internal/query/trino_executor.go`](../../../HDIO-Server/internal/query/trino_executor.go)).
A Trino `DATE`, `TIMESTAMP` or `DECIMAL` falls through to **string**. So:

- every numeric column is `cast(… as double)` in the model SQL. A bare
  `avg(if(c > o, 1.0, 0.0))` averages a `DECIMAL` and Trino rounds it to one
  decimal place — that bug flattened all five stocks to `0.5` while authoring
  `10`, and the symptom was a `NULL` spoke, not an error;
- **`hdml-datetime-scale` never takes `values="<column>"`**, because an ISO date
  arrives as text and text on a datetime scale is **V2**. The domain is authored
  (`min` / `max`) and the *marks* bind the ISO string, which projects through the
  same `instantOf` a literal does. Pages `01`, `02` A and `12` D.

**Filters.** `hdml-filter type="named"` emits its `values` **verbatim**
([`packages/stringifier/src/filter.ts`](../../../HDML-Utilities-TS/packages/stringifier/src/filter.ts)),
so a string value carries its own SQL quotes — `values="'Apple'"` — and a number
does not. `values="Apple"` becomes `sym = Apple`, which Trino reads as a column
reference. The mock corpus's `values="model-b"` in `10-radar` is the unquoted
form and would not execute.

## The pages

Every figure carries its own spec **on the page**, beside the chart: **Renders**
(what the picture is), **Grammar** (the element chain, which scale is on which
channel, and where each domain comes from) and **Validate** (a checklist of
concrete, numbered things to look at). The table below is the index; the pages
are the reference.


| Page | Figures | What it is for, and what to look at |
|---|---|---|
| [00](00-minimal.html) | 1 | The floor: two scales, four guides, one mark, **no CSS but a width**. Apple 411 M vs Netflix 16 M mean daily volume. |
| [01](01-line.html) | 1 | Two documents in one chart — Apple from a dynamic model, Microsoft from the static `/maang.html` frame. Microsoft crosses the $200 rule in 2021; Apple never does. |
| [02](02-area.html) | 2 | A: constant numeric baseline over a datetime x — the April 2022 Netflix spike (20.17 M) is the shape to check. B: string-constant baseline on a **band** y — Apple's volume band as a staircase. |
| [03](03-bar.html) | 3 | A and B are one frame twice: orientation is derived, so the bars must be the same five lengths turned 90°. C is a true two-column range (Apple's yearly low–high); 2023 is a partial year. |
| [04](04-grouped-stacked.html) | 5 | A–D have byte-identical children; only the container and the y domain differ. C (`offset="normalize"`) reverses the reading: the decline disappears and Apple's share (79 % → 45 %) is what is left. E is `hdml-stack` inside `hdml-cluster`, the only legal nesting. |
| [05](05-scatter.html) | 2 | 114 stock-years. B is the log case and not decoration — mean close spans $0.33 to $558.20. Note there is **no `min="0"`** on the log scale. |
| [06](06-bubble.html) | 1 | Four bound channels on four scales. `type="sqrt"` on size, so area ∝ value. Five categories against a five-entry palette — a sixth would be palette exhaustion, an error. |
| [07](07-mixed.html) | 1 | Dual axis via **sibling** same-channel scales. Apple 2004–2022: volume falls 13×, price rises 245×. The axes are what stop a reader taking the two curves as one story. |
| [08](08-pie-doughnut.html) | 4 | A (shares) and B (dollars) disagree — Apple is 58.7 % of one and 38.4 % of the other. **C must paint exactly what A paints**: same wedges, prefix sum computed in SQL instead of inside the widget. D puts A and B on one canvas as rings. |
| [09](09-polar-area.html) | 2 | Value → radius (a mark), against `08`'s value → angle (a layout widget). A is monthly seasonality with a continuous colour ramp; B is categorical, and the 25:1 volume spread should read as a **5:1 radius** ratio under the sqrt. |
| [10](10-radar.html) | 1 | Two subscribed series, one frame each, `hdml-filter-by` on both. Apple and Netflix are near-complements across the six spokes. The scores are min-max ranks, not magnitudes — the header says so. |
| [11](11-multi-plane.html) | 2 | A: three planes, one view-level source, **one query**, and one shared y domain — that is what makes the panels comparable. B: a padded detail plane over a full-bleed context plane (not a dual axis). |
| [12](12-coverage.html) | 4 | The grammar the other twelve do not reach: ramp legend + `hdml-fallback`, a gauge whose track is literal and whose value is a column, a stack with a `hidden` child (toggle it — the bands rebase, the ceiling does not move), and symlog over a zoned datetime. |

## Known defect — a frame sourced from another in-page frame

`08` C originally matched the mock and read `source="?hdml-frame=share"`. **It rendered
nothing.** Neither half of the usual suspects explains it: run exactly as the stringifier
generates it, that SQL returns the five correct rows against Trino, and the widget has a
committed corpus golden plus an explicit *"A's pie and C's arcs are one geometry"*
assertion. But the gate feeds the arcs ref **straight from a test double**, so nothing has
ever resolved the chain end to end — and a frame sourced from another **in-page** frame is
the only shape no live page under `html/` had run. Every other frame-on-frame here sources a
**static** document, which works (page `01`).

C now computes the same window functions over the grouped model, which is verified to give
byte-identical `a0`/`a1`, so the figure renders and the corpus keeps its
"A and C must match" check. **The root cause is not confirmed.** Reproducing it needs an
access token and the step that would have minted one was refused, so the next move is the
browser console: `src/hdio/parse.ts` logs `Unknown local source` when a sibling ref fails to
resolve, which would place the fault on the client rather than the server.

## What has been verified, and what has not

Verified before publishing:

- every one of the **13 model `identifier` queries** executes against the live
  Trino as `tenant-a`, and its output column types are all in the four supported
  Arrow kinds (no `DATE`, no `DECIMAL`);
- every one of the **23 frames** was probed against Trino as **HDML actually
  generates it** — fields sorted alphabetically into the SELECT, `GROUP BY` and
  `ORDER BY` by ordinal position into that sorted list, the cast applied *inside*
  the aggregation, and the `WHERE` built from `hdml-filter-by`. Row counts 1 to
  114, no failures. An earlier probe that wrote the `GROUP BY` by hand passed
  while `05`, `06` and `12` were live-broken: `yr` carried `aggregation="min"`
  *and* was a group key, so the generated SQL read `GROUP BY min("p_yr")`. A
  frame's group key is a **dimension** and must never carry an `aggregation`;
- all **36 models + frames** compile through the dev watcher into
  `bin/docs/`, and the emitted clauses were read back out of the artifacts;
- all **31 `hdml-*` tags** used here are registered in `custom-elements.json`;
- each page has exactly one `html` / `head` / `body` / `title`.

**Not** verified: how any of this renders. These pages need an interactive Google
login, so no figure on them has been seen in a browser — which is the job this
corpus exists for.

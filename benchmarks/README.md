# Benchmarks

Two harnesses, because they measure different things.

## `pnpm bench` — update-path overhead (happy-dom)

Runs the js-framework-benchmark operations under happy-dom. Fast, runs in CI,
and catches regressions.

**It cannot measure create or clear.** happy-dom's DOM is JavaScript, and it
dominates those operations. The included control test makes the split
explicit:

| | 10,000 rows |
|---|---|
| Hand-written DOM, no framework | ~384 ms |
| Volt | ~413 ms |

Volt's own overhead on create is roughly **8%** of that total — the remaining
92% is the environment. Optimising against that number would mean optimising
happy-dom.

Where Volt's own work does dominate, the numbers are meaningful:

| Operation | Meaning |
|---|---|
| partial update | 100 of 1,000 rows change |
| select row | one class binding across 1,000 rows |
| swap rows | two rows move |
| remove row | one row leaves |

## `pnpm --filter @voltdev/benchmarks run dev` — real browser

The page for real numbers, with buttons for each operation and coarse
timings. Use DevTools' Performance panel for a breakdown.

## `node benchmarks/browser/run.mjs` — one question, answered twice

The page above is for a person looking at numbers. This is for settling a
question between two builds, and it exists because the roadmap has one:
`groupRowBindings` emits one effect per row instead of one per binding, which
should help `create` and hurt `select row`, and no amount of argument decides
which wins.

It builds the same page twice — the flag off, then on — serves each, and drives
one headless Chrome through both. Doing it in one process under one browser is
the point: machine load, browser version and GC state are held still, so the
ratio it prints is about the codegen and not about the afternoon.

```bash
node benchmarks/browser/run.mjs --iterations 15 --rows 10000
```

No dependency is added for it. Chrome is driven over the DevTools protocol
through Node's own `WebSocket`, and the built pages are served by a static
handler in the file.

It also builds the same table by hand, into a container of its own, so
`create` has something to be a ratio *of*. Anything Volt costs above the
hand-written version is Volt's to account for.

```bash
node benchmarks/browser/run.mjs --profile --rows 10000
```

swaps the comparison for a sampling profile of `create` alone — the `clear`
taken out of the sampled region, because `clear`'s `replaceContent` otherwise
comes out on top of a loop nobody runs — and builds unminified, because the
whole output of a profile is the names.

### What it answered

**`create` costs 1.06–1.13x hand-written DOM** at 10,000 rows, reproducible to
within a few percent. The profile says where: under 6% of `create` is Volt's own
JavaScript, against 68% layout and 17% browser internals, with GC, `cloneNode`
and `insertBefore` after them — all of which hand-written code pays too. No
function of Volt's is above about 1% of self time. There is no hot spot; the
overhead is the per-row work itself, thinly spread.

**`groupRowBindings` stays off, and it is a trade rather than a loss.** At
10,000 rows it wins 5–11% of `create` and costs 13–35% of `select row`. It stays
off because `select row` is where the gap is concentrated and is paid on every
selection, where `create` is paid once.

An earlier version of this file said `create` was neutral to slightly worse
under grouping. That was measured with a harness that ran `create` straight
after a `clear`, where allocation and layout state differ run to run; building
and discarding a hand-written table first settles it. The conclusion moved with
the measurement.

At 1,000 rows `select row` lands at 0.4 ms — four ticks of Chrome's coarsened
`performance.now` — and its ratio swings from 0.80 to 1.20 between runs. That is
the clock. Use 10,000 rows for anything about `select`.

Two things to know before trusting a run. `performance.now` is coarsened to
100µs in Chrome, and a select over a thousand rows lands within a few ticks of
that — which is why means are printed beside medians, and why a difference
visible only in the median at that size is not a difference. And the numbers
move a long way under load: a run taken while anything else is busy can report
a mean at 1.7x its own median, which is the machine talking. Run it on a quiet
one.

For official comparisons, run Volt through the real
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
harness, which drives Chrome via WebDriver and controls for GC, warmup, and
paint. `src/bench-app.ts` is written to match the reference implementations
so it can be dropped in.

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kiowayyy2109/makefun-csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Kiowayyy2109/makefun-csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# makefun-csv-reader-speed-01

A fast drop-in replacement for csv-reader 1.0.0, built for the make.fun
competition "Read broken CSV files faster, 21 November 2026"
(`csv-reader-speed-01-run-20261121`).

`run(input)` in `solve.js` returns exactly what csv-reader 1.0.0 returns for
every input `{text, header}` — the value `{columns, rows, errors}`, with the
same broken-row policy: a leading U+FEFF is dropped, records end at LF or
CRLF, empty lines are not records, stray CRs are dropped (`stray_cr`), text
after a closing quote is appended verbatim (`quote_junk`), a quote that never
closes is re-read as a literal (`unterminated_quote`), and rows are padded
(`short_row`) or cut (`long_row`) to the first record's width, with every
error reported as `{code, line, row}` in the order met.

## How it is fast

The reference reader walks the text one character at a time and builds each
field character by character. This reader instead jumps between interesting
positions with native `indexOf` searches — commas and line feeds for
unquoted fields, the closing quote for quoted fields — and takes field
values as slices of the original string. A monotone cursor caches the next
carriage return, so CR checks across a whole parse cost a single native
pass. Only fields that actually contain a stray CR, a doubled quote, or a
CR inside quotes fall back to a segment-stitching path. Semantics never
change: the scanner was verified byte-for-byte against csv-reader 1.0.0 on
the practice set, on generated full-size cases, and on ~130,000 adversarial
fuzz inputs.

## Layout

- `solve.js` — the reader; a dependency-free ES module exporting `run(input)`.
- `main.ts` — the harness driver: reads `/input/cases.json`, answers each
  case with `run`, writes `/output/answers.json` (`MAKEFUN_INPUT_DIR` /
  `MAKEFUN_OUTPUT_DIR` override the locations outside the container).

## License

MIT

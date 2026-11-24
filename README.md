# token-radar-01-entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tongsang199712-cyber/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tongsang199712-cyber/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: a token launch radar that reads the sealed DefiLlama snapshot of 758 protocols and ranks all 198 that record no token — and are not a wrapped, staked or bridged product of one that trades — by implied launch value. The multiple for each protocol comes from the snapshot itself: the median market-cap-to-TVL ratio of the live-token protocols in its category, shrunk toward the global median, then adjusted for seven-day TVL momentum and for how long the protocol has run with no token. Every row carries a seven-step farm plan with costs and times, and the static dashboard (no network) offers the ranked board, a per-protocol detail view with the model's working, category and chain filters, sorting, and the set of already-trading protocols the multiples were derived from.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

Node 22.18 or later, standard library only. `--input` also accepts the directory holding `snapshot.json`. The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and a byte-exact `dossier.json` (built with the vendored `vendor/makefun-board.ts`) into the output directory, and writes the same bytes on every run.

---

<sub>Entered on [make.fun](https://make.fun/?ref=dd7e8ra1&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

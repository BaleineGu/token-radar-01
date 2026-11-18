[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/BaleineGu/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/BaleineGu/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

# Launch Radar: comps-fitted value tested out of sample, every farm plan netted to the dollar

A token launch radar for the make.fun bounty `token-radar-01` ($1,325, top 10
paid, deadline 2026-12-14T10:00:00Z), by @guinrm. This is the v3 rebuild:
the v1 entry ranked the same 198 protocols with a hand-tuned formula and
scored 88.70%; v2 replaced the formula with a fitted model and showed its
validation on the board, but its grade run failed — the repository still
held a stale v1 screenshot, so five images reached the dossier builder,
which takes at most four. v3 keeps the v2 model and board unchanged and
fixes the run: the screenshot copy now takes at most four images, in name
order, and warns about any extra it skips (and the stale file is deleted
from the repository as well).

## What it does

The program reads the sealed DefiLlama snapshot (`input/snapshot.json`,
fetched 2026-11-14, 758 protocols at or above $5M TVL) and ranks the
protocols that **record no token** — no market cap, no CoinGecko id, no
ticker — and are not a wrapped, staked, bridged or exchange product.

- **Board:** 198 pre-token protocols, all 40 of the house watchlist plus 158
  more below its $50M floor, ranked by implied value. The top row is
  Sentora Curator at $44.3M implied.
- **Value model (comps-1):** a ridge regression of log market cap on log
  TVL, chain breadth, age and seven-day growth, with one coefficient per
  large category, fitted on the 93 traded protocols in the snapshot (one
  per ticker; bridges, liquid staking and CEX left out — they price like
  custody, not like a launch). The same fitted curve prices every row; no
  protocol name is special-cased.
- **Validation, printed on the board:** leave-one-out median miss ×3.45,
  P25–P75 range holds 51% of leave-one-out truths, walk-forward miss ×2.93
  (fit before 2025, tested after), launch-odds Brier 0.235 against a
  base-rate 0.248 in five-fold cross-validation.
- **Launch odds:** a logistic fit on age and size over all 758 protocols —
  the share of comparable protocols that already record a token — with a
  calibration table by age band on the validation tab.
- **Farm verdicts, netted to the dollar:** each row's expected gross is
  launch odds × 15% farmer share × implied value × deposit ÷ TVL; net
  subtracts gas (six transactions at the chain's estimated cost) and $4.10
  of opportunity cost. FARM means net ≥ $10 on the plan's deposit, MARGINAL
  means net ≥ $0, anything else is SKIP. 13 rows are FARM. Every plan is
  seven concrete steps with cost and time, and a break-even implied value.
- **Live tokens set aside:** the 24 largest already-trading protocols by
  market cap, shown at the market's own value, never a model's.

## How to run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only. The run is deterministic: two runs write
byte-identical outputs. Open `out/dashboard/index.html` in a browser; the
page needs no network.

## Files

- `main.ts` — entrypoint: reads the snapshot, writes `board.json`,
  `data.js`, copies `dashboard/` and `screenshots/`, writes `dossier.json`
- `lib/model.ts` — the comps-fitted model, validation, odds and farm economics
- `dashboard/` — the page: board, detail drawer, validation tab, live tab,
  model sandbox
- `screenshots/` — board, detail, validation panel, filtered view
- `vendor/makefun-board.ts` — make.fun's dossier library, copied unchanged

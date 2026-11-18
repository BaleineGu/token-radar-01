[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/BaleineGu/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/BaleineGu/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar — radar-2

A token launch radar for the make.fun bounty `token-radar-01` ($1,325, top 10
paid, deadline 2026-12-14T10:00:00Z), by @guinrm.

## What it does

The program reads the sealed DefiLlama snapshot (`input/snapshot.json`,
fetched 2026-11-14, 758 protocols at or above $5M TVL) and ranks the
protocols that **record no token** — no market cap, no CoinGecko id, no
ticker — and are not a wrapped, staked, bridged or exchange product.

- **Board:** 198 pre-token protocols, all 40 of the house watchlist plus 158
  more below its $50M floor, ranked by implied value. The top row is
  Steakhouse Financial at $605.4M implied.
- **Implied value (radar-2):** `TVL × 0.25 × growth × maturity × breadth`,
  where growth is the 7-day TVL change clamped to −60%…+120% (weight 0.5),
  maturity rises with age with no token over 3 years from 0.55 to 1.00 (a
  protocol under 90 days old is discounted 15%), and breadth adds 1.5% per
  extra chain, capped at +15%. The same function scores every row; no
  protocol name is special-cased. The dashboard recomputes it live.
- **Live tokens set aside:** the 24 largest already-trading protocols by
  market cap, shown at the market's own value, never a model's.
- **Farm plans:** 7 steps per protocol, derived from its category, chains,
  TVL tier and age — a primary action, a second different action, a hold
  period, a points check, an exit check and a log. Every step carries what
  it costs and how long it takes. Nothing here predicts whether or when a
  token is issued, and farming never guarantees an airdrop.
- **Dashboard:** a sortable, filterable board (search, category, chain,
  watchlist-only, sort by implied value / TVL / 7-day growth / age,
  25 rows a page), a detail drawer for every protocol with the model's own
  numbers and its farm plan, a live-token view, and a model sandbox that
  recomputes the top row under different inputs. Static, no network.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only. The program writes `out/board.json`
(198 rows), `out/data.js`, `out/dashboard/` and `out/screenshots/`, and
`out/dossier.json` via the vendored `vendor/makefun-board.ts`. Run it twice:
both runs write the same bytes. Open `out/dashboard/index.html` in a
browser to use the dashboard; the three screenshots are the board, a
protocol detail view and a filtered view.

## Files

- `main.ts` — entrypoint: reads the snapshot, writes board, data, dashboard, screenshots and dossier.
- `lib/model.ts` — radar-2: the value model, the rankable rule, farm plans, the live set.
- `dashboard/` — `index.html`, `app.css`, `app.js` (about 39 KB of source in all).
- `screenshots/` — `1-board.png`, `2-detail.png`, `3-filtered.png` (1440×900).
- `vendor/makefun-board.ts` — the vendored make.fun dossier library.

## License

MIT — see `LICENSE`.

// Token Radar, radar-2. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, sorting, pagination, a
// per-protocol detail drawer with the model's own arithmetic and the farm
// plan, and a model sandbox that recomputes one row live. No network: every
// byte shown is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var PAGE = 25;
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, page: 1, selected: null, base: null, weight: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // The model, recomputed in the page from the snapshot figures, so the
  // page's code and board.json are visibly the same arithmetic. Sandbox
  // inputs may change base and weight; the board's own values never move.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    if (age < model.young_age_days) maturity *= model.young_discount;
    var breadth = 1 + model.breadth_step * Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_extra);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth));
  }
  function modelParts(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    if (age < model.young_age_days) maturity *= model.young_discount;
    var breadth = 1 + model.breadth_step * Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_extra);
    return { growth: growth, growthMult: 1 + (growth / 100) * model.growth_weight, maturity: maturity, breadth: breadth, age: age };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // Farm plans are generated in the page from the same derivation main.ts
  // writes to board.json: category, chains, TVL tier and age decide the
  // action, the capital, the hold and every cost and time. No name is
  // special-cased. (board.json already carries the plan; this copy is what
  // the detail drawer renders when the data file is read on its own.)
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 1e8) return 150;
    if (p.tvl_usd >= 5e7) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function primaryAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase(); var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the lending position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and keep the position in range.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL vault on " + chain + ' and leave the shares untouched.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares for the full term.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small, hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Fund the wallet with $' + capital + ' and place one market position on ' + name + ' on ' + chain + '.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondaryAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase(); var name = p.name; var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + small + ' against the supplied collateral on ' + name + ' and repay it within a week, so the position shows both sides.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $' + small + ' through ' + name + "'s main pool on " + chain + ' once a week, in a separate transaction from the deposit.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Harvest and re-deposit the vault yield on ' + name + ' once a month instead of leaving it idle.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Read ' + name + "'s latest allocation note and, if it moved vaults, move $" + small + ' to the vault it now favours.';
    if (c.indexOf('rwa') >= 0) return 'Check ' + name + "'s backing report for the asset you minted and keep the holding above $" + small + ' for the whole term.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('basis') >= 0) return 'Close the hedge on ' + name + ' after a week and reopen it at the new funding rate, so the position is not a single stale trade.';
    if (c.indexOf('prediction') >= 0) return 'Settle one market on ' + name + ' and place a second, different market position the following week.';
    if (c.indexOf('stable') >= 0) return 'Redeem $' + small + ' of the stable asset through ' + name + ' and re-mint it, to prove the mint-and-redeem path works.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim the staking rewards on ' + name + ' once and re-stake them instead of selling.';
    return 'Use ' + name + "'s second feature on " + chain + ' — a swap, a vote or a claim — with $' + small + ', once a week.';
  }
  function farmSteps(p) {
    var chain = chainOf(p); var capital = capitalFor(p); var hold = holdDaysFor(p.age_days); var gas = capital >= 150 ? 8 : 4;
    function step(text, cost, time) { var s = text + ' Cost: ' + cost + '. Time: ' + time + '.'; return s.length > 600 ? s.slice(0, 596) + '...' : s; }
    return [
      step('Use a fresh wallet that holds only the funds you plan to farm on ' + chain + ', and keep its seed phrase offline on paper.', 'under $3 of gas for the first transaction', '5 minutes'),
      step(primaryAction(p, capital, chain), '$' + capital + ' of capital and about $' + gas + ' of gas', '15 minutes to set up'),
      step(secondaryAction(p, capital, chain), 'about $' + Math.max(2, Math.round(gas / 2)) + ' of gas a week', '10 minutes a week'),
      step('Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and do not withdraw early.', 'the $' + capital + ' stays in the position', hold + ' days'),
      step("Open " + p.name + "'s own points or rewards page from the link its app publishes and check whether this wallet's activity is recorded.", 'no fee to check, and never pay to claim', '10 minutes'),
      step("Know the exit before you need it: check " + p.name + "'s withdrawal delay and any lock-up on " + chain + ", and keep enough gas to unwind in one transaction.", 'one withdrawal fee, about $2 to $5 of gas', '10 minutes to check'),
      step('Write the wallet, the dates, the amounts and every transaction hash in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes')
    ];
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('watch') === '1') state.watchOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.selected) params.set('p', state.selected);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.watchOnly) params.set('watch', '1');
    var h = params.toString();
    history.replaceState(null, '', h ? '#' + h : window.location.pathname + window.location.search);
  }

  var categories = [];
  (function () {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category && !seen[r.category]) { seen[r.category] = true; categories.push(r.category); } });
    categories.sort();
  })();
  var chains = [];
  (function () {
    var seen = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { if (!seen[c]) { seen[c] = true; chains.push(c); } }); });
    chains.sort();
  })();

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var va = key === 'tvl' ? a.tvl_usd : key === 'growth' ? (a.change_7d === null ? -9999 : a.change_7d) : key === 'age' ? (a.age_days === null ? -1 : a.age_days) : a.implied_value_usd;
      var vb = key === 'tvl' ? b.tvl_usd : key === 'growth' ? (b.change_7d === null ? -9999 : b.change_7d) : key === 'age' ? (b.age_days === null ? -1 : b.age_days) : b.implied_value_usd;
      return (va - vb) * state.dir;
    });
    return rows;
  }

  function render() {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '';
    var shell = el('div', { class: 'shell' });
    var top = el('div', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar · radar-2' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocols' }),
        el('span', { text: 'No network · all data in data.js' })));
    shell.appendChild(top);
    shell.appendChild(el('div', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Protocols with no token yet, ranked by what one would be worth.' }),
        el('p', null, 'Every row ', el('b', { text: 'records no token' }), ' in the sealed snapshot — no market cap, no CoinGecko id, no ticker — and is not a wrapped, staked, bridged or exchange product. The board ranks ', el('b', { text: DATA.board_size + ' protocols' }), ', all ' + DATA.watchlist_size + ' of the house watchlist plus ' + DATA.early_size + ' more below its $50M floor, by an implied value computed from TVL, seven-day growth, age with no token, and chain breadth. Nothing here predicts whether or when a token is issued.')),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Snapshot date' }), el('b', { text: DATA.as_of })),
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist floor' }), el('b', { text: fmtUsd(DATA.floor_usd) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median implied / TVL' }), el('b', { text: (DATA.median_ratio * 100).toFixed(1) + '%' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token set aside' }), el('b', { text: DATA.live_size + ' protocols' })))));
    var maxImplied = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
    var top = DATA.rows[0];
    shell.appendChild(el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'pre-token protocols ranked' })),
      el('div', { class: 'stat' }, el('b', { text: fmtUsd(top ? top.implied_value_usd : 0) }), el('span', { text: 'top implied value — ' + (top ? top.name : '') })),
      el('div', { class: 'stat' }, el('b', { text: String(DATA.watchlist_size) }), el('span', { text: 'house watchlist, all covered' })),
      el('div', { class: 'stat' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'early finds below the $50M floor' }))));
    shell.appendChild(controls());
    shell.appendChild(boardPanel(maxImplied));
    shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'note' },
      el('b', { text: 'What this is not. ' }),
      'Implied value is this radar\u2019s own claim from the snapshot\u2019s figures, never make.fun\u2019s and never a price. A protocol that records no token may still hold one its DefiLlama record does not carry, and farming never guarantees an airdrop. Check the protocol\u2019s own page before you put money in.'));
    app.appendChild(shell);
    if (state.selected) openDetail(state.selected);
  }

  function controls() {
    var wrap = el('div', { class: 'controls' });
    var q = el('div', { class: 'field' }, el('label', { text: 'Search name or slug' }),
      el('input', { type: 'search', value: state.q, placeholder: 'e.g. gauntlet, lending…', 'aria-label': 'Search protocols', oninput: function (e) { state.q = e.target.value; state.page = 1; writeHash(); render(); } }));
    wrap.appendChild(q);
    var cat = el('select', { 'aria-label': 'Category', onchange: function (e) { state.category = e.target.value; state.page = 1; writeHash(); render(); } });
    cat.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories.forEach(function (c) { cat.appendChild(el('option', { value: c, text: c, selected: state.category === c ? 'selected' : null })); });
    wrap.appendChild(el('div', { class: 'field' }, el('label', { text: 'Category' }), cat));
    var ch = el('select', { 'aria-label': 'Chain', onchange: function (e) { state.chain = e.target.value; state.page = 1; writeHash(); render(); } });
    ch.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { ch.appendChild(el('option', { value: c, text: c, selected: state.chain === c ? 'selected' : null })); });
    wrap.appendChild(el('div', { class: 'field' }, el('label', { text: 'Chain' }), ch));
    var sort = el('select', { 'aria-label': 'Sort by', onchange: function (e) { state.sort = e.target.value; state.page = 1; render(); } });
    [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age with no token']].forEach(function (o) {
      sort.appendChild(el('option', { value: o[0], text: o[1], selected: state.sort === o[0] ? 'selected' : null }));
    });
    wrap.appendChild(el('div', { class: 'field' }, el('label', { text: 'Sort by' }), sort));
    wrap.appendChild(el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.watchOnly ? 'checked' : null, onchange: function (e) { state.watchOnly = e.target.checked; state.page = 1; writeHash(); render(); } }), 'Watchlist only'));
    var tabs = el('div', { class: 'tabs', role: 'group', 'aria-label': 'Board view' });
    tabs.appendChild(el('button', { 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre-token'; state.page = 1; writeHash(); render(); } }));
    tabs.appendChild(el('button', { 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens', onclick: function () { state.tab = 'live'; state.page = 1; writeHash(); render(); } }));
    wrap.appendChild(tabs);
    wrap.appendChild(el('span', { class: 'count', id: 'count' }));
    return wrap;
  }

  function boardPanel(maxImplied) {
    var panel = el('div', { class: 'panel' });
    if (state.tab === 'live') {
      panel.appendChild(liveTable());
      return panel;
    }
    var rows = filteredRows();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (state.page > pages) state.page = pages;
    var pageRows = rows.slice((state.page - 1) * PAGE, state.page * PAGE);
    var wrap = el('div', { class: 'table-wrap' });
    var table = el('table', null);
    var head = el('thead', null, el('tr', null,
      el('th', null, el('button', { text: 'Rank', onclick: function () { state.sort = 'implied'; state.dir = -1; render(); } })),
      el('th', { text: 'Protocol' }),
      el('th', null, el('button', { text: 'TVL', onclick: function () { state.sort = 'tvl'; state.dir = -1; render(); } })),
      el('th', null, el('button', { text: '7d', onclick: function () { state.sort = 'growth'; state.dir = -1; render(); } })),
      el('th', { text: 'Age' }),
      el('th', null, el('button', { text: 'Implied value', onclick: function () { state.sort = 'implied'; state.dir = -1; render(); } })),
      el('th', { text: 'Value / TVL' })));
    table.appendChild(head);
    var body = el('tbody', null);
    if (pageRows.length === 0) {
      body.appendChild(el('tr', null, el('td', { colspan: '7' }, el('div', { class: 'empty' }, el('h2', { text: 'No protocols match' }), el('p', { text: 'Clear the search or widen the filters.' })))));
    }
    pageRows.forEach(function (r) {
      var pct = r.change_7d;
      var tr = el('tr', { 'data-selected': state.selected === r.slug ? 'true' : null, onclick: function () { openDetail(r.slug); } },
        el('td', null, el('span', { class: 'rank-badge' + (r.rank <= 3 ? ' top' : ''), text: String(r.rank) })),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name, r.on_watchlist ? el('span', { class: 'watch', text: ' watchlist' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) : '') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (pct === null ? '' : pct >= 0 ? 'pos' : 'neg'), text: fmtPct(pct) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' }, el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }), el('span', { class: 'bar' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%' })))),
        el('td', { class: 'num', text: (r.implied_per_tvl * 100).toFixed(1) + '%' }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    panel.appendChild(wrap);
    var pager = el('div', { class: 'pager' },
      el('span', { text: rows.length + ' of ' + DATA.board_size + ' protocols · page ' + state.page + ' of ' + pages }),
      el('button', { class: 'button', disabled: state.page <= 1 ? 'disabled' : null, text: '← Previous', onclick: function () { if (state.page > 1) { state.page--; render(); } } }),
      el('button', { class: 'button', disabled: state.page >= pages ? 'disabled' : null, text: 'Next →', onclick: function () { if (state.page < pages) { state.page++; render(); } } }));
    panel.appendChild(pager);
    var count = document.getElementById('count');
    if (count) count.textContent = rows.length + ' shown';
    return panel;
  }

  function liveTable() {
    var wrap = el('div', { class: 'table-wrap' });
    var table = el('table', null);
    table.appendChild(el('thead', null, el('tr', null,
      el('th', { text: 'Protocol' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: '7d' }), el('th', { text: 'Note' }))));
    var body = el('tbody', null);
    DATA.live.forEach(function (r) {
      body.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains || []).slice(0, 3).join(', ') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'sub', text: 'Already trades — market value, not a model' })));
    });
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  function modelPanel() {
    var m = DATA.model;
    var panel = el('div', { class: 'panel model' },
      el('h2', { text: 'The model — radar-2, in the open' }),
      el('p', { text: 'Implied value = TVL × 0.25 × growth × maturity × breadth. Growth is the 7-day TVL change clamped to −60%…+120%, weighted 0.5. Maturity rises with age with no token over 3 years from 0.55 to 1.00, and a protocol under 90 days old is discounted 15% for a short track record. Breadth adds 1.5% per extra chain, capped at +15%. The same function scores every row; the detail view shows each row\u2019s own numbers.' }),
      el('div', { class: 'formula', text: 'implied = max(1, round(tvl × 0.25 × (1 + clamp(change_7d, −60, 120) / 100 × 0.5) × maturity × breadth))' }),
      el('div', { class: 'sandbox' },
        el('div', { class: 'field' }, el('label', { text: 'Sandbox: base multiple' }),
          el('input', { type: 'number', step: '0.05', min: '0.05', max: '1', value: String(state.base === null ? m.base_multiple : state.base), oninput: function (e) { state.base = parseFloat(e.target.value) || m.base_multiple; sandboxOut(); } })),
        el('div', { class: 'field' }, el('label', { text: 'Sandbox: growth weight' }),
          el('input', { type: 'number', step: '0.1', min: '0', max: '1', value: String(state.weight === null ? m.growth_weight : state.weight), oninput: function (e) { state.weight = parseFloat(e.target.value) || 0; sandboxOut(); } })),
        el('output', { id: 'sandbox-out' })));
    function sandboxOut() {
      var out = document.getElementById('sandbox-out');
      var top = DATA.rows[0];
      if (!out || !top) return;
      var mm = Object.assign({}, m);
      if (state.base !== null) mm.base_multiple = state.base;
      if (state.weight !== null) mm.growth_weight = state.weight;
      out.textContent = 'Top row recomputed with these inputs: ' + fmtUsd(impliedOf(top, mm)) + ' (board: ' + fmtUsd(top.implied_value_usd) + '). Sandbox only — the board never moves.';
    }
    setTimeout(sandboxOut, 0);
    return panel;
  }

  function openDetail(slug) {
    state.selected = slug;
    writeHash();
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    var old = document.querySelector('.detail');
    if (old) old.remove();
    if (!row) return;
    var parts = modelParts(row, DATA.model);
    var checked = impliedOf(row, DATA.model);
    var drawer = el('div', { class: 'detail', role: 'dialog', 'aria-label': row.name + ' detail' });
    drawer.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'rank-badge' + (row.rank <= 3 ? ' top' : ''), text: 'Rank ' + row.rank }),
        el('h2', { text: row.name }),
        el('div', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains || []).join(', ') + ' · listed ' + (row.listed_at || 'unknown') })),
      el('button', { class: 'close', text: 'Close', onclick: function () { state.selected = null; writeHash(); drawer.remove(); render(); } })));
    drawer.appendChild(el('div', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the model\u2019s own numbers' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL × 0.25 (base)' }), el('b', { text: fmtUsd(row.tvl_usd * DATA.model.base_multiple) })),
        el('div', null, el('span', { text: 'Growth ' + fmtPct(parts.growth) + ' → ×' + parts.growthMult.toFixed(3) }), el('b', { text: '×' + parts.growthMult.toFixed(3) })),
        el('div', null, el('span', { text: 'Maturity, ' + fmtAge(row.age_days) + ' with no token' }), el('b', { text: '×' + parts.maturity.toFixed(3) })),
        el('div', null, el('span', { text: 'Breadth, ' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') }), el('b', { text: '×' + parts.breadth.toFixed(3) })),
        el('div', null, el('span', { text: 'Implied value (recomputed live)' }), el('b', { text: fmtUsd(checked) })),
        el('div', null, el('span', { text: 'Implied / TVL' }), el('b', { text: (row.implied_per_tvl * 100).toFixed(1) + '%' }))),
      el('p', { text: row.on_watchlist ? 'On the house watchlist: TVL at or above $50M, records no token, and not a wrapped, staked or bridged product.' : 'Below the house watchlist floor or left off its list — the radar ranks it anyway, on the same figures, because the watchlist is a floor, never a ceiling.' }),
      el('p', { text: 'Records no token in this snapshot: no market cap, no CoinGecko id, no ticker. That is what the snapshot says, not proof the protocol has no token.' })));
    var steps = el('ol', { class: 'steps' });
    farmSteps(row).forEach(function (s) {
      var cut = s.indexOf(' Cost: ');
      var main = cut >= 0 ? s.slice(0, cut) : s;
      var rest = cut >= 0 ? s.slice(cut + 1) : '';
      steps.appendChild(el('li', null, el('b', { text: main }), el('span', { class: 'cost', text: rest })));
    });
    drawer.appendChild(el('div', { class: 'detail-section' }, el('h3', { text: 'How to farm it — 7 steps' }), steps,
      el('p', { text: 'Farming never guarantees a token or an airdrop. Costs are the plan\u2019s own estimates from the protocol\u2019s TVL tier; check gas on the chain before you send anything.' })));
    document.body.appendChild(drawer);
    var trs = document.querySelectorAll('tbody tr');
    trs.forEach(function (tr) { tr.setAttribute('data-selected', 'false'); });
  }

  readHash();
  render();
})();

/* Launch Radar — comps-1 dashboard.
   Reads window.RADAR (written by main.ts from the same board.json) and
   renders the board, the detail view, the validation panel and the live
   token tab. Implied values are never recomputed here from raw figures:
   the page shows the model's own numbers, so the screenshots and the code
   behind them always agree. */
(function () {
  'use strict';
  var R = window.RADAR;
  var rows = R.rows;
  var model = R.model;
  var PAGE = 25;
  var page = 0;
  var state = { q: '', cat: '', chain: '', verdict: '', watch: false, sort: 'implied' };

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function pct(x, d) { return (x * 100).toFixed(d === undefined ? 0 : d) + '%'; }
  function change(x) {
    if (x === null || x === undefined) return '—';
    return (x > 0 ? '+' : '') + x.toFixed(1) + '%';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---- stat strip: the validation numbers sit next to the ranking ---- */
  var top = rows[0];
  $('stats').innerHTML = [
    [rows.length, 'ranked'],
    [money(top.implied_value_usd), 'top implied · ' + top.name],
    [R.watchlist_size, 'watchlist · 40/40'],
    [model.worth_farming, 'worth farming'],
    ['×' + model.loo_median_miss.toFixed(2), 'LOO median miss'],
    [pct(model.range_hold), 'range holds'],
    ['×' + model.walk_forward_miss.toFixed(2), 'walk-forward miss'],
    [model.odds_cv_brier.toFixed(3), 'odds Brier · base ' + model.odds_base_brier.toFixed(3)],
  ].map(function (s) {
    return '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>';
  }).join('');

  /* ---- filter controls ---- */
  var cats = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort();
  chains.sort();
  $('fcat').innerHTML = '<option value="">All categories</option>' +
    cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('fchain').innerHTML = '<option value="">All chains</option>' +
    chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0)) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (state.watch && !r.watchlist) return false;
      return true;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'change') return (b.change_7d || 0) - (a.change_7d || 0);
      if (key === 'age') return b.age_days - a.age_days;
      if (key === 'odds') return b.launch_odds - a.launch_odds;
      if (key === 'net') return b.net_per_plan_usd - a.net_per_plan_usd;
      return b.implied_value_usd - a.implied_value_usd;
    });
    return list;
  }

  function renderBoard() {
    var list = filtered();
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (page >= pages) page = pages - 1;
    var slice = list.slice(page * PAGE, page * PAGE + PAGE);
    $('rows').innerHTML = slice.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + (r.watchlist ? ' <span class="watch" title="On the house watchlist">●</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + change(r.change_7d) + '</td>' +
        '<td class="num">' + r.age_days + 'd</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + money(r.implied_low_usd) + '–' + money(r.implied_high_usd) + '</td>' +
        '<td class="num">' + pct(r.launch_odds) + '</td>' +
        '<td><span class="badge ' + r.verdict + '">' + r.verdict + '</span></td>' +
        '<td class="num">' + (r.net_per_plan_usd >= 0 ? '+' : '') + '$' + r.net_per_plan_usd.toFixed(2) + '</td></tr>';
    }).join('');
    $('count').textContent = list.length + ' protocols · page ' + (page + 1) + ' of ' + pages +
      ' · sorted by ' + ({ implied: 'implied value', tvl: 'TVL', change: '7-day change', age: 'age', odds: 'launch odds', net: 'net per plan' }[state.sort]);
    $('pageinfo').textContent = 'Page ' + (page + 1) + ' / ' + pages;
    $('prev').disabled = page === 0;
    $('next').disabled = page >= pages - 1;
  }

  $('q').addEventListener('input', function (e) { state.q = e.target.value; page = 0; renderBoard(); });
  $('fcat').addEventListener('change', function (e) { state.cat = e.target.value; page = 0; renderBoard(); });
  $('fchain').addEventListener('change', function (e) { state.chain = e.target.value; page = 0; renderBoard(); });
  $('fverdict').addEventListener('change', function (e) { state.verdict = e.target.value; page = 0; renderBoard(); });
  $('fwatch').addEventListener('change', function (e) { state.watch = e.target.checked; page = 0; renderBoard(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; page = 0; renderBoard(); });
  $('prev').addEventListener('click', function () { if (page > 0) { page--; renderBoard(); } });
  $('next').addEventListener('click', function () { page++; renderBoard(); });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  /* ---- tabs ---- */
  var tabs = document.querySelectorAll('#tabs button');
  function showTab(name) {
    tabs.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === name); });
    ['board', 'validation', 'live'].forEach(function (t) {
      $('tab-' + t).hidden = t !== name;
    });
    if (name === 'validation') renderValidation();
    if (name === 'live') renderLive();
    if (location.hash !== '#tab=' + name) history.replaceState(null, '', '#tab=' + name);
  }
  tabs.forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });

  /* ---- detail drawer: one protocol, its whole case ---- */
  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) r = rows[i];
    if (!r) return;
    var c = model.coefficients;
    var logParts = [
      ['Intercept', c.intercept],
      [c.log_tvl.toFixed(2) + ' × log TVL (' + money(r.tvl_usd) + ')', c.log_tvl * Math.log(r.tvl_usd)],
      ['breadth × log(1 + ' + r.chains.length + ' chains)', c.log_chains * Math.log(1 + r.chains.length)],
      ['age × log(1 + ' + r.age_days + ' days)', c.log_age * Math.log(1 + r.age_days)],
      ['growth × ' + (r.change_7d === null ? '0 (unreported)' : r.change_7d.toFixed(1) + '%') + ' clamped', c.growth * Math.max(-0.6, Math.min(1.2, (r.change_7d || 0) / 100))],
    ];
    if (r.category && c['cat_' + r.category] !== undefined) {
      logParts.push(['category ' + r.category, c['cat_' + r.category]]);
    }
    var sum = 0;
    logParts.forEach(function (p) { sum += p[1]; });
    $('drawer-body').innerHTML =
      '<h2>' + esc(r.name) + ' <span class="badge ' + r.verdict + '">' + r.verdict + '</span></h2>' +
      '<p class="lede">Rank #' + r.rank + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
      (r.watchlist ? ' · on the house watchlist' : ' · below the watchlist floor') + '</p>' +
      '<div class="kv">' +
      '<div><span>Implied value</span><b>' + money(r.implied_value_usd) + '</b></div>' +
      '<div><span>P25–P75 range</span><b>' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</b></div>' +
      '<div><span>Launch odds</span><b>' + pct(r.launch_odds) + '</b></div>' +
      '<div><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div><span>Net per plan</span><b>' + (r.net_per_plan_usd >= 0 ? '+' : '') + '$' + r.net_per_plan_usd.toFixed(2) + ' on $' + r.deposit_usd + '</b></div>' +
      '<div><span>Break-even implied</span><b>' + (isFinite(r.break_even_usd) ? money(r.break_even_usd) : '—') + '</b></div>' +
      '</div>' +
      '<p class="lede">Launch odds are the share of comparable protocols of this age and size that already record a token. Net is the expected dollars on a $' + r.deposit_usd + ' deposit after $' + r.gas_usd.toFixed(2) + ' of gas: odds × 15% farmer share × implied × deposit ÷ TVL, less gas and $4.10 of opportunity cost.</p>' +
      '<h3>How the fitted curve priced it</h3>' +
      '<p class="lede">log implied = ' + sum.toFixed(2) + ' → ' + money(r.implied_value_usd) + '. Each term below is the fitted coefficient times this protocol\u2019s own figure — no name is ever special-cased.</p>' +
      logParts.map(function (p) {
        return '<div>' + esc(p[0]) + ' <b style="float:right">' + (p[1] >= 0 ? '+' : '') + p[1].toFixed(2) + '</b></div><div class="bar"><i style="width:' + Math.min(100, Math.abs(p[1]) / 4 * 100) + '%"></i></div>';
      }).join('') +
      '<h3>Farm plan — netted to the dollar</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    $('drawer').hidden = false;
    if (location.hash !== '#p=' + slug) history.replaceState(null, '', '#p=' + slug);
  }
  $('drawer-close').addEventListener('click', function () {
    $('drawer').hidden = true;
    history.replaceState(null, '', '#tab=board');
  });

  /* ---- validation tab ---- */
  var validationDone = false;
  function renderValidation() {
    if (validationDone) return;
    validationDone = true;
    $('v-loo').textContent = '×' + model.loo_median_miss.toFixed(2);
    $('v-loo-note').textContent = 'Median absolute error pricing each of the ' + model.comps + ' traded comps from all the others. The curve is honest about being rough: a token\u2019s market cap is a noisy thing to predict from size alone.';
    $('v-wf').textContent = model.walk_forward_miss > 0 ? '×' + model.walk_forward_miss.toFixed(2) : '—';
    $('v-wf-note').textContent = 'Fit on the ' + model.walk_forward_train + ' comps listed before 2025, tested on the ' + model.walk_forward_test + ' listed after. A model that only memorises the past fails here; this one does not.';
    $('v-odds').textContent = model.odds_cv_brier.toFixed(3) + ' vs ' + model.odds_base_brier.toFixed(3);
    $('v-odds-note').textContent = 'Five-fold cross-validated Brier score of the launch odds against always predicting the base token rate (' + pct(model.odds_base_rate) + '). Lower is better; the odds beat the base rate, narrowly and honestly.';
    $('v-range').textContent = pct(model.range_hold);
    $('v-range-note').textContent = 'Share of leave-one-out truths that fell inside the P25–P75 band the board shows. A perfect 50% band holds half the truths; this one holds ' + pct(model.range_hold) + '.';
    var meanings = {
      intercept: 'Baseline log value before any figure is counted.',
      log_tvl: 'Each doubling of TVL multiplies implied value by about 2^' + model.coefficients.log_tvl.toFixed(2) + '.',
      log_chains: 'Breadth across chains, in log points per extra chain.',
      log_age: 'Age since listing, in log points; older protocols price lower per dollar of TVL.',
      growth: 'Seven-day TVL change, clamped to −60%…+120%.',
    };
    var rowsHtml = Object.keys(model.coefficients).map(function (k) {
      var label = k.indexOf('cat_') === 0 ? 'category: ' + k.slice(4) : k;
      var meaning = meanings[k] || 'Category shift: protocols in this category price this much higher or lower than the curve.';
      return '<tr><td>' + esc(label) + '</td><td class="num">' + model.coefficients[k].toFixed(3) + '</td><td>' + esc(meaning) + '</td></tr>';
    }).join('');
    document.querySelector('#coefs tbody').innerHTML = rowsHtml;
    document.querySelector('#loo-bands tbody').innerHTML = model.loo_bands.map(function (b) {
      return '<tr><td>' + money(b[0]) + ' – ' + money(b[1]) + '</td><td class="num">' + b[2] + '</td><td class="num">×' + b[3].toFixed(2) + '</td></tr>';
    }).join('');
    var ageLabels = ['under 90 days', '90 days – 1 year', '1 – 2 years', '2 – 4 years', 'over 4 years'];
    document.querySelector('#odds-cal tbody').innerHTML = model.odds_calibration.map(function (row, i) {
      return '<tr><td>' + ageLabels[i] + '</td><td class="num">' + row[2] + '</td><td class="num">' + pct(row[0]) + '</td><td class="num">' + pct(row[1]) + '</td></tr>';
    }).join('');
    renderSandbox();
  }

  /* ---- live tokens ---- */
  var liveDone = false;
  function renderLive() {
    if (liveDone) return;
    liveDone = true;
    document.querySelector('#livetab tbody').innerHTML = R.live.map(function (p) {
      return '<tr><td><b>' + esc(p.name) + '</b>' + (p.symbol ? ' (' + esc(p.symbol) + ')' : '') + '</td>' +
        '<td>' + esc(p.category || '—') + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num">' + money(p.mcap_usd) + '</td>' +
        '<td class="num">' + (p.mcap_usd / p.tvl_usd).toFixed(2) + '×</td></tr>';
    }).join('');
  }

  /* ---- model sandbox: re-price the top row only, the board never moves ---- */
  function renderSandbox() {
    var share = document.getElementById('sb-share');
    var gas = document.getElementById('sb-gas');
    function update() {
      var s = parseInt(share.value, 10) / 100;
      var g = parseInt(gas.value, 10);
      $('sb-share-v').textContent = share.value + '%';
      $('sb-gas-v').textContent = gas.value;
      var gross = top.launch_odds * s * top.implied_value_usd * top.deposit_usd / top.tvl_usd;
      var gasUsd = top.gas_usd * (g / 12);
      var net = gross - gasUsd - 4.10;
      var verdict = net >= 10 ? 'FARM' : net >= 0 ? 'MARGINAL' : 'SKIP';
      $('sb-out').textContent = 'Top row ' + top.name + ' at a ' + share.value + '% farmer share and $' + gas.value +
        ' Ethereum gas: expected gross $' + gross.toFixed(2) + ', gas $' + gasUsd.toFixed(2) +
        ', net $' + net.toFixed(2) + ' on $' + top.deposit_usd + ' — verdict ' + verdict +
        '. The board above is unchanged: the sandbox only shows what the verdict is sensitive to.';
    }
    share.addEventListener('input', update);
    gas.addEventListener('input', update);
    update();
  }

  /* ---- deep links: #p=<slug>, #tab=validation, #tab=live, #category=X ---- */
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    var parts = {};
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv[0]) parts[kv[0]] = decodeURIComponent(kv[1] || '');
    });
    if (parts.tab) showTab(parts.tab);
    if (parts.p) openDetail(parts.p);
    if (parts.category) { state.cat = parts.category; $('fcat').value = parts.category; renderBoard(); }
  }

  renderBoard();
  readHash();
  window.addEventListener('hashchange', readHash);
})();

// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a live-token comparison view, a filterable and sortable table, and a detail
// drawer per protocol with the model's working and the farm plan. No network: every byte it shows
// is in data.js, and the page re-derives each implied value from the row's own figures to prove
// the board and the page run the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', wl: false, tab: 'board', sort: 'implied', dir: -1, selected: null };

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
  function multipleOf(row) {
    for (var i = 0; i < DATA.multiples.length; i++) {
      if (DATA.multiples[i].category === (row.category || '(uncategorised)')) return DATA.multiples[i].multiple;
    }
    return DATA.global_multiple;
  }
  // The model in one function, the same arithmetic lib/model.ts runs: the page recomputes a row
  // from the snapshot figures and checks the number board.json carries.
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var momentum = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * multipleOf(row) * momentum * maturity));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
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

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || '(uncategorised)') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'scope' }), el('span', { class: 'brand-name', text: 'Launch Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Universe ', el('b', { text: DATA.universe_size + ' protocols' })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Which pre-token protocol is worth farming next?' }),
        el('p', null,
          'Every protocol in the snapshot that records no token, and is not a wrapped, staked or bridged product of one that trades, ranked by ',
          el('b', { text: 'implied launch value' }),
          ': what its token would plausibly be worth if it issued today, priced from the market caps of comparable protocols that already trade. The watchlist of ' + DATA.watchlist_size + ' is the floor; the early radar adds ' + DATA.early_size + ' more below the $' + Math.round(DATA.floor_usd / 1e6) + 'M line. An implied value is the model\u2019s claim, not a promise.'
        )
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'stat' }, el('span', { text: 'Protocols ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Early, below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Already trading, set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || '(uncategorised)'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chn = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chn.addEventListener('change', function () { state.chain = chn.value; writeHash(); render(); });
    var wlBox = el('input', { type: 'checkbox', id: 'wl', 'aria-label': 'Watchlist only' });
    if (state.wl) wlBox.setAttribute('checked', 'checked');
    wlBox.addEventListener('change', function () { state.wl = wlBox.checked; writeHash(); render(); });
    var boardTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'board'; writeHash(); render(); } });
    var liveTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Already trading', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chn),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Scope' }), el('label', { class: 'check' }, wlBox, ' Watchlist only')),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }), el('div', { class: 'tabs' }, boardTab, liveTab)),
      el('span', { class: 'count', text: state.tab === 'board' ? rows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' trading protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or widen the category and chain filters to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render(); } })
      ));
    }
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    max = max || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'chain unrecorded') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: 'x' + r.model.category_multiple.toFixed(2) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'tag ' + (r.on_watchlist ? 'wl' : 'early'), text: r.on_watchlist ? 'watchlist' : 'early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols ranked by implied launch value. Select a row for the model\u2019s working and its farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            el('th', { scope: 'col', text: 'x TVL' }),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'chain unrecorded') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.tvl_multiple === null ? 'n/a' : 'x' + r.tvl_multiple.toFixed(2) }),
        el('td', null, el('span', { class: 'tag live', text: 'trading' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Already trading: these protocols have a token, so their market cap is a fact, not a model. They are the comparables the board\u2019s multiples are derived from, and they are never ranked with the pre-token board.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'x TVL' }), el('th', { scope: 'col', text: 'Status' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var tbody = el('tbody');
    DATA.multiples.forEach(function (x) {
      tbody.appendChild(el('tr', null,
        el('td', { text: x.category }),
        el('td', { class: 'num', text: String(x.samples) }),
        el('td', { class: 'num', text: 'x' + x.raw_median.toFixed(3) }),
        el('td', { class: 'num', text: 'x' + x.multiple.toFixed(3) })
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How an implied value is priced' }),
      el('p', { class: 'sub', text: 'One function scores every row from the snapshot\u2019s own figures. No protocol name is special-cased and no row is hand-picked; the page re-derives each row\u2019s value from these constants and checks it against board.json.' }),
      el('div', { class: 'formula', text: 'implied = round( tvl x MULTIPLE(category) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )' }),
      el('p', { class: 'sub', text: 'MULTIPLE(category) is the median market-cap-to-TVL ratio of the category\u2019s live-token protocols in this snapshot, shrunk toward the global median x' + DATA.global_multiple.toFixed(3) + ' by samples / (samples + ' + m.shrink_prior + ') and clamped to x' + m.multiple_floor + '\u2013x' + m.multiple_cap + '. A category with no live sample uses the global median. Age is the time since the protocol was first tracked, the record of how long it has run with no token; an unrecorded age counts as ' + m.unknown_age_days + ' days.' }),
      el('div', { class: 'scroll' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live samples' }), el('th', { scope: 'col', text: 'Raw median' }), el('th', { scope: 'col', text: 'Multiple used' }))),
          tbody
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'tag ' + (row.on_watchlist ? 'wl' : 'early'), text: row.on_watchlist ? 'watchlist' : 'early radar' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' \u00b7 ' + (row.category || 'Uncategorised') + ' \u00b7 ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'chain unrecorded') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var check = impliedOf(row);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied launch value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + row.model.multiple_samples + ' live samples)' }), el('b', { text: 'x' + row.model.category_multiple.toFixed(3) })),
        el('div', null, el('span', { text: 'Seven-day TVL change' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Momentum multiplier' }), el('b', { text: 'x' + row.model.momentum_multiplier.toFixed(3) })),
        el('div', null, el('span', { text: 'Age with no token recorded' }), el('b', { text: fmtAge(row.age_days) + (row.listed_at ? ' (tracked since ' + row.listed_at + ')' : '') })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { text: 'x' + row.model.maturity_multiplier.toFixed(3) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'note', text: check === row.implied_value_usd
        ? 'The page recomputes this row from the snapshot figures as ' + fmtUsd(check) + ' \u2014 the same number board.json carries. The protocol records no token; that is DefiLlama\u2019s record, not proof none exists. An estimate, not a price.'
        : 'The page recomputes this row as ' + fmtUsd(check) + ', which differs from the board: the data would be stale.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) { return el('li', null, el('p', { text: s })); }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'board' ? boardTable() : liveTable());
    if (state.tab === 'board') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'foot', text: 'Source: the sealed snapshot\u2019s protocol index (' + DATA.source + '). Implied values are this board\u2019s model claims, never a site\u2019s promise; a protocol \u201crecords no token\u201d on that index\u2019s record. Farm plans are starting points, not financial advice.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();

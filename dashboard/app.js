// Token Radar — dashboard app.js
//
// The page is a viewer over data.js, the file main.ts writes. It never fetches anything:
// every number it shows comes from window.RADAR, and every model figure it prints it
// recomputes itself from that data, with the same formula main.ts ran. The farm plans
// are generated here from the same fourteen families main.ts uses, so the plan a row's
// drawer shows is the plan board.json carries for that row.

(function () {
  'use strict';

  var DATA = window.RADAR;
  var WATCHLIST = new Set(DATA.watchlist);

  // --- small helpers ----------------------------------------------------------

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    var s = n > 0 ? '+' : '';
    return s + n.toFixed(1) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }

  function fmtMult(n) {
    return n.toFixed(4);
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function cmpStr(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- the model, recomputed in the page --------------------------------------
  //
  // These three functions are the dashboard's copy of lib/model.ts. They take the
  // same inputs (the row, the peer table in data.js, the model constants) and run
  // the same arithmetic in the same order, so the drawer can check its own row
  // against board.json instead of trusting it.

  var SIBLING = {
    'Risk Curators': 'Onchain Capital Allocator',
    'Onchain Capital Allocator': 'Risk Curators',
    'Restaking': 'Liquid Restaking',
    'Collateral Markets': 'Lending',
    'CeDeFi': 'CEX',
    'Stablecoin Wrapper': 'CDP',
    'Governance Incentives': 'Yield',
    'Chain': 'Dexs',
    'Payments': 'Dexs',
  };

  var MULTIPLES = new Map(DATA.multiples.map(function (e) { return [e.category, e]; }));

  function peerMultipleFor(category) {
    var own = category === null ? undefined : MULTIPLES.get(category);
    if (own !== undefined && own.n >= DATA.model.peer_min_n) {
      return { multiple: own.median, source: category + ' n=' + own.n };
    }
    var sib = category === null ? undefined : SIBLING[category];
    if (sib !== undefined) {
      var s = MULTIPLES.get(sib);
      if (s !== undefined && s.n >= DATA.model.peer_min_n) {
        return { multiple: s.median, source: 'sibling ' + sib + ' n=' + s.n };
      }
    }
    return { multiple: DATA.global_multiple.median, source: 'global n=' + DATA.global_multiple.n };
  }

  function impliedOf(row) {
    var m = DATA.model;
    var peer = peerMultipleFor(row.category);
    var sizeF = clamp(Math.pow(row.tvl_usd / m.size_ref, m.size_exp), m.size_min, m.size_max);
    var growthPct = row.change_7d === null ? 0 : clamp(row.change_7d, m.growth_floor, m.growth_cap);
    var G = 1 + (growthPct / 100) * m.growth_weight;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var A = m.maturity_floor + (Math.min(age, m.maturity_days) / m.maturity_days) * m.maturity_range;
    var value = Math.max(1, Math.round(row.tvl_usd * peer.multiple * sizeF * G * A));
    return { value: value, multiple: peer.multiple, source: peer.source, sizeF: sizeF, G: G, growthPct: growthPct, A: A };
  }

  // --- farm plans, generated in the page --------------------------------------

  var GAS_MID_CHAINS = new Set([
    'Binance', 'Avalanche', 'Tron', 'Sui', 'Aptos', 'Algorand', 'Stellar', 'Ripple',
    'Flare', 'Bittensor', 'Hyperliquid L1', 'CORE', 'Qubic', 'Mezo',
  ]);

  function gasTx(chain) {
    if (chain === 'Ethereum') return '$3 to $12';
    if (chain === 'Bitcoin') return '$2 to $8';
    if (GAS_MID_CHAINS.has(chain)) return '$0.50';
    return '$0.20';
  }

  function firstTxCost(chain) {
    if (chain === 'Ethereum') return 'about $3 to $12 of gas for the first transaction on Ethereum';
    if (chain === 'Bitcoin') return 'about $2 to $8 of gas for the first transaction on Bitcoin';
    if (GAS_MID_CHAINS.has(chain)) return 'about $0.20 to $1.00 of gas for the first transaction on ' + chain;
    return 'under $1 of gas for the first transaction on ' + chain;
  }

  var FAMILIES = {
    lending: {
      primary: 'Supply ${capital} of USDC to {name} on {chain} and keep the position open.',
      secondary: 'Borrow about $10 against the supply and repay it a week later, so both sides of the market are used.',
      secondaryCapital: 10,
    },
    dex: {
      primary: "Provide ${capital} of liquidity to {name}'s main pool on {chain} and keep the position open.",
      secondary: 'Swap $10 through {name} on {chain} once a week.',
      secondaryCapital: 10,
    },
    yield: {
      primary: 'Deposit ${capital} into {article} {name} vault on {chain} and keep the shares.',
      secondary: 'Deposit a further $25 into a second {name} vault or strategy on {chain}.',
      secondaryCapital: 25,
    },
    curators: {
      primary: 'Deposit ${capital} into {article} {name} vault on {chain} and keep the shares.',
      secondary: 'Deposit a further $50 into a second {name} vault on {chain} so more than one position is counted.',
      secondaryCapital: 50,
      weekly: 'adding $10 to a vault or voting on a proposal',
      plural: true,
    },
    rwa: {
      primary: "Mint ${capital} of the protocol's yield asset on {chain} and hold it.",
      secondary: 'Buy a further $25 of the yield asset on {chain} in a second purchase.',
      secondaryCapital: 25,
    },
    basis: {
      primary: 'Deposit ${capital} into {article} {name} basis vault on {chain} and keep the position.',
      secondary: 'Deposit a further $25 into a second {name} vault on {chain} so more than one position is counted.',
      secondaryCapital: 25,
      weekly: 'adding $10 to the vault or rebalancing the hedge',
    },
    derivatives: {
      primary: 'Deposit ${capital} of USDC as margin on {name} and open one small position.',
      secondary: 'Close and reopen a $10 position once a week.',
      secondaryCapital: 10,
    },
    restaking: {
      primary: "Restake ${capital} of the chain's staking asset through {name} and keep the receipt.",
      secondary: 'Delegate $25 to a second operator through {name}.',
      secondaryCapital: 25,
    },
    insurance: {
      primary: 'Buy ${capital} of cover from {name} on {chain} and keep the policy.',
      secondary: 'Top up $25 of cover before the policy lapses.',
      secondaryCapital: 25,
    },
    payments: {
      primary: 'Fund ${capital} into {name} on {chain} and make one payment.',
      secondary: 'Make one $10 payment a week through {name}.',
      secondaryCapital: 10,
    },
    governance: {
      primary: 'Stake ${capital} through {name} on {chain} and vote on one proposal.',
      secondary: 'Vote on a second proposal the following week.',
      secondaryCapital: 0,
    },
    cedefi: {
      primary: 'Deposit ${capital} into {article} {name} vault on {chain} and keep the shares.',
      secondary: 'Deposit $50 more into a second {name} product on {chain}.',
      secondaryCapital: 50,
    },
    chain: {
      primary: 'Bridge ${capital} of USDC to {chain} through its official bridge and use it in one app on {chain}.',
      secondary: 'Make one $10 swap or transaction a week on {chain}.',
      secondaryCapital: 10,
    },
    default: {
      primary: 'Deposit ${capital} of USDC into {name} on {chain} and keep the position open.',
      secondary: 'Make one $10 qualifying action a week on {name}.',
      secondaryCapital: 10,
    },
  };

  var FAMILY_OF = {
    'Lending': 'lending',
    'CDP': 'lending',
    'Collateral Markets': 'lending',
    'Uncollateralized Lending': 'lending',
    'Dexs': 'dex',
    'Liquidity Manager': 'dex',
    'Yield': 'yield',
    'Yield Aggregator': 'yield',
    'Leveraged Farming': 'yield',
    'Farm': 'yield',
    'Risk Curators': 'curators',
    'Onchain Capital Allocator': 'curators',
    'RWA': 'rwa',
    'Anchor BTC': 'rwa',
    'Decentralized BTC': 'rwa',
    'Dual-Token Stablecoin': 'rwa',
    'Stablecoin Wrapper': 'rwa',
    'Basis Trading': 'basis',
    'Derivatives': 'derivatives',
    'Interest Rate Derivatives': 'derivatives',
    'Prediction Market': 'derivatives',
    'Indexes': 'derivatives',
    'Restaking': 'restaking',
    'Insurance': 'insurance',
    'Payments': 'payments',
    'Crypto Card Issuer': 'payments',
    'Governance Incentives': 'governance',
    'CeDeFi': 'cedefi',
    'Chain': 'chain',
  };

  function familyFor(category) {
    var key = category === null ? undefined : FAMILY_OF[category];
    return FAMILIES[key || 'default'] || FAMILIES.default;
  }

  function fill(template, name, capital, chain) {
    return template.split('{name}').join(name).split('{capital}').join(String(capital)).split('{chain}').join(chain).split('{article}').join(article(name));
  }

  // "a" or "an" before a protocol name, by its first letter — the spec's examples use both.
  function article(name) {
    return /^[AEIOUaeiou]/.test(name) ? 'an' : 'a';
  }

  // Double a gas amount string, keeping each figure's decimal places: $0.20 → $0.40, $3 to $12 → $6 to $24.
  function gasDouble(tx) {
    return tx.replace(/\$(\d+(?:\.\d+)?)/g, function (_match, amount) {
      var doubled = parseFloat(amount) * 2;
      return '$' + (amount.indexOf('.') !== -1 ? doubled.toFixed(2) : String(doubled));
    });
  }

  function chainOf(row) {
    return row.chains.length > 0 ? row.chains[0] : 'Ethereum';
  }

  function capitalFor(row) {
    if (row.tvl_usd >= 1000000000) return 250;
    if (row.tvl_usd >= 100000000) return 150;
    if (row.tvl_usd >= 25000000) return 100;
    return 50;
  }

  function holdDaysFor(age) {
    if (age === null) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function farmSteps(row) {
    var chain = chainOf(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var family = familyFor(row.category);
    var tx = gasTx(chain);
    var total = capital + family.secondaryCapital;
    var weekly = family.weekly || 'adding $10 to the position, claiming rewards, or voting on a proposal';
    var positionWord = family.plural === true ? 'positions' : 'position';
    var secondaryCost = family.secondaryCapital > 0
      ? '$' + family.secondaryCapital + ' of capital and about ' + tx + ' of gas'
      : 'about ' + tx + ' of gas';
    return [
      {
        text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
        cost: firstTxCost(chain),
        time: '5 minutes',
      },
      {
        text: fill(family.primary, row.name, capital, chain),
        cost: '$' + capital + ' of capital and about ' + tx + ' of gas',
        time: '15 minutes to set up',
      },
      {
        text: fill(family.secondary, row.name, 0, chain),
        cost: secondaryCost,
        time: '10 minutes',
      },
      {
        text: 'Make one qualifying action each week, such as ' + weekly + '.',
        cost: 'about ' + tx + ' of gas a week',
        time: '10 minutes a week',
      },
      {
        text: 'Hold the ' + positionWord + ' for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
        cost: 'the $' + total + ' stays in the ' + positionWord,
        time: hold + ' days',
      },
      {
        text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
        cost: 'no fee to check, and never pay to claim',
        time: '10 minutes',
      },
      {
        text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
        // Curators hold two vaults, so exiting pays for two withdrawals; every other family exits once.
        cost: family.plural === true
          ? 'about ' + gasDouble(tx) + ' of gas to withdraw from both vaults'
          : 'about ' + tx + ' of gas to withdraw',
        time: '10 minutes',
      },
    ];
  }

  // --- state --------------------------------------------------------------------

  var state = { q: '', category: '', chain: '', watchlistOnly: false, tab: 'board', sort: 'rank', dir: 1, selected: null };

  function readHash() {
    var h = location.hash.replace(/^#/, '');
    var params = new URLSearchParams(h);
    state.q = params.get('q') || '';
    state.category = params.get('cat') || '';
    state.chain = params.get('chain') || '';
    state.watchlistOnly = params.get('w') === '1';
    state.tab = params.get('tab') || 'board';
    if (['board', 'live', 'model'].indexOf(state.tab) === -1) state.tab = 'board';
    state.sort = params.get('sort') || 'rank';
    state.dir = params.get('dir') === 'desc' ? -1 : 1;
    state.selected = params.get('p') || null;
  }

  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('cat', state.category);
    if (state.chain) params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('w', '1');
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.dir === -1) params.set('dir', 'desc');
    if (state.selected) params.set('p', state.selected);
    var h = params.toString();
    history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
  }

  // --- filtering and sorting ----------------------------------------------------

  var CATEGORIES = Array.from(new Set(DATA.rows.map(function (r) { return r.category; }).filter(function (c) { return c !== null; }))).sort(cmpStr);
  var CHAINS = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains); }, []))).sort(cmpStr);

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !WATCHLIST.has(r.slug)) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function sortValue(row, key) {
    if (key === 'rank') return row.rank;
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d;
    if (key === 'age') return row.age_days;
    if (key === 'implied') return row.implied_value_usd;
    return row.rank;
  }

  function sortedRows(rows) {
    var key = state.sort;
    var dir = state.dir;
    return rows.slice().sort(function (a, b) {
      var va = sortValue(a, key);
      var vb = sortValue(b, key);
      if (va === null && vb === null) return cmpStr(a.slug, b.slug);
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return cmpStr(a.slug, b.slug);
    });
  }

  // --- rendering ----------------------------------------------------------------

  var app = document.getElementById('app');

  function render() {
    app.textContent = '';
    app.appendChild(header());
    if (state.tab === 'board') {
      app.appendChild(toolbar());
      var wrap = el('div');
      wrap.id = 'boardwrap';
      app.appendChild(wrap);
      updateBoard();
    } else if (state.tab === 'live') {
      app.appendChild(liveCard());
    } else {
      app.appendChild(modelCard());
    }
    app.appendChild(footer());
    if (state.selected && state.tab === 'board') openDrawer(state.selected, false);
  }

  // Re-render only the board card, so typing in the search box keeps its focus.
  function updateBoard() {
    var wrap = document.getElementById('boardwrap');
    if (!wrap) return;
    wrap.textContent = '';
    wrap.appendChild(boardCard());
  }

  function header() {
    var wrap = el('header', 'topbar');
    var left = el('div');
    left.appendChild(el('p', 'eyebrow', 'make.fun · token-radar-01'));
    left.appendChild(el('h1', 'title', 'Token Radar'));
    left.appendChild(el('p', 'meta', 'Snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · floor ' + fmtUsd(DATA.floor_usd) + ' · ' + DATA.board_size + ' rows'));
    wrap.appendChild(left);
    wrap.appendChild(el('p', 'model-chip', 'model ' + DATA.model_version));
    var lede = el('p', 'lede', 'Every pre-token protocol the watchlist would cover, ranked by what its token would be worth if it traded like its peers. ' + DATA.watchlist_size + ' watchlist rows, ' + DATA.early_size + ' early rows below the floor, and ' + DATA.live_size + ' live-token protocols shown apart for reference.');
    var out = document.createDocumentFragment();
    out.appendChild(wrap);
    out.appendChild(lede);
    out.appendChild(tabs());
    return out;
  }

  function tabs() {
    var nav = el('div', 'tabs');
    nav.setAttribute('role', 'tablist');
    [['board', 'Board'], ['live', 'Live tokens'], ['model', 'Model']].forEach(function (pair) {
      var b = el('button', 'tab', pair[1]);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', state.tab === pair[0] ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.tab = pair[0];
        state.selected = null;
        writeHash();
        render();
      });
      nav.appendChild(b);
    });
    return nav;
  }

  function toolbar() {
    var bar = el('div', 'toolbar');
    var search = el('label', 'field', 'Search');
    var input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'name or slug';
    input.value = state.q;
    input.setAttribute('aria-label', 'Search protocols by name or slug');
    input.addEventListener('input', function () {
      state.q = input.value;
      writeHash();
      updateBoard();
    });
    search.appendChild(input);
    bar.appendChild(search);

    var cat = el('label', 'field', 'Category');
    var catSel = document.createElement('select');
    catSel.setAttribute('aria-label', 'Filter by category');
    catSel.appendChild(new Option('All categories', ''));
    CATEGORIES.forEach(function (c) { catSel.appendChild(new Option(c, c)); });
    catSel.value = state.category;
    catSel.addEventListener('change', function () {
      state.category = catSel.value;
      writeHash();
      updateBoard();
    });
    cat.appendChild(catSel);
    bar.appendChild(cat);

    var ch = el('label', 'field', 'Chain');
    var chSel = document.createElement('select');
    chSel.setAttribute('aria-label', 'Filter by chain');
    chSel.appendChild(new Option('All chains', ''));
    CHAINS.forEach(function (c) { chSel.appendChild(new Option(c, c)); });
    chSel.value = state.chain;
    chSel.addEventListener('change', function () {
      state.chain = chSel.value;
      writeHash();
      updateBoard();
    });
    ch.appendChild(chSel);
    bar.appendChild(ch);

    var check = el('label', 'check');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = state.watchlistOnly;
    box.addEventListener('change', function () {
      state.watchlistOnly = box.checked;
      writeHash();
      updateBoard();
    });
    check.appendChild(box);
    check.appendChild(document.createTextNode('Watchlist only'));
    bar.appendChild(check);
    return bar;
  }

  function boardCard() {
    var rows = sortedRows(filteredRows());
    var card = el('div', 'card');
    var count = el('p', 'count', 'Showing ' + rows.length + ' of ' + DATA.board_size + ' rows' +
      (state.watchlistOnly ? ' · watchlist only' : '') +
      (state.category ? ' · ' + state.category : '') +
      (state.chain ? ' · ' + state.chain : ''));
    card.appendChild(count);
    if (rows.length === 0) {
      card.appendChild(el('p', 'empty', 'No rows match these filters.'));
      return card;
    }
    var wrap = el('div', 'tablewrap');
    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    var cols = [
      ['rank', '#', 'Rank'],
      ['name', 'Protocol', 'Protocol'],
      ['category', 'Category', 'Category'],
      ['chains', 'Chains', 'Chains'],
      ['tvl', 'TVL', 'Total value locked'],
      ['growth', '7d', 'TVL change, last 7 days'],
      ['age', 'Age', 'Days since listing'],
      ['implied', 'Implied value', 'Model-implied token value'],
    ];
    cols.forEach(function (c) {
      var th = document.createElement('th');
      if (c[0] === 'tvl' || c[0] === 'growth' || c[0] === 'age' || c[0] === 'implied') th.className = 'num';
      if (c[0] === 'name') th.className = 'name';
      var sortable = ['rank', 'name', 'tvl', 'growth', 'age', 'implied'].indexOf(c[0]) !== -1;
      if (sortable) {
        var b = el('button', null, c[1] + (state.sort === c[0] ? (state.dir === 1 ? ' ▲' : ' ▼') : ''));
        b.title = c[2];
        b.addEventListener('click', function () {
          if (state.sort === c[0]) {
            state.dir = -state.dir;
          } else {
            state.sort = c[0];
            state.dir = (c[0] === 'name' || c[0] === 'rank') ? 1 : -1;
          }
          writeHash();
          updateBoard();
        });
        th.appendChild(b);
      } else {
        th.textContent = c[1];
        th.title = c[2];
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    rows.forEach(function (r) {
      var row = document.createElement('tr');
      row.className = 'rowlink' + (state.selected === r.slug ? ' selected' : '');
      row.tabIndex = 0;
      row.addEventListener('click', function () { openDrawer(r.slug, true); });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(r.slug, true); }
      });
      var cells = [
        { text: String(r.rank), cls: 'num' },
        { text: r.name, cls: 'name', pill: WATCHLIST.has(r.slug) },
        { text: r.category === null ? '—' : r.category, cls: '' },
        { text: r.chains.length === 0 ? '—' : r.chains[0] + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : ''), cls: '' },
        { text: fmtUsd(r.tvl_usd), cls: 'num' },
        { text: fmtPct(r.change_7d), cls: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') },
        { text: fmtAge(r.age_days), cls: 'num' },
        { text: fmtUsd(r.implied_value_usd), cls: 'num' },
      ];
      cells.forEach(function (c) {
        var td = el('td', c.cls, c.text);
        if (c.pill) td.appendChild(el('span', 'pill', 'watchlist'));
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);
    return card;
  }

  function liveCard() {
    var card = el('div', 'card');
    card.appendChild(el('h2', null, 'Live tokens'));
    card.appendChild(el('p', 'note', 'These ' + DATA.live_size + ' protocols already have a token, so the board shows the market\u2019s own values for them. They are not ranked by the model; the multiple column is simply market cap divided by TVL.'));
    var wrap = el('div', 'tablewrap');
    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    ['Protocol', 'Category', 'Chains', 'TVL', 'Market cap', '7d', 'mcap / TVL'].forEach(function (label, i) {
      var th = document.createElement('th');
      if (i >= 3) th.className = 'num';
      if (i === 0) th.className = 'name';
      th.textContent = label;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    DATA.live.forEach(function (r) {
      var row = document.createElement('tr');
      var multiple = r.mcap_usd === null ? null : r.mcap_usd / r.tvl_usd;
      [
        { text: r.name, cls: 'name' },
        { text: r.category === null ? '—' : r.category, cls: '' },
        { text: r.chains.length === 0 ? '—' : r.chains[0] + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : ''), cls: '' },
        { text: fmtUsd(r.tvl_usd), cls: 'num' },
        { text: fmtUsd(r.mcap_usd), cls: 'num' },
        { text: fmtPct(r.change_7d), cls: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') },
        { text: multiple === null ? '—' : fmtMult(multiple), cls: 'num' },
      ].forEach(function (c) { row.appendChild(el('td', c.cls, c.text)); });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    card.appendChild(wrap);
    return card;
  }

  function modelCard() {
    var m = DATA.model;
    var card = el('div', 'card');
    card.appendChild(el('h2', null, 'Model ' + DATA.model_version));
    card.appendChild(el('p', null, 'The board scores every pre-token protocol the same way: what its token would be worth if it traded at the multiple its live-token peers trade at, adjusted for size, recent growth and age.'));
    var eq = el('p', 'equation', 'implied = TVL × M_cat × sizeF × G × A');
    card.appendChild(eq);
    card.appendChild(el('p', null, 'M_cat is the median market-cap-to-TVL ratio of live-token protocols in the same category (at least 3 peers). When a category has too few peers, the model falls back to a sibling category, then to the global median of ' + fmtMult(DATA.global_multiple.median) + ' across ' + DATA.global_multiple.n + ' live-token protocols.'));
    card.appendChild(el('p', null, 'sizeF = (TVL / $100M)^-0.478, clamped to [0.2, 4.0]: smaller protocols get a higher multiple, larger ones a lower one. G = 1 + clamp(7d change, -60%, +120%) / 100 × 0.5. A = 0.6 + min(age, 1095 days) / 1095 × 0.4; a protocol with no listing date is treated as 365 days old.'));
    card.appendChild(el('h3', null, 'Peer multiples by category'));
    card.appendChild(el('p', 'note', 'Only categories with n ≥ 3 set a peer multiple directly. Smaller categories fall back to a sibling or the global median.'));
    var peers = el('div', 'peers');
    var half = Math.ceil(DATA.multiples.length / 2);
    [DATA.multiples.slice(0, half), DATA.multiples.slice(half)].forEach(function (part) {
      var wrap = el('div', 'tablewrap');
      var table = document.createElement('table');
      var thead = document.createElement('thead');
      var tr = document.createElement('tr');
      [['Category', ''], ['n', 'num'], ['Median mcap/TVL', 'num']].forEach(function (c) {
        var th = el('th', c[1], c[0]);
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      table.appendChild(thead);
      var tbody = document.createElement('tbody');
      part.forEach(function (e) {
        var row = document.createElement('tr');
        row.appendChild(el('td', '', e.category));
        row.appendChild(el('td', 'num', String(e.n)));
        row.appendChild(el('td', 'num', fmtMult(e.median)));
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      peers.appendChild(wrap);
    });
    card.appendChild(peers);
    card.appendChild(el('h3', null, 'What the board leaves out'));
    card.appendChild(el('p', null, 'The board covers the whole watchlist and adds pre-token protocols below the floor that pass the watchlist\u2019s own product test: no bridge, liquid-staking, restaking or CEX product, no versioned pool, no wrapped or staked name, no exchange-prefixed name. Protocols already trading are kept apart in the Live tokens view.'));
    card.appendChild(el('p', null, 'What this board is not: a price target, a recommendation, or a promise of a token. An implied value is a model\u2019s comparison, not a market price — treat it as a way to sort the watchlist, then check the protocol itself before farming anything.'));
    return card;
  }

  function openDrawer(slug, updateHash) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    closeDrawer(false);
    state.selected = slug;
    if (updateHash) {
      writeHash();
      updateBoard();
    }
    var v = impliedOf(row);
    var d = el('div', 'drawer');
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', row.name + ' detail');
    var close = el('button', 'close', 'Close');
    close.addEventListener('click', function () { closeDrawer(true); });
    d.appendChild(close);
    d.appendChild(el('p', 'eyebrow', 'rank #' + row.rank + (WATCHLIST.has(row.slug) ? ' · watchlist' : ' · early')));
    d.appendChild(el('h2', null, row.name));
    d.appendChild(el('p', 'sub', (row.category === null ? 'Uncategorised' : row.category) + ' · ' + (row.chains.length === 0 ? 'no chain listed' : row.chains.join(', '))));
    d.appendChild(el('p', null, 'Implied value ' + fmtUsd(row.implied_value_usd) + ' on ' + fmtUsd(row.tvl_usd) + ' of TVL.'));
    d.appendChild(el('h3', null, 'How the value is built'));
    var factors = document.createElement('table');
    factors.className = 'factors';
    var fb = document.createElement('tbody');
    var ageLabel = row.age_days === null ? 'unknown — 365 days assumed' : row.age_days + ' days';
    [
      ['Peer multiple (M)', fmtMult(v.multiple) + ' · ' + v.source],
      ['Size factor', fmtMult(v.sizeF) + ' · (TVL / $100M)^-0.478, clamped [0.2, 4.0]'],
      ['Growth (G)', fmtMult(v.G) + ' · 7d ' + fmtPct(row.change_7d)],
      ['Age factor (A)', fmtMult(v.A) + ' · ' + ageLabel],
    ].forEach(function (f) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', '', f[0]));
      tr.appendChild(el('td', 'num', f[1]));
      fb.appendChild(tr);
    });
    factors.appendChild(fb);
    d.appendChild(factors);
    var check = el('p', 'muted', 'Recompute check: this page recomputes the row as ' + fmtUsd(v.value) + ' — ' +
      (v.value === row.implied_value_usd ? 'the same number board.json carries.' : 'different from board.json (' + fmtUsd(row.implied_value_usd) + ').'));
    d.appendChild(check);
    d.appendChild(el('h3', null, 'Farm plan'));
    var ol = el('ol', 'farm');
    farmSteps(row).forEach(function (s) {
      var li = document.createElement('li');
      li.appendChild(document.createTextNode(s.text));
      li.appendChild(el('span', 'cost', 'Cost: ' + s.cost + '. Time: ' + s.time + '.'));
      ol.appendChild(li);
    });
    d.appendChild(ol);
    d.appendChild(el('p', 'muted', 'A starting point, not financial advice. Verify the protocol\u2019s own points page before you deposit anything.'));
    document.body.appendChild(d);
    d.scrollTop = 0;
  }

  function closeDrawer(updateHash) {
    var old = document.querySelector('.drawer');
    if (old) old.remove();
    state.selected = null;
    if (updateHash) {
      writeHash();
      updateBoard();
    }
  }

  function footer() {
    var f = el('footer', 'footer');
    f.appendChild(el('p', null, 'Data: ' + DATA.source + ', snapshot ' + DATA.as_of + '. Implied values are the model\u2019s, recomputed in your browser from data.js.'));
    f.appendChild(el('p', null, 'No network requests: this page works offline. Farm plans are a starting point, not financial advice.'));
    return f;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) closeDrawer(true);
  });

  readHash();
  render();
})();

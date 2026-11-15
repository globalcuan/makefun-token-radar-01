(function () {
  'use strict';

  var data = window.RADAR_DATA || window.RADAR;
  if (!data) return;

  var root = document.getElementById('board');
  var query = '';
  var category = 'all';
  var chain = 'all';
  var sortKey = 'implied_value_usd';
  var sortDirection = -1;
  var selected = null;

  function element(tag, attributes) {
    var node = document.createElement(tag);
    var children = Array.prototype.slice.call(arguments, 2);

    Object.keys(attributes || {}).forEach(function (key) {
      var value = attributes[key];
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    });

    children.flat().filter(Boolean).forEach(function (child) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function formatMoney(value) {
    if (value == null) return '—';
    if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
    if (value >= 1e3) return '$' + Math.round(value / 1e3) + 'K';
    return '$' + Math.round(value);
  }

  function formatPercent(value) {
    if (value == null) return '—';
    return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
  }

  function buildOptions(values, label, filterName) {
    return element('select', {
      onchange: function (event) {
        if (filterName === 'category') category = event.target.value;
        else chain = event.target.value;
        render();
      }
    },
    element('option', { value: 'all', text: label }),
    values.map(function (value) {
      return element('option', { value: value, text: value });
    }));
  }

  function getFilteredRows() {
    return data.rows.filter(function (row) {
      var matchesCategory = category === 'all' || (row.category || 'Other') === category;
      var matchesChain = chain === 'all' || row.chains.includes(chain);
      var searchableText = [row.name, row.slug, row.category, (row.chains || []).join(' ')].join(' ').toLowerCase();
      var matchesQuery = !query || searchableText.includes(query.toLowerCase());
      return matchesCategory && matchesChain && matchesQuery;
    }).sort(function (left, right) {
      var leftValue = left[sortKey];
      var rightValue = right[sortKey];
      if (leftValue < rightValue) return -sortDirection;
      if (leftValue > rightValue) return sortDirection;
      return left.slug.localeCompare(right.slug);
    });
  }

  function buildProtocolRow(row) {
    return element('tr', {
      onclick: function () {
        selected = row;
        render();
      }
    },
    element('td', { text: row.rank == null ? '—' : row.rank }),
    element('td', { text: row.name }),
    element('td', { text: row.category || 'Other' }),
    element('td', { text: (row.chains || []).join(', ') }),
    element('td', { text: formatMoney(row.tvl_usd) }),
    element('td', { text: formatPercent(row.change_7d) }),
    element('td', { text: formatMoney(row.implied_value_usd) }),
    element('td', { text: row.tvl_usd ? (row.implied_value_usd / row.tvl_usd).toFixed(2) + '×' : '—' }));
  }

  function buildTable(rows, columns) {
    var header = element('tr', {}, columns.map(function (column) {
      var key = column[0];
      var label = column[1];
      return element('th', {
        onclick: function () {
          if (sortKey === key) sortDirection = -sortDirection;
          else {
            sortKey = key;
            sortDirection = -1;
          }
          render();
        },
        text: label + (sortKey === key ? (sortDirection < 0 ? ' ↓' : ' ↑') : '')
      });
    }));

    return element('div', { class: 'scroll' },
      element('table', {},
        element('thead', {}, header),
        element('tbody', {}, rows.map(buildProtocolRow))));
  }

  function renderDetail() {
    if (!selected) return null;
    var model = selected.model_breakdown || {};
    var metrics = [
      ['Category multiple', model.category_multiple],
      ['Momentum', model.momentum],
      ['Maturity', model.maturity],
      ['Reach', model.reach],
      ['Implied', formatMoney(selected.implied_value_usd)]
    ];

    return element('section', { class: 'panel' },
      element('button', {
        class: 'close',
        onclick: function () {
          selected = null;
          render();
        },
        text: 'Close ×'
      }),
      element('h2', { text: selected.name + ' · model breakdown' }),
      element('div', { class: 'metrics' }, metrics.map(function (metric) {
        return element('div', {},
          element('small', { text: metric[0] }),
          element('b', { text: String(metric[1] ?? '—') }));
      })),
      element('h3', { text: 'Farm plan' }),
      element('ol', {}, (selected.farm_steps || []).map(function (step) {
        return element('li', {},
          element('b', { text: step.text || step }),
          typeof step === 'string' ? '' : element('p', { class: 'muted', text: step.cost + ' · ' + step.time }));
      })));
  }

  function renderHeader() {
    return element('header', { class: 'panel hero' },
      element('div', {},
        element('p', { class: 'eyebrow', text: 'TOKEN RADAR · ' + data.model_version }),
        element('h1', { text: 'Pre-token protocols, ranked by implied value' }),
        element('p', { class: 'muted', text: 'Snapshot ' + data.as_of + ' · ' + (data.model.category_method || 'Snapshot based valuation model') })),
      element('div', { class: 'stats' },
        element('b', { text: String(data.board_size) + ' scored' }),
        element('b', { text: String(data.early_size) + ' early radar' }),
        element('b', { text: String(data.live_size) + ' live tokens' })));
  }

  function renderControls() {
    var categories = Array.from(new Set(data.rows.map(function (row) { return row.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(data.rows.flatMap(function (row) { return row.chains || []; }))).sort();
    var search = element('input', {
      type: 'search',
      placeholder: 'Search protocols',
      value: query,
      oninput: function (event) {
        query = event.target.value;
        render();
      }
    });

    return element('div', { class: 'toolbar' },
      search,
      buildOptions(categories, 'All categories', 'category'),
      buildOptions(chains, 'All chains', 'chain'));
  }

  function renderMainSection() {
    return element('section', { class: 'panel' },
      renderControls(),
      buildTable(getFilteredRows(), [
        ['rank', 'Rank'], ['name', 'Protocol'], ['tvl_usd', 'TVL'],
        ['change_7d', '7d'], ['implied_value_usd', 'Implied'], ['ratio', 'Value / TVL']
      ]));
  }

  function renderEarlySection() {
    return element('section', { class: 'panel' },
      element('h2', { text: 'Early radar · below floor' }),
      buildTable(data.radar || [], [['name', 'Protocol'], ['tvl_usd', 'TVL'], ['change_7d', '7d']]));
  }

  function buildLiveRow(row) {
    return element('tr', {},
      element('td', { text: row.name }),
      element('td', { text: row.category || 'Other' }),
      element('td', { text: formatMoney(row.tvl_usd) }),
      element('td', { text: formatPercent(row.change_7d) }),
      element('td', { text: formatMoney(row.mcap_usd) }));
  }

  function renderLiveSection() {
    return element('section', { class: 'panel' },
      element('h2', { text: 'Live tokens · top market cap' }),
      element('div', { class: 'scroll' },
        element('table', {},
          element('thead', {}, element('tr', {}, ['Protocol', 'Category', 'TVL', '7d', 'Market cap'].map(function (label) {
            return element('th', { text: label });
          }))),
          element('tbody', {}, (data.live || []).map(buildLiveRow)))));
  }

  function render() {
    root.textContent = '';
    var base = element('div', { class: 'shell' },
      renderHeader(),
      renderMainSection());

    base.appendChild(renderEarlySection());
    base.appendChild(renderLiveSection());
    base.appendChild(element('p', {
      class: 'muted foot',
      text: 'Model radar-2 · implied = max(1, round(TVL × category median multiple × momentum × maturity × reach). Category multiples use live-token median market-cap/TVL; categories with fewer than 3 peers use the global median.'
    }));
    if (selected) base.appendChild(renderDetail());
    root.appendChild(base);
    root.setAttribute('aria-busy', 'false');
  }

  render();
})();

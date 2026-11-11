import {
  DEFAULT_SETTINGS, randomKeywords, isWinnerProduct, winnerFailures, estimateProfit, isLikelyBranded, competitionLevel, scoreProduct, toCsv, toExcelXml, triggerDownload,
} from './lib.js';

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));

let products = [];
let saved = [];
let settings = { ...DEFAULT_SETTINGS };

// ---------- storage ----------
async function load() {
  const data = await chrome.storage.local.get({ products: [], saved: [], history: [], settings: DEFAULT_SETTINGS });
  saved = data.saved;
  settings = { ...DEFAULT_SETTINGS, ...data.settings };
  const scanState = await readState();
  if (scanState.running) {
    await setState({ running: false, paused: false, stopped: false, message: 'Previous scan was interrupted (dashboard tab was closed or reloaded).' });
  }
  // Every fresh dashboard session starts at zero: archive any leftover products
  // to History, then clear the home stats.
  if (data.products.length) {
    if (!scanState.sessionArchived) {
      const winners = data.products.filter(product => isWinnerProduct(product, settings)).length;
      const session = { at: new Date().toISOString(), session: true, scanned: data.products.length, winners, pages: scanState.step || 0, reason: 'stopped' };
      await chrome.storage.local.set({ history: [session, ...data.history].slice(0, 200) });
    }
    await chrome.storage.local.set({ products: [] });
  }
  products = [];
  $('minRatingFilter').value = String(settings.minRating);
  $('minPrice').value = settings.minPrice || '';
  $('maxPrice').value = settings.maxPrice || '';
  $('pagesSelect').value = String(settings.maxPages || 3);
  render();
}

// ---------- helpers ----------
function matchingFilter(product) {
  const min = Number($('minRatingFilter').value) || 0;
  const minPrice = Number($('minPrice').value) || 0;
  const maxPrice = Number($('maxPrice').value) || Infinity;
  const hasRating = product.rating && product.rating >= min;
  const brandFree = !product.branded;
  return hasRating && brandFree && product.price >= minPrice && product.price <= maxPrice;
}

function currentList() {
  const query = $('search').value.toLowerCase();
  const scope = $('scopeSelect').value;
  return products
    .filter(p => !query || p.title.toLowerCase().includes(query))
    .filter(p => {
      if (scope === 'winners') return isWinnerProduct(p, settings);
      if (scope === 'unbranded') return !p.branded;
      if (scope === 'all') return true;
      return matchingFilter(p);
    })
    .sort(comparator());
}

function comparator() {
  const key = $('sort').value;
  const scoreOf = p => scoreProduct(p).score;
  const profitOf = p => estimateProfit(p, settings)?.profit ?? -Infinity;
  const marginOf = p => estimateProfit(p, settings)?.margin ?? -Infinity;
  return (a, b) => {
    switch (key) {
      case 'rating': return (b.rating ?? 0) - (a.rating ?? 0);
      case 'price': return a.price - b.price;
      case 'profit': return profitOf(b) - profitOf(a);
      case 'margin': return marginOf(b) - marginOf(a);
      case 'reviews': return (b.reviews ?? 0) - (a.reviews ?? 0);
      case 'sold': return (b.soldCount ?? 0) - (a.soldCount ?? 0);
      case 'unread': return Number(a.branded) - Number(b.branded) || scoreOf(b) - scoreOf(a);
      default: return scoreOf(b) - scoreOf(a);
    }
  };
}

// ---------- stats ----------
function renderStats() {
  const rated = products.filter(p => p.rating);
  const unbranded = products.filter(p => !p.branded);
  const winners = products.filter(p => isWinnerProduct(p, settings));
  const avgRating = rated.length ? (rated.reduce((s, p) => s + p.rating, 0) / rated.length).toFixed(2) : '—';
  const withProfit = winners.map(p => estimateProfit(p, settings)).filter(Boolean);
  const avgProfit = withProfit.length ? (withProfit.reduce((s, e) => s + e.profit, 0) / withProfit.length).toFixed(2) : '—';
  const best = [...winners].sort((a, b) => scoreProduct(b).score - scoreProduct(a).score)[0];
  $('stats').innerHTML = `
    <div><b>${products.length}</b><span>Scanned</span></div>
    <div><b>${winners.length}</b><span>Winners</span></div>
    <div><b>${unbranded.length}</b><span>Unbranded</span></div>
    <div><b>${rated.length ? avgRating + '★' : '—'}</b><span>Avg rating</span></div>
    <div><b title="${escapeHtml(best?.title || '')}">${best ? scoreProduct(best).score : '—'}</b><span>Best winner</span></div>
    <div><b>£${avgProfit}</b><span>Avg est. profit</span></div>`;

  const pct = n => products.length ? `${Math.round((n / products.length) * 100)}%` : '—';
  const withReviews = products.filter(p => p.reviews != null).length;
  const withSold = products.filter(p => p.soldCount != null).length;
  const withWatchers = products.filter(p => p.watchersCount != null).length;
  const topScore = products.length ? Math.max(...products.map(p => scoreProduct(p).score)) : 0;
  $('coverage').textContent = products.length
    ? `Data captured — rating: ${rated.length} (${pct(rated.length)}) · reviews: ${withReviews} (${pct(withReviews)}) · sold: ${withSold} (${pct(withSold)}) · watchers: ${withWatchers} (${pct(withWatchers)}) · best score: ${topScore}`
    : '';
}

// ---------- product cards ----------
function cardHtml(product) {
  const { score: itemScore, breakdown } = scoreProduct(product);
  const profit = estimateProfit(product, settings);
  const competition = competitionLevel(product);
  const inSaved = saved.some(item => item.id === product.id);
  const brandState = product.brandText
    ? `<span class="badge ${product.branded ? 'bad' : 'good'}">Brand (verified): ${escapeHtml(product.brandText)}</span>`
    : `<span class="badge ${product.branded ? 'bad' : 'good'}">${product.branded ? 'Brand signal in title' : 'Likely unbranded'}</span>`;
  return `
  <article class="product" data-id="${escapeHtml(product.id)}">
    <img src="${escapeHtml(product.image)}" alt="" loading="lazy">
    <div>
      <h3>${escapeHtml(product.title)}</h3>
      <div class="meta-line">£${product.price.toFixed(2)} · ${product.rating ? `${product.rating}★ (${product.reviews ?? 'no review count'})` : 'No rating on page'}</div>
      <div class="meta-line">Seller: ${escapeHtml(product.seller || 'unknown')}${product.feedbackPercent ? ` · ${escapeHtml(product.feedbackPercent)}% positive` : ''}</div>
      <div class="meta-line">Shipping: ${escapeHtml(product.shipping || 'Not shown')} · Location: ${escapeHtml(product.location || 'Not shown')}</div>
      <div class="badges">
        ${brandState}
        <span class="badge">Competition: ${competition.level}</span>
        ${product.soldText ? `<span class="badge good">${escapeHtml(product.soldText)}</span>` : ''}
        ${product.watchersText ? `<span class="badge good">${escapeHtml(product.watchersText)}</span>` : ''}
        ${profit ? `<span class="badge ${profit.profit >= 0 ? 'good' : 'bad'}">Est. profit £${profit.profit} · ${profit.margin}%</span>` : ''}
        ${profit ? `<span class="badge">Est. cost £${profit.cost} + fees £${profit.fees}</span>` : ''}
      </div>
      <div class="actions">
        <button data-act="open">Open on eBay ↗</button>
        <button data-act="copy">Copy link</button>
        <button data-act="save">${inSaved ? '★ Remove' : '☆ Save'}</button>
        <button data-act="details">Details</button>
        ${!product.brandText ? `<button data-act="verify">Verify brand</button>` : ''}
      </div>
      <div class="details" hidden></div>
    </div>
    <div class="score"><b>${itemScore}</b><small>score / 100</small></div>
  </article>`;
}

function detailsHtml(product, breakdown) {
  const fails = winnerFailures(product, settings);
  const rows = [
    ['Winner check', fails.length ? `No — ${fails.join('; ')}` : 'Yes'],
    ['URL', `<a href="${escapeHtml(product.url)}" target="_blank">${escapeHtml(product.url)}</a>`],
    ['Price', product.priceText || product.price],
    ['Rating', product.rating ? `${product.rating} stars` : 'Not shown on page'],
    ['Reviews', product.reviews ?? 'Not shown'],
    ['Sold', product.soldText || 'Not shown'],
    ['Watchers', product.watchersText || 'Not shown'],
    ['Competition (heuristic)', `${competitionLevel(product).level} — ${competitionLevel(product).note}`],
    ['Seller', product.seller || 'Not shown'],
    ['Seller feedback', product.feedbackPercent ? `${product.feedbackPercent}% positive` : 'Not shown'],
    ['Shipping', product.shipping || 'Not shown'],
    ['Item location', product.location || 'Not shown'],
    ['Subtitle', product.subtitle || '—'],
    ['Brand text (item specifics)', product.brandText || 'Not checked'],
    ['Source keyword', product.sourceKeyword || product.keywords?.join(', ') || '—'],
    ['First scanned', product.scannedAt || '—'],
    ['Score breakdown', breakdown.map(item => `${item.label} ${item.points >= 0 ? '+' : ''}${item.points}`).join(', ')],
  ];
  const specifics = Object.entries(product.specifics || {}).slice(0, 12)
    .map(([key, value]) => [key, value]);
  return `<dl>${[...rows, ...specifics].map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${value}</dd>`).join('')}</dl>`;
}

function renderCards() {
  const list = currentList();
  if (!list.length) {
    const scope = $('scopeSelect').value;
    if (scope === 'winners') {
      const top = [...products].sort((a, b) => scoreProduct(b).score - scoreProduct(a).score)[0];
      const why = top ? ` Closest candidate: score ${scoreProduct(top).score}/100 — missing: ${winnerFailures(top, settings).join('; ')}.` : '';
      $('products').innerHTML = `<div class="empty">No winners found yet. A winner needs: unbranded, £3-£100 price, positive estimated profit, and either 4.3★+ with a score of 55+, or — when no rating is shown — strong demand (100+ sold or 50+ reviews); plus at least 30 combined interest signals.${why}</div>`;
    } else {
      $('products').innerHTML = '<div class="empty">No products match. Start a hunt or relax the filters.</div>';
    }
    return;
  }
  const SHOW_LIMIT = 300;
  const shown = list.slice(0, SHOW_LIMIT);
  $('products').innerHTML = shown.map(cardHtml).join('')
    + (list.length > SHOW_LIMIT
      ? `<div class="empty">Showing first ${SHOW_LIMIT} of ${list.length} products — use search and filters to narrow down.</div>`
      : '');
}

function render() {
  renderStats();
  renderCards();
  renderSaved();
}

// ---------- scan ----------
// The scan engine runs in THIS page (not the service worker), because Chrome
// terminates the MV3 background worker after ~5 minutes, which killed long scans
// and left the controls stuck. Keep this tab open while a scan runs.
const MAX_PRODUCTS = 50000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let scanTabId = null;

async function readState() {
  const { scanState } = await chrome.storage.session.get({ scanState: {} });
  return scanState;
}

async function setState(patch) {
  const current = await readState();
  await chrome.storage.session.set({ scanState: { ...current, ...patch } });
}

function buildSearchUrl(keyword, page) {
  const params = new URLSearchParams({
    _nkw: keyword,
    _ipg: '60',
    _pgn: String(page),
    LH_PrefLoc: '1',      // UK preference
    LH_LocatedIn: '1',    // item location filter
    _salic: '3',          // United Kingdom (eBay site 3)
  });
  return `https://www.ebay.co.uk/sch/i.html?${params.toString()}`;
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Page load timed out'));
    }, timeoutMs);
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function extractFromTab(tabId, messageType) {
  const send = () => chrome.tabs.sendMessage(tabId, { type: messageType });
  try {
    return await send();
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await sleep(400);
    return send();
  }
}

async function ensureTabAlive() {
  try {
    const tab = await chrome.tabs.get(scanTabId);
    return typeof tab?.id === 'number';
  } catch {
    return false;
  }
}

async function mergeProducts(newProducts) {
  const data = await chrome.storage.local.get({ products: [] });
  const map = new Map(data.products.map(product => [product.id, product]));
  let added = 0;
  for (const product of newProducts) {
    const existing = map.get(product.id);
    if (existing) {
      existing.lastSeen = new Date().toISOString();
      for (const key of ['rating', 'reviews', 'soldCount', 'watchersCount', 'shipping', 'location', 'soldText', 'watchersText']) {
        if (existing[key] == null && product[key] != null) existing[key] = product[key];
      }
      continue;
    }
    map.set(product.id, { ...product });
    added += 1;
  }
  const merged = [...map.values()].slice(-MAX_PRODUCTS);
  await chrome.storage.local.set({ products: merged });
  return { added, total: merged.length, merged };
}

async function finishScan(reason, pagesScanned, winners, historyItems) {
  const data = await chrome.storage.local.get({ products: [], history: [] });
  const rows = [];
  if (pagesScanned > 0) {
    rows.push({ at: new Date().toISOString(), session: true, scanned: data.products.length, winners, pages: pagesScanned, reason });
  }
  if (rows.length || historyItems.length) {
    await chrome.storage.local.set({ history: [...rows, ...historyItems, ...data.history].slice(0, 200) });
  }
  const message = reason === 'stopped'
    ? `Stopped after ${pagesScanned} pages — ${winners} winner${winners === 1 ? '' : 's'} found`
    : reason === 'target'
      ? `Done: ${winners} winners found after ${pagesScanned} pages`
      : `Safety stop after ${pagesScanned} pages — ${winners} winner${winners === 1 ? '' : 's'} found. Press Start to keep hunting.`;
  await setState({
    running: false,
    paused: false,
    stopped: false,
    finishedAt: new Date().toISOString(),
    winnersFound: winners,
    sessionArchived: true,
    message,
  });
  products = data.products;
  render();
}

const TARGET_WINNERS = 10;
const SAFETY_MAX_PAGES = 150;

async function runScan(pagesPerKeyword) {
  scanTabId = null;
  const pages = Math.min(Math.max(1, pagesPerKeyword), 20);
  const historyItems = [];
  let pagesScanned = 0;
  let winners = 0;
  let keywordQueue = randomKeywords(8);
  const gen = Date.now();

  await setState({
    running: true, paused: false, stopped: false, stages: [], totalSteps: 0, step: 0,
    goalWinners: TARGET_WINNERS, winnersFound: 0, sessionArchived: false, gen,
    startedAt: new Date().toISOString(), finishedAt: null, message: 'Hunting for winners…',
  });

  try {
    while (keywordQueue.length || pagesScanned < SAFETY_MAX_PAGES) {
      if (!keywordQueue.length) keywordQueue = randomKeywords(8);
      const keyword = keywordQueue.shift();

      if (!scanTabId || !(await ensureTabAlive())) {
        const tab = await chrome.tabs.create({ url: buildSearchUrl(keyword, 1), active: false });
        scanTabId = tab.id;
      }

      for (let page = 1; page <= pages; page += 1) {
        let state = await readState();
        while (state.paused && !state.stopped && state.running) {
          await sleep(500);
          state = await readState();
        }
        if (state.gen !== gen) return;
        if (state.stopped || !state.running) return finishScan('stopped', pagesScanned, winners, historyItems);

        const pageUrl = buildSearchUrl(keyword, page);
        await setState({
          currentKeyword: keyword,
          step: pagesScanned,
          winnersFound: winners,
          message: `Winners ${winners}/${TARGET_WINNERS} · "${keyword}" page ${page}/${pages}`,
        });
        await chrome.tabs.update(scanTabId, { url: pageUrl });
        await waitForTabComplete(scanTabId);

        let interrupted = false;
        const delayMs = Number(settings.pageDelayMs) || 2000;
        for (let waited = 0; waited < delayMs; waited += 250) {
          state = await readState();
          if (state.gen !== gen) return;
          if (state.stopped || !state.running) { interrupted = true; break; }
          if (state.paused) break;
          await sleep(Math.min(250, delayMs - waited));
        }
        if (interrupted) return finishScan('stopped', pagesScanned, winners, historyItems);

        let response;
        try {
          response = await extractFromTab(scanTabId, 'extractListings');
        } catch (error) {
          await setState({ message: `Could not scan "${keyword}" page ${page}: ${error.message}` });
          pagesScanned += 1;
          continue;
        }

        const after = await readState();
        if (after.gen !== gen) return;
        if (after.stopped || !after.running) return finishScan('stopped', pagesScanned, winners, historyItems);

        const fresh = (response.products || []).map(product => ({
          ...product,
          branded: isLikelyBranded(product, settings),
          sourceKeyword: keyword,
        }));
        const { added, merged } = await mergeProducts(fresh);
        historyItems.push({ at: new Date().toISOString(), keyword, page, url: pageUrl, found: fresh.length, added });
        pagesScanned += 1;
        winners = merged.filter(product => isWinnerProduct(product, settings)).length;

        await setState({
          step: pagesScanned,
          winnersFound: winners,
          message: `Winners ${winners}/${TARGET_WINNERS} · ${added} new from "${keyword}" page ${page} (${pagesScanned} pages scanned)`,
        });

        const data = await chrome.storage.local.get({ products: [] });
        products = data.products;
        render();

        if (winners >= TARGET_WINNERS) return finishScan('target', pagesScanned, winners, historyItems);
        if (pagesScanned >= SAFETY_MAX_PAGES) return finishScan('cap', pagesScanned, winners, historyItems);
      }
    }
    return finishScan('cap', pagesScanned, winners, historyItems);
  } catch (error) {
    await setState({ running: false, paused: false, stopped: false, finishedAt: new Date().toISOString(), message: `Scan error: ${error.message}` });
  }
}

async function pollScan() {
  const scanState = await readState();
  const running = !!scanState.running;
  $('startBtn').disabled = running;
  $('pauseBtn').disabled = !running || scanState.paused;
  $('resumeBtn').disabled = !running || !scanState.paused;
  $('stopBtn').disabled = !running;
  $('progressWrap').hidden = !running && !scanState.message;
  const bar = scanState.goalWinners
    ? Math.round(((scanState.winnersFound || 0) / scanState.goalWinners) * 100)
    : 0;
  $('progressBar').style.width = `${Math.min(100, running ? bar : (scanState.finishedAt ? bar : 0))}%`;
  $('scanMessage').textContent = scanState.message || '';
  if (running) $('status').textContent = scanState.message || 'Hunting…';
  else $('status').textContent = scanState.message || 'Ready';
}

async function startScan() {
  // Every hunt starts from zero: archive the previous session to History first,
  // then clear the product list so Scanned/Winners counters reset automatically.
  const data = await chrome.storage.local.get({ products: [], history: [], settings: DEFAULT_SETTINGS });
  settings = { ...DEFAULT_SETTINGS, ...data.settings };
  const state = await readState();
  if (data.products.length) {
    if (!state.sessionArchived) {
      const winners = data.products.filter(product => isWinnerProduct(product, settings)).length;
      const session = { at: new Date().toISOString(), session: true, scanned: data.products.length, winners, pages: state.step || 0, reason: 'stopped' };
      await chrome.storage.local.set({ history: [session, ...data.history].slice(0, 200) });
    }
    await chrome.storage.local.set({ products: [] });
    products = [];
  }
  setStatus('New hunt started — previous results archived to History. Hunting until 10 winners are found…');
  $('scopeSelect').value = 'winners';
  $('sort').value = 'score';
  render();
  runScan(Number($('pagesSelect').value) || 3);
}

// ---------- actions ----------
function setStatus(text) { $('status').textContent = text; }

async function toggleSave(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  const index = saved.findIndex(p => p.id === id);
  if (index >= 0) saved.splice(index, 1); else saved.push(product);
  await chrome.storage.local.set({ saved });
  setStatus(index >= 0 ? 'Removed from favourites' : 'Saved to favourites');
  renderCards();
  renderSaved();
}

function handleCardClick(event, list) {
  const button = event.target.closest('button');
  if (!button) return;
  const card = event.target.closest('[data-id]');
  const product = list?.find(p => p.id === card?.dataset.id);
  if (!product) return;
  if (button.dataset.act === 'open') chrome.tabs.create({ url: product.url });
  if (button.dataset.act === 'copy') navigator.clipboard.writeText(product.url).then(() => setStatus('Link copied'));
  if (button.dataset.act === 'save') toggleSave(product.id);
  if (button.dataset.act === 'details') {
    const panel = card.querySelector('.details');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) panel.innerHTML = detailsHtml(product, scoreProduct(product).breakdown);
  }
  if (button.dataset.act === 'verify') {
    button.disabled = true;
    button.textContent = 'Checking…';
    chrome.runtime.sendMessage({ type: 'brand:verify', id: product.id, url: product.url }, response => {
      setStatus(response?.ok
        ? `Brand check done for "${product.title.slice(0, 40)}…"`
        : `Brand check failed: ${response?.error || 'unknown error'}`);
      setTimeout(() => chrome.storage.local.get({ products: [] }).then(data => { products = data.products; render(); }), 300);
    });
  }
}

// ---------- exports ----------
function exportRows(list) {
  const header = ['Title', 'URL', 'Price GBP', 'Rating', 'Reviews', 'Sold', 'Watchers', 'Brand check', 'Seller', 'Seller feedback %', 'Shipping', 'Item location', 'Competition', 'Est. profit GBP (estimate)', 'Est. margin % (estimate)', 'Opportunity score'];
  const rows = list.map(p => {
    const profit = estimateProfit(p, settings);
    return [
      p.title, p.url, p.price, p.rating ?? '', p.reviews ?? '', p.soldCount ?? '', p.watchersCount ?? '',
      p.brandText || (p.branded ? 'Branded signal' : 'No brand signal'),
      p.seller ?? '', p.feedbackPercent ?? '', p.shipping ?? '', p.location ?? '',
      competitionLevel(p).level,
      profit ? profit.profit : '', profit ? profit.margin : '',
      scoreProduct(p).score,
    ];
  });
  return [header, ...rows];
}

// ---------- saved tab ----------
function renderSaved() {
  $('savedList').innerHTML = saved.length
    ? saved.map(cardHtml).join('')
    : '<div class="empty">No saved products yet. Use ☆ Save on the Hunter tab.</div>';
}

// ---------- history tab ----------
function renderHistory() {
  chrome.storage.local.get({ history: [] }).then(({ history }) => {
    $('historyList').innerHTML = history.length
      ? history.map(item => item.session
        ? `
        <div class="history-row">
          <div>
            <div><strong>Hunt session</strong></div>
            <div class="when">${new Date(item.at).toLocaleString()} · ${item.scanned} scanned · <strong>${item.winners} winners</strong> · ${item.pages} pages${item.reason === 'target' ? ' · target reached' : item.reason === 'cap' ? ' · safety stop' : ''}</div>
          </div>
          <div class="when">archived</div>
        </div>`
        : `
        <div class="history-row">
          <div>
            <div><strong>${escapeHtml(item.keyword)}</strong> page ${item.page}</div>
            <div class="when">${new Date(item.at).toLocaleString()} · ${item.found} listings · +${item.added} new</div>
          </div>
          <div class="when">${escapeHtml(item.url)}</div>
        </div>`).join('')
      : '<div class="empty">No scans yet.</div>';
  });
}

// ---------- init & events ----------
$('settingsBtn').onclick = () => switchTab('settings');
$('openOptions').onclick = () => chrome.runtime.openOptionsPage();
$('startBtn').onclick = () => startScan();
$('pauseBtn').onclick = async () => { await setState({ paused: true }); pollScan(); };
$('resumeBtn').onclick = async () => { await setState({ paused: false }); pollScan(); };
$('stopBtn').onclick = async () => {
  await setState({ stopped: true, running: false, paused: false, message: 'Stopping scan' });
  pollScan();
};
$('resetBtn').onclick = async () => {
  const state = await readState();
  const data = await chrome.storage.local.get({ products: [], history: [] });
  if (data.products.length && !state.sessionArchived) {
    const winners = data.products.filter(product => isWinnerProduct(product, settings)).length;
    const session = { at: new Date().toISOString(), session: true, scanned: data.products.length, winners, pages: state.step || 0, reason: 'stopped' };
    await chrome.storage.local.set({ history: [session, ...data.history].slice(0, 200) });
  }
  await setState({
    running: false, paused: false, stopped: false, gen: Date.now(),
    stages: [], step: 0, totalSteps: 0, winnersFound: 0, currentKeyword: '',
    startedAt: null, finishedAt: null, sessionArchived: true,
    message: 'Reset — previous hunt saved to History, counters cleared.',
  });
  await chrome.storage.local.set({ products: [] });
  products = [];
  setStatus('Reset — previous hunt saved to History');
  render();
  renderHistory();
  pollScan();
};

$('products').onclick = event => handleCardClick(event, products);
$('savedList').onclick = event => handleCardClick(event, saved);
$('search').addEventListener('input', renderCards);
$('sort').onchange = renderCards;
$('minRatingFilter').onchange = () => { renderStats(); renderCards(); };
$('minPrice').oninput = renderCards;
$('maxPrice').oninput = renderCards;
$('scopeSelect').onchange = renderCards;

$('csvBtn').onclick = () => triggerDownload(toCsv(exportRows(currentList())), 'ebay-hunter-products.csv', 'text/csv');
$('xlsBtn').onclick = () => triggerDownload(toExcelXml(exportRows(currentList())), 'ebay-hunter-products.xls', 'application/vnd.ms-excel');
$('savedCsvBtn').onclick = () => triggerDownload(toCsv(exportRows(saved)), 'ebay-hunter-saved.csv', 'text/csv');
$('savedXlsBtn').onclick = () => triggerDownload(toExcelXml(exportRows(saved)), 'ebay-hunter-saved.xls', 'application/vnd.ms-excel');

$('clearSavedBtn').onclick = () => { saved = []; chrome.storage.local.set({ saved }); renderSaved(); };
$('clearHistoryBtn').onclick = () => { chrome.storage.local.set({ history: [] }); renderHistory(); };

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
  document.querySelectorAll('.tabpage').forEach(page => { page.hidden = page.id !== `tab-${name}`; });
  if (name === 'history') renderHistory();
}

document.querySelectorAll('nav .tab').forEach(tab => { tab.onclick = () => switchTab(tab.dataset.tab); });

load().then(() => pollScan());
setInterval(() => {
  chrome.storage.session.get({ scanState: {} }).then(({ scanState }) => { if (scanState.running) pollScan(); });
}, 800);
setInterval(() => {
  chrome.storage.local.get({ products: [] }).then(({ products: fresh }) => {
    if (fresh.length !== products.length || (fresh[0]?.lastSeen && fresh.some((p, i) => p.id !== products[i]?.id))) {
      products = fresh;
      render();
    }
  });
}, 2000);

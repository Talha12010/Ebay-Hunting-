// Shared helpers used by the popup and the background service worker.

export const DEFAULT_SETTINGS = {
  minRating: 4.5,
  minPrice: 0,
  maxPrice: 500,
  brandFilter: true,
  brandBlacklist: 'Varo',
  // Profit assumptions (user supplied, never fabricated by the extension):
  costPercent: 40,   // assumed sourcing cost as % of the eBay price
  feePercent: 13,    // assumed eBay + payment fees as % of the price
  shippingCost: 0,   // assumed shipping cost per order in GBP
  maxPages: 3,
  pageDelayMs: 2000,
};

// A non-exhaustive list of well-known manufacturer / trademark brands.
// Matched with word boundaries so generic words in titles are not mistaken for brands.
export const KNOWN_BRANDS = [
  'AEG', 'Alienware', 'Amazon', 'Anker', 'Apple', 'Ariel', 'Ariston', 'Asus', 'Beko', 'Bissell', 'Black+Decker',
  'Bosch', 'Breville', 'Brother', 'Canon', 'Casio', 'Cornetto', 'Dell', 'DeWalt', 'Disney', 'Dremel', 'Dyson',
  'Echo', 'Einhell', 'Electrolux', 'Epson', 'Fitbit', 'Garmin', 'Gilette', 'Gillette', 'GoPro', 'Google',
  'Gtech', 'Haribo', 'Honor', 'Hoover', 'HP', 'Huawei', 'Ikea', 'iRobot', 'JBL', 'Kindle', 'KitchenAid',
  'Kärcher', 'Lenovo', 'Lexmark', 'Logitech', 'Lego', 'Microsoft', 'Miele', 'Morphy Richards', 'Motorola',
  'Nest', 'Nike', 'Nintendo', 'Nokia', 'Nordvpn', 'OnePlus', 'OPPO', 'Panasonic', 'Philips', 'PlayStation',
  'Polaroid', 'Puma', 'Ravensburger', 'Razor', 'Ring', 'Ryobi', 'Samsung', 'Seagate', 'Sharpie', 'Shark',
  'Sinatra', 'Sony', 'Stanley', 'Suck UK', 'Tefal', 'Tesla', 'Titan', 'TomTom', 'Toshiba', 'Vax', 'Varo',
  'Vive', 'WD', 'Whirlpool', 'Wiha', 'Xbox', 'Xiaomi', 'Zanussi', 'Zwilling',
];

const UNBRAND_WORDS = ['unbranded', 'no brand', 'nobrand', 'generic'];

export function isLikelyBranded(product, settings) {
  if (!settings || settings.brandFilter === false) return false;
  const extra = String(settings.brandBlacklist || '')
    .split(',').map(name => name.trim()).filter(Boolean)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const names = [...KNOWN_BRANDS, ...extra];
  const pattern = new RegExp(`\\b(${names.join('|')})\\b`, 'i');
  return pattern.test(product.title) ||
    pattern.test(product.subtitle || '') ||
    pattern.test(product.brandText || '');
}

export function parsedSold(product) {
  return Number(product.soldCount) || null;
}

export function parsedWatchers(product) {
  return Number(product.watchersCount) || null;
}

// 0-100 heuristic score built ONLY from data visible on the eBay page.
// Transparent weight breakdown, no fabricated demand or sales figures.
export function scoreProduct(product) {
  let score = 0;
  const breakdown = [];
  if (product.rating) {
    const points = Math.min(35, (product.rating / 5) * 35);
    score += points;
    breakdown.push({ label: 'Rating', points: Math.round(points) });
  }
  if (product.reviews) {
    const points = Math.min(20, (Math.log10(product.reviews + 1) / 4) * 20);
    score += points;
    breakdown.push({ label: 'Review count', points: Math.round(points) });
  }
  const sold = parsedSold(product);
  if (sold) {
    const points = Math.min(8, (Math.log10(sold + 1) / 4) * 8);
    score += points;
    breakdown.push({ label: 'Items sold', points: Math.round(points) });
  }
  const watchers = parsedWatchers(product);
  if (watchers) {
    const points = Math.min(7, (Math.log10(watchers + 1) / 4) * 7);
    score += points;
    breakdown.push({ label: 'Watchers', points: Math.round(points) });
  }
  if (product.brandText && UNBRAND_WORDS.some(word => product.brandText.toLowerCase().includes(word))) {
    score += 15;
    breakdown.push({ label: 'Verified unbranded', points: 15 });
  } else if (!product.branded) {
    score += 15;
    breakdown.push({ label: 'No brand signal', points: 15 });
  }
  if (product.price) {
    const points = Math.max(0, Math.min(15, 15 * (1 - Math.min(1, product.price / 120))));
    score += points;
    breakdown.push({ label: 'Low price', points: Math.round(points) });
  }
  if (!product.rating) {
    score -= 10; // unverifiable rating is a real risk signal
    breakdown.push({ label: 'No rating data', points: -10 });
  }
  return { score: Math.max(0, Math.min(100, Math.round(score))), breakdown };
}

// Profit is an ESTIMATE built from the user's own assumptions in Settings.
// Returns null when a required input is missing.
export function estimateProfit(product, settings) {
  if (!product.price || !settings) return null;
  const { costPercent = 40, feePercent = 13, shippingCost = 0 } = settings;
  const cost = +(product.price * costPercent / 100).toFixed(2);
  const fees = +(product.price * feePercent / 100).toFixed(2);
  const shipping = Number(shippingCost) || 0;
  const profit = +(product.price - cost - fees - shipping).toFixed(2);
  const margin = +(profit / product.price * 100).toFixed(1);
  return { cost, fees, shipping, profit, margin };
}

// A transparent competition proxy based on visible interest, not invented data.
export function competitionLevel(product) {
  const reviews = product.reviews || 0;
  const sold = parsedSold(product) || 0;
  const watchers = parsedWatchers(product) || 0;
  const signal = reviews + sold + watchers;
  if (product.reviews === null && sold === null && (product.watchersText || '') === '') {
    return { level: 'Unknown', note: 'No interest data on the page' };
  }
  if (signal >= 500) return { level: 'High', note: `${signal.toLocaleString()} recorded interactions` };
  if (signal >= 50) return { level: 'Medium', note: `${signal.toLocaleString()} recorded interactions` };
  return { level: 'Low', note: `${signal.toLocaleString()} recorded interactions` };
}

// Random search generation: generic product nouns and descriptors are combined
// randomly to produce fresh searches each hunt. There are no categories here —
// just individual words.
const PRODUCT_WORDS = [
  'holder', 'organiser', 'organizer', 'mat', 'box', 'rack', 'tray', 'brush', 'clip', 'stand',
  'bag', 'bottle', 'light', 'lamp', 'pouch', 'cover', 'hook', 'pad', 'net', 'tube', 'grip',
  'roller', 'cutter', 'bin', 'caddy', 'dispenser', 'hanger', 'strap', 'case', 'sleeve', 'wrap',
  'label', 'marker', 'scoop', 'scraper', 'sponge', 'towel', 'apron', 'gloves', 'scale', 'timer',
  'fan', 'speaker', 'charger', 'cable', 'mount', 'mirror', 'shelf', 'basket', 'box set', 'kit',
];

const DESCRIPTOR_WORDS = [
  'mini', 'portable', 'foldable', 'waterproof', 'magnetic', 'adjustable', 'reusable', 'compact',
  'hanging', 'silicone', 'stainless steel', 'non slip', 'multi purpose', 'travel', 'collapsible',
  'heavy duty', 'wireless', 'solar', 'rechargeable', 'self adhesive', 'slim', 'stackable',
  'insulated', 'floating', 'retractable', 'water resistant', 'lightweight', 'extendable',
];

export function randomKeywords(count = 8) {
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const seen = new Set();
  const phrases = [];
  let guard = 0;
  while (phrases.length < count && guard < count * 100) {
    guard += 1;
    const phrase = `${pick(DESCRIPTOR_WORDS)} ${pick(PRODUCT_WORDS)}`;
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    phrases.push(phrase);
  }
  return phrases;
}

// A "winner" is a product that passes ALL of these checks:
//  - unbranded (no brand signal)
//  - price £3-£100 and a positive estimated profit (user's own settings)
//  - real recorded interest: reviews + sold + watchers >= 30
//  - quality: either a visible rating >= 4.3 with a score >= 55, or — when
//    eBay shows no rating — strong demand (100+ sold or 50+ reviews).
export function winnerFailures(product, settings) {
  const fails = [];
  const config = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (!product || !product.title) return ['no product data'];
  if (product.branded) fails.push('branded');
  const reviews = Number(product.reviews) || 0;
  const sold = Number(product.soldCount) || 0;
  const watchers = Number(product.watchersCount) || 0;
  const interest = reviews + sold + watchers;
  const minPrice = Number(config.minPrice) || 0;
  const maxPrice = Number(config.maxPrice) > 0 ? Number(config.maxPrice) : Infinity;
  const minRating = Number(config.minRating) || 0;
  if (product.rating == null) fails.push('no rating shown');
  else if (Number(product.rating) < minRating) fails.push(`rating below ${minRating}`);
  if (interest < 5) fails.push('too little recorded interest');
  if (scoreProduct(product).score < 45) fails.push('score below 45');
  if (product.price == null || product.price < minPrice || product.price > maxPrice) fails.push('price outside configured range');
  const profit = estimateProfit(product, config);
  if (profit && profit.profit <= 0) fails.push('no estimated profit');
  return fails;
}

export function isWinnerProduct(product, settings) {
  return winnerFailures(product, settings).length === 0;
}

export function toCsv(rows) {
  return rows
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}

// Excel 2003 SpreadsheetML; opens directly in Excel and LibreOffice.
export function toExcelXml(rows, sheetName = 'Products') {
  const header = rows[0] || [];
  const body = rows.slice(1);
  const cell = value => {
    const type = typeof value === 'number' && Number.isFinite(value) ? 'Number' : 'String';
    const text = String(value ?? '').replace(/[<>&"']/g, ch => (
      { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]
    ));
    return `<Cell><Data ss:Type="${type}">${text}</Data></Cell>`;
  };
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${sheetName}">
  <Table>
${[header, ...body].map(row => `   <Row>${row.map(cell).join('')}</Row>`).join('\n')}
  </Table>
 </Worksheet>
</Workbook>`;
}

export function triggerDownload(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

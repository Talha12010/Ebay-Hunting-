// Extracts listing data from eBay UK pages the user actually browses/scan navigates to.
// Only fields visibly present on the page are captured; missing fields stay null.

const text = (root, selectors) => {
  for (const selector of selectors) {
    const value = root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return '';
};

const firstNumber = pattern => str => {
  const match = String(str || '').replace(/,/g, '').match(pattern);
  return match ? Number(match[1]) : null;
};

const parsePrice = firstNumber(/([0-9]+(?:\.[0-9]{1,2})?)/);
const parseCount = firstNumber(/([0-9]+)/);

function itemIdFromUrl(url) {
  const match = String(url || '').match(/\/itm\/(?:[^/]*\/)?(\d{7,})/);
  return match ? match[1] : null;
}

function cardFromLink(link) {
  return link.closest('li, article, [class*="card" i], [data-testid*="card" i], div[class*="item" i]') || link.parentElement?.parentElement || link.parentElement;
}

function parseFromText(cardPriceNode, link, cardText) {
  const t = cardText || '';
  const priceMatch = t.match(/£\s*([\d,]+(?:\.\d{1,2})?)/);
  const ratingMatch = t.match(/([0-5](?:\.\d)?)\s*(?:out of 5|stars\b)/i);
  const reviewsMatch = t.match(/([\d,]+)\s+(?:product\s+)?ratings?\b|\b([\d,]+)\s+sold/i);
  const soldMatch = t.match(/([\d,]+)\s+sold\b/i);
  const watchMatch = t.match(/([\d,]+)\s+watch(?:ing|ers)?\b/i);
  const title = (link.getAttribute('aria-label') || link.textContent || '').replace(/\s+/g, ' ').trim();
  const image = cardPriceNode.querySelector('img[srcset], img')?.src || '';
  const shipping = t.match(/(?:Free postage|FREE shipping|£[\d.]+\s*postage)/i)?.[0] || '';
  return {
    title,
    price: priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null,
    rating: ratingMatch ? Number(ratingMatch[1]) : null,
    reviews: reviewsMatch ? parseCount(reviewsMatch[0]) : null,
    soldCount: soldMatch ? parseCount(soldMatch[0]) : null,
    watchersCount: watchMatch ? parseCount(watchMatch[0]) : null,
    image,
    shipping,
  };
}

function fallbackExtract() {
  const seen = new Set();
  const results = [];
  for (const link of document.querySelectorAll('a[href*="/itm/"]')) {
    const id = itemIdFromUrl(link.href);
    if (!id || seen.has(id)) continue;
    const card = cardFromLink(link);
    if (!card) continue;
    seen.add(id);
    const parsed = parseFromText(card, link, card.textContent);
    if (!parsed.title || parsed.price === null) continue;
    results.push({
      id,
      ...parsed,
      priceText: parsed.price != null ? `GBP ${parsed.price}` : '',
      rawText: undefined,
      url: `https://www.ebay.co.uk/itm/${id}`,
      scannedAt: new Date().toISOString(),
    });
  }
  return results;
}

function extractListings() {
  const cards = [...document.querySelectorAll('li.s-item, div.s-item, li.s-card, div.s-card, [class*="srp-results"] li, [class*="srp-results"] article')]
    .filter(card => !card.classList.contains('s-item__placeholder'));

  const legacy = cards.length ? cards.map(card => {
    const link = card.querySelector('a.s-item__link')?.href || card.querySelector('a[href*="/itm/"]')?.href || '';
    const title = text(card, ['.s-item__title', '.s-card__title']) || text(card, ['a[href*="/itm/"]']);
    const priceText = text(card, ['.s-item__price', '[class*="price" i]']);
    // Rating is taken from stars text/aria-labels only; review count stays separate
    // so "1,234 product ratings" is never mistaken for a star score.
    const ariaText = [...card.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label') || '').join(' ');
    const cardText = `${ariaText} ${(card.textContent || '').replace(/\s+/g, ' ')}`;
    const ratingText = text(card, ['.x-star-rating__clipped', '.x-star-rating', '[aria-label*="out of 5 stars" i]', '[class*="star" i]']);
    const reviewsText = text(card, ['.s-item__reviews', '.s-item__reviews-count', '[class*="review" i]']);
    const ratingMatch = `${ratingText} ${ariaText}`.match(/([0-5](?:\.[0-9])?)\s*(?:out of(?: 5)?|stars?)\b/i)
      || cardText.match(/([0-5](?:\.[0-9])?)\s+out of\s+5\s+stars?/i);
    const reviewsCount = /ratings?|reviews?/i.test(reviewsText)
      ? parseCount(reviewsText)
      : parseCount((cardText.match(/([\d,]+)\s+(?:product\s+|seller\s+)?ratings?\b/i) || [])[0] || '');
    let soldText = text(card, ['.s-item__quantitySold', '[aria-label*="sold" i]', '[data-testid*="sold" i]']);
    if (!soldText || !/sold/i.test(soldText)) soldText = (cardText.match(/([\d,]+)\s+sold\b/i) || [])[0] || soldText;
    let watchersText = text(card, ['.s-item__hotness', '[aria-label*="watch" i]']);
    if (!watchersText || !/watch/i.test(watchersText)) watchersText = (cardText.match(/([\d,]+)\s+watch(?:ing|ers)?\b/i) || [])[0] || watchersText;
    const shipping = text(card, ['.s-item__shipping', '.s-item__logisticsCost', '.s-item__freeShipping'])
      || (cardText.match(/(?:free postage|free delivery|£[\d.]+\s*postage)/i) || [])[0] || '';
    const image = card.querySelector('.s-item__image-img, .s-item__image img, .s-card__image img, img[srcset], img')?.src || '';
    const sellerInfo = text(card, ['.s-item__seller-info-text', '.s-card__attribute-row']);
    const seller = (sellerInfo.match(/^([^\s(]+)\s*\(/) || [])[1] || sellerInfo.split(' ')[0] || '';
    const feedbackPercent = (sellerInfo.match(/([\d.]+)%\s*(?:positive|feedback)/i) || [])[1] || null;
    const location = (text(card, ['.s-item__location']).match(/from\s+(.+)$/i) || [])[1] || '';
    const subtitle = text(card, ['.s-item__subtitle', '.SECONDARY_INFO']);
    const badges = [...card.querySelectorAll('.s-item__top-rated-text, .s-item__itemSpecifics li, .s-item__badges span')]
      .map(node => node.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6);
    const id = itemIdFromUrl(link) || link.split('?')[0] || title;

    return {
      id,
      title,
      price: parsePrice(priceText),
      priceText,
      rating: ratingMatch ? Number(ratingMatch[1]) : null,
      reviews: reviewsCount,
      soldText,
      soldCount: /sold/i.test(soldText) ? parseCount(soldText) : null,
      watchersText,
      watchersCount: /watch/i.test(watchersText) ? parseCount(watchersText) : null,
      image,
      seller,
      feedbackPercent,
      shipping,
      location,
      subtitle,
      badges,
      url: itemIdFromUrl(link) ? `https://www.ebay.co.uk/itm/${itemIdFromUrl(link)}` : link.split('?')[0],
      scannedAt: new Date().toISOString(),
    };
  }).filter(item => item.title && item.url && item.price !== null && item.url.includes('/itm/')) : [];

  const seenIds = new Set(legacy.map(item => item.id));
  const extra = fallbackExtract().filter(item => !seenIds.has(item.id));
  return legacy.length || extra.length ? [...legacy, ...extra] : [];
}

// Item-page extraction used to verify brand in the item specifics.
function extractItemDetails() {
  const ratingText = text(document, ['.ux-textspans--BOLD [aria-hidden]', '.ux-x-star-rating__clipped', '#oricalReviews']);
  const reviewsText = text(document, ['#oralRatingSummary', 'a[href*="#oralRatingSummary"]']);
  const ratingMatch = ratingText.match(/([0-5](?:\.[0-9])?)/);
  const reviews = /ratings|reviews/i.test(reviewsText) ? parseCount(reviewsText) : null;

  const specifics = {};
  document.querySelectorAll('.ux-labels-values').forEach(row => {
    const label = text(row, ['.ux-labels-values__labels']);
    const value = text(row, ['.ux-labels-values__values']);
    if (label && value && label.length < 40) specifics[label.replace(/:$/, '')] = value;
  });

  return {
    brandText: specifics['Brand'] || specifics['brand'] || '',
    specifics,
    rating: ratingMatch ? Number(ratingMatch[1]) : null,
    reviews,
    soldText: text(document, ['.x-machine-translations__info--quantitySold', '[data-testid="qty-sold"]', '.d-quantity__label']),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'extractListings') {
    sendResponse({ products: extractListings(), url: location.href });
  } else if (message.type === 'extractItemDetails') {
    sendResponse({ details: extractItemDetails(), url: location.href });
  }
});

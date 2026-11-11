const DEFAULTS = {
  minRating: 4.5, minPrice: 0, maxPrice: 500, brandFilter: true, brandBlacklist: 'Varo',
  costPercent: 40, feePercent: 13, shippingCost: 0, maxPages: 3, pageDelayMs: 2000,
};

const form = document.querySelector('#settings');
const saved = document.querySelector('#saved');

function load() {
  return chrome.storage.local.get({ settings: DEFAULTS }).then(({ settings }) => {
    const merged = { ...DEFAULTS, ...settings };
    form.elements.minRating.value = merged.minRating;
    form.elements.minPrice.value = merged.minPrice;
    form.elements.maxPrice.value = merged.maxPrice;
    form.elements.brandFilter.checked = !!merged.brandFilter;
    form.elements.brandBlacklist.value = merged.brandBlacklist || '';
    form.elements.costPercent.value = merged.costPercent;
    form.elements.feePercent.value = merged.feePercent;
    form.elements.shippingCost.value = merged.shippingCost;
    form.elements.maxPages.value = merged.maxPages;
    form.elements.pageDelayMs.value = merged.pageDelayMs;
  });
}

function flash(message) {
  saved.textContent = message;
  setTimeout(() => { saved.textContent = ''; }, 2500);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const settings = {
    minRating: Number(form.elements.minRating.value),
    minPrice: Number(form.elements.minPrice.value) || 0,
    maxPrice: Number(form.elements.maxPrice.value) || 0,
    brandFilter: form.elements.brandFilter.checked,
    brandBlacklist: form.elements.brandBlacklist.value,
    costPercent: Number(form.elements.costPercent.value),
    feePercent: Number(form.elements.feePercent.value),
    shippingCost: Number(form.elements.shippingCost.value),
    maxPages: Number(form.elements.maxPages.value),
    pageDelayMs: Number(form.elements.pageDelayMs.value),
  };
  await chrome.storage.local.set({ settings });
  flash('Saved');
});

document.querySelector('#clearProducts').onclick = async () => {
  await chrome.storage.local.set({ products: [], history: [] });
  flash('Scanned products and history cleared');
};

document.querySelector('#clearAll').onclick = async () => {
  await chrome.storage.local.set({ products: [], saved: [], history: [] });
  flash('All data cleared');
};

load();

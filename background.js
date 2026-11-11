import { DEFAULT_SETTINGS, isLikelyBranded } from './lib.js';

const MAX_PRODUCTS = 3000;
let SCAN_TAB_ID = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ensureTabAlive(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return typeof tab?.id === 'number';
  } catch {
    return false;
  }
}

async function getSettings() {
  const data = await chrome.storage.local.get({ settings: DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS, ...data.settings };
}

async function updateState(patch) {
  const current = await chrome.storage.session.get({ scanState: {} });
  const state = { ...current.scanState, ...patch };
  await chrome.storage.session.set({ scanState: state });
}

async function publishState(patch = {}) {
  await updateState({
    running: false,
    paused: false,
    stages: [],
    currentKeyword: '',
    currentStep: 0,
    totalSteps: 0,
    message: '',
    startedAt: null,
    finishedAt: null,
    ...patch,
  });
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
    // Content script may not be injected into a pre-existing tab; inject on demand.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await sleep(400);
    return send();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'brand:verify') {
      try {
        if (!SCAN_TAB_ID || !(await ensureTabAlive(SCAN_TAB_ID))) {
          const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
          SCAN_TAB_ID = tab.id;
        }
        await chrome.tabs.update(SCAN_TAB_ID, { url: message.url });
        await waitForTabComplete(SCAN_TAB_ID);
        await sleep(800);
        const response = await extractFromTab(SCAN_TAB_ID, 'extractItemDetails');
        const product = {
          ...(await getProduct(message.id) || {}),
          id: message.id,
          url: message.url,
          brandText: response.details.brandText || '',
          specifics: response.details.specifics || {},
          rating: response.details.rating || null,
          reviews: response.details.reviews ?? null,
          soldText: response.details.soldText || '',
        };
        product.branded = isLikelyBranded(product, await getSettings());
        await saveProduct(product);
        await updateState({ lastVerifiedId: message.id, lastVerifiedAt: new Date().toISOString() });
        sendResponse({ ok: true, brandText: product.brandText, branded: product.branded });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    }
  })();
  return true; // keep the message channel open for async responses
});

async function getProduct(id) {
  const data = await chrome.storage.local.get({ products: [] });
  return data.products.find(product => product.id === id) || null;
}

async function saveProduct(product) {
  const data = await chrome.storage.local.get({ products: [] });
  const index = data.products.findIndex(item => item.id === product.id);
  if (index >= 0) data.products[index] = { ...data.products[index], ...product };
  else data.products.push(product);
  await chrome.storage.local.set({ products: data.products.slice(-MAX_PRODUCTS) });
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(null);
  await chrome.storage.local.set({
    products: Array.isArray(data.products) ? data.products : [],
    saved: Array.isArray(data.saved) ? data.saved : [],
    history: Array.isArray(data.history) ? data.history : [],
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
  });
  await publishState();
});

chrome.action.onClicked.addListener(async () => {
  const dashboardUrl = chrome.runtime.getURL('popup.html');
  const tabs = await chrome.tabs.query({ url: dashboardUrl });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId !== undefined) await chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: dashboardUrl });
});

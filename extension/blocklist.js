// Optional domain blocklist, configurable by category (modelled on the official extension's categories).
// All categories are OFF by default. Settings live in storage.sync under "blocklist".

const BLOCKLIST_CATEGORIES = {
  banking: { label: "Banking", domains: ["chase.com", "bankofamerica.com", "wellsfargo.com", "citi.com", "citibank.com"] },
  investing: { label: "Investing / Brokerage", domains: ["schwab.com", "fidelity.com", "robinhood.com", "etrade.com", "wealthfront.com", "betterment.com"] },
  payments: { label: "Payments / Transfers", domains: ["paypal.com", "venmo.com", "cash.app", "zellepay.com", "zelle.com", "stripe.com", "squareup.com", "square.com", "wise.com", "westernunion.com", "moneygram.com", "adyen.com", "checkout.com"] },
  bnpl: { label: "Buy now, pay later", domains: ["klarna.com", "affirm.com", "afterpay.com"] },
  neobanks: { label: "Neobanks / Fintech", domains: ["sofi.com", "chime.com", "mercury.com", "brex.com", "ramp.com"] },
  crypto: { label: "Crypto", domains: ["coinbase.com", "binance.com", "kraken.com", "metamask.io"] },
  gambling: { label: "Gambling", domains: ["draftkings.com", "fanduel.com", "bet365.com", "bovada.lv", "pokerstars.com", "betmgm.com", "caesars.com"] },
  dating: { label: "Dating", domains: ["tinder.com", "bumble.com", "hinge.co", "match.com", "okcupid.com"] },
  adult: { label: "Adult", domains: ["pornhub.com", "xvideos.com", "xnxx.com"] },
  news: { label: "News / Media", domains: ["nytimes.com", "wsj.com", "barrons.com", "marketwatch.com", "bloomberg.com", "reuters.com", "economist.com", "wired.com", "vogue.com"] },
  social: { label: "Social media", domains: ["reddit.com"] },
};

const BLOCKLIST_STORAGE_KEY = "blocklist";
const BLOCKLIST_DEFAULTS = { enabledCategories: [], customDomains: [] };

async function loadBlocklistSettings() {
  try {
    const stored = await chrome.storage.sync.get(BLOCKLIST_STORAGE_KEY);
    return { ...BLOCKLIST_DEFAULTS, ...(stored[BLOCKLIST_STORAGE_KEY] || {}) };
  } catch {
    return { ...BLOCKLIST_DEFAULTS };
  }
}

function normalizeDomain(d) {
  return String(d).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^\*\./, "").replace(/[\/:?#].*$/, "").replace(/^www\./, "");
}

// Returns the matching category label (or "custom") if the URL is blocked, else null.
function matchBlocked(url, settings) {
  let host;
  try { host = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : "https://" + url).hostname.toLowerCase(); } catch { return null; }
  const hit = (d) => host === d || host.endsWith("." + d);
  for (const key of settings.enabledCategories) {
    const cat = BLOCKLIST_CATEGORIES[key];
    if (cat && cat.domains.some(hit)) return cat.label;
  }
  if ((settings.customDomains || []).map(normalizeDomain).filter(Boolean).some(hit)) return "custom blocklist";
  return null;
}

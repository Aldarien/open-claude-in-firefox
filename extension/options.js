const $ = (id) => document.getElementById(id);

function flash(el, text, ms = 2000) {
  el.textContent = text;
  setTimeout(() => (el.textContent = ""), ms);
}

async function copy(text, noteEl, msg = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    flash(noteEl, msg);
  } catch {
    flash(noteEl, "Copy failed");
  }
}

// --- Connection ---
(async () => {
  const urlInput = $("hubUrl");
  urlInput.value = await getHubUrl();
  const httpsUrl = () => urlInput.value.replace(/^wss:/, "https:").replace(/\/ws$/, "/");
  $("trust").href = httpsUrl();

  $("saveUrl").addEventListener("click", async () => {
    const next = urlInput.value.trim();
    if (next === (await getHubUrl())) {
      flash($("urlNote"), "No change");
    } else {
      await chrome.storage.local.set({ hubUrl: next });
      flash($("urlNote"), "Saved, reconnecting…");
    }
    $("trust").href = httpsUrl();
  });

  const { publicJwk } = await getIdentity();
  $("fp").textContent = publicJwk.kid;
  $("copyFp").addEventListener("click", () => copy(publicJwk.kid, $("copyNote"), "Fingerprint copied"));

  const labelInput = $("label");
  labelInput.value = (await chrome.storage.local.get("label")).label || "";
  $("saveLabel").addEventListener("click", async () => {
    await chrome.storage.local.set({ label: labelInput.value.trim().slice(0, 40) });
    flash($("labelNote"), "Saved");
  });

  const jwkText = JSON.stringify(publicJwk, null, 2);
  $("jwk").textContent = jwkText;
  $("copy").addEventListener("click", () => copy(jwkText, $("copyNote"), "Key copied"));

  const showState = async () => {
    const { connState } = await chrome.storage.local.get("connState");
    const pill = $("connPill");
    const lead = $("conn");
    pill.className = "pill";
    $("connError").textContent = "";
    if (!connState) {
      pill.textContent = "Not connected yet";
      lead.textContent = "Waiting for the first connection attempt.";
    } else if (connState.connected) {
      pill.classList.add("ok");
      pill.textContent = "Connected";
      lead.textContent = "Connected to " + connState.url;
    } else {
      pill.classList.add("err");
      pill.textContent = "Disconnected";
      lead.textContent = "Not connected to the hub.";
      if (connState.error) $("connError").textContent = connState.error;
    }
  };
  showState();
  chrome.storage.onChanged.addListener(showState);
})();

// --- Blocklist ---
(async () => {
  const saved = await loadBlocklistSettings();
  const wrap = $("cats");
  const savebar = $("savebar");
  let baseline = "";

  const cards = Object.entries(BLOCKLIST_CATEGORIES).map(([key, cat]) => {
    const label = document.createElement("label");
    label.className = "cat";
    label.title = cat.domains.join(", ");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = key;
    const sw = document.createElement("span");
    sw.className = "switch";
    const text = document.createElement("div");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = cat.label;
    const doms = document.createElement("div");
    doms.className = "doms";
    const shown = cat.domains.slice(0, 3).join(", ");
    doms.textContent = cat.domains.length > 3 ? `${shown} +${cat.domains.length - 3} more` : shown;
    text.append(name, doms);
    label.append(cb, sw, text);
    wrap.append(label);
    return { label, cb, key };
  });

  const state = () => JSON.stringify({
    c: cards.filter((c) => c.cb.checked).map((c) => c.key),
    d: $("custom").value.split("\n").map(normalizeDomain).filter(Boolean),
  });

  const refresh = () => {
    for (const c of cards) c.label.classList.toggle("on", c.cb.checked);
    const n = cards.filter((c) => c.cb.checked).length;
    $("count").textContent = n ? `${n} of ${cards.length} categories blocked` : "No categories blocked";
    savebar.classList.toggle("show", state() !== baseline);
  };

  const apply = (settings) => {
    for (const c of cards) c.cb.checked = settings.enabledCategories.includes(c.key);
    $("custom").value = (settings.customDomains || []).join("\n");
    baseline = state();
    refresh();
  };
  apply(saved);

  for (const c of cards) c.cb.addEventListener("change", refresh);
  $("custom").addEventListener("input", refresh);
  $("allOn").addEventListener("click", () => { cards.forEach((c) => (c.cb.checked = true)); refresh(); });
  $("allOff").addEventListener("click", () => { cards.forEach((c) => (c.cb.checked = false)); refresh(); });
  $("discard").addEventListener("click", () => apply(saved));

  $("save").addEventListener("click", async () => {
    const enabledCategories = cards.filter((c) => c.cb.checked).map((c) => c.key);
    const customDomains = $("custom").value.split("\n").map(normalizeDomain).filter(Boolean);
    await chrome.storage.sync.set({ [BLOCKLIST_STORAGE_KEY]: { enabledCategories, customDomains } });
    saved.enabledCategories = enabledCategories;
    saved.customDomains = customDomains;
    baseline = state();
    $("status").textContent = "Saved";
    setTimeout(() => { $("status").textContent = ""; refresh(); }, 900);
  });
})();

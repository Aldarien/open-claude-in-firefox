(async () => {
  const urlInput = document.getElementById("hubUrl");
  urlInput.value = await getHubUrl();
  const httpsUrl = () => urlInput.value.replace(/^wss:/, "https:").replace(/\/ws$/, "/");
  document.getElementById("trust").href = httpsUrl();
  document.getElementById("saveUrl").addEventListener("click", async () => {
    await chrome.storage.local.set({ hubUrl: urlInput.value.trim() });
    document.getElementById("trust").href = httpsUrl();
  });
  const { publicJwk } = await getIdentity();
  const jwkText = JSON.stringify(publicJwk, null, 2);
  document.getElementById("jwk").value = jwkText;
  document.getElementById("copy").addEventListener("click", () => navigator.clipboard.writeText(jwkText));
  const showState = async () => {
    const { connState } = await chrome.storage.local.get("connState");
    const el = document.getElementById("conn");
    if (!connState) el.textContent = "Not connected yet.";
    else if (connState.connected) el.textContent = "Connected to " + connState.url;
    else el.textContent = "Disconnected." + (connState.error ? " " + connState.error : "");
  };
  showState();
  chrome.storage.onChanged.addListener(showState);
})();
(async () => {
  const s = await loadBlocklistSettings();
  const wrap = document.getElementById("cats");
  for (const [key, cat] of Object.entries(BLOCKLIST_CATEGORIES)) {
    const l = document.createElement("label");
    l.className = "cat";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = key; cb.checked = s.enabledCategories.includes(key);
    l.append(cb, " " + cat.label);
    const d = document.createElement("div");
    d.className = "doms"; d.textContent = cat.domains.join(", ");
    wrap.append(l, d);
  }
  document.getElementById("custom").value = (s.customDomains || []).join("\n");
  document.getElementById("save").addEventListener("click", async () => {
    const enabledCategories = [...wrap.querySelectorAll("input:checked")].map((i) => i.value);
    const customDomains = document.getElementById("custom").value.split("\n").map(normalizeDomain).filter(Boolean);
    await chrome.storage.sync.set({ [BLOCKLIST_STORAGE_KEY]: { enabledCategories, customDomains } });
    const st = document.getElementById("status");
    st.textContent = "Saved";
    setTimeout(() => (st.textContent = ""), 1500);
  });
})();

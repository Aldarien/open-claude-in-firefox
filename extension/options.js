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

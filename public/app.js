// Progressive enhancement only: every form works without this file.

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const cleanHandle = (v) => v.trim().replace(/^@/, "");

// ----- note field: counter, starter chips, live preview -----
const pvNote = document.querySelector("[data-pv-note]");
for (const ta of document.querySelectorAll("textarea[data-count]")) {
  const form = ta.closest("form");
  const out = form.querySelector(".count");
  const update = () => {
    const left = ta.maxLength - ta.value.length;
    out.textContent = `${left} left`;
    out.classList.toggle("low", left <= 20);
    if (pvNote) pvNote.textContent = ta.value.trim();
  };
  ta.addEventListener("input", update);
  for (const chip of form.querySelectorAll("[data-fill]")) {
    chip.addEventListener("click", () => {
      // Starters only replace an empty note or another starter, never something you typed.
      const starters = [...form.querySelectorAll("[data-fill]")].map((c) => c.dataset.fill);
      if (ta.value.trim() && !starters.includes(ta.value) && !confirm("Replace what you've written?")) return;
      ta.value = chip.dataset.fill;
      update();
      ta.focus();
    });
  }
  update();
}

// ----- handle field: suggestions, "is this the right account" check, preview -----
for (const input of document.querySelectorAll("input[data-suggest]")) {
  const field = input.closest(".field");
  const list = field.querySelector(".suggest");
  const check = field.querySelector("[data-check]");
  const pvTo = document.querySelector("[data-pv-to]");
  const pvHandle = document.querySelector("[data-pv-handle]");
  let timer;
  let seq = 0;

  const hide = () => {
    list.hidden = true;
    list.replaceChildren();
  };

  // Cheap text updates on every keystroke; the avatar lookup only once the handle is settled.
  const reflect = (settled = true) => {
    const h = cleanHandle(input.value);
    const valid = HANDLE.test(h);
    if (pvTo) pvTo.textContent = valid ? `@${h}` : "they";
    if (pvHandle) pvHandle.textContent = valid ? h : "theirhandle";
    if (!valid || !settled) {
      check.hidden = true;
      return;
    }
    const img = document.createElement("img");
    img.src = `/avatar/${h.toLowerCase()}`;
    img.alt = "";
    check.replaceChildren(img, document.createTextNode(`Right person? Check x.com/${h}`));
    check.href = `https://x.com/${h}`;
    check.hidden = false;
  };

  const pick = (handle) => {
    input.value = handle;
    hide();
    reflect();
    document.getElementById("note")?.focus();
  };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = cleanHandle(input.value);
    if (!q) {
      hide();
      reflect();
      return;
    }
    reflect(false);
    timer = setTimeout(async () => {
      const mine = ++seq;
      let rows = [];
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) rows = await res.json();
      } catch {}
      if (mine !== seq) return;
      rows = rows.filter((r) => r.handle.toLowerCase() !== q.toLowerCase());
      if (!rows.length) return hide();
      list.replaceChildren(
        ...rows.map((r) => {
          const li = document.createElement("li");
          const b = document.createElement("button");
          b.type = "button";
          const img = document.createElement("img");
          img.src = `/avatar/${r.handle.toLowerCase()}`;
          img.alt = "";
          const strong = document.createElement("b");
          strong.textContent = r.name || `@${r.handle}`;
          b.append(img, strong);
          if (r.name) {
            const span = document.createElement("span");
            span.textContent = `@${r.handle}`;
            b.append(span);
          }
          b.addEventListener("click", () => pick(r.handle));
          li.append(b);
          return li;
        }),
      );
      list.hidden = false;
    }, 250);
  });
  input.addEventListener("change", () => reflect());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
    if (e.key === "ArrowDown" && !list.hidden) {
      e.preventDefault();
      list.querySelector("button")?.focus();
    }
  });
  list.addEventListener("keydown", (e) => {
    const buttons = [...list.querySelectorAll("button")];
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      buttons[Math.min(i + 1, buttons.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (i <= 0 ? input : buttons[i - 1]).focus();
    } else if (e.key === "Escape") {
      hide();
      input.focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (!field.contains(e.target)) hide();
  });
  if (input.value) reflect();
}

// ----- "Open my page" lookup on the signed-out home page -----
for (const form of document.querySelectorAll("form[data-lookup]")) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const handle = cleanHandle(form.querySelector("input").value);
    if (HANDLE.test(handle)) location.href = `/@${handle}`;
  });
}

// ----- copy buttons -----
for (const btn of document.querySelectorAll("[data-copy]")) {
  btn.addEventListener("click", async () => {
    const label = btn.querySelector("span");
    const original = label.textContent;
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      label.textContent = "Copied";
    } catch {
      label.textContent = btn.dataset.copy;
    }
    setTimeout(() => (label.textContent = original), 1800);
  });
}

// ----- confirmations -----
for (const form of document.querySelectorAll("form[data-confirm]")) {
  form.addEventListener("submit", (e) => {
    if (!confirm(form.dataset.confirm)) e.preventDefault();
  });
}

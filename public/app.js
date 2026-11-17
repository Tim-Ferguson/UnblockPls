// Progressive enhancement only: every form works without this file.

// Character counter on the note field.
for (const ta of document.querySelectorAll("textarea[data-count]")) {
  const out = ta.closest("form").querySelector(".count");
  const update = () => {
    const left = ta.maxLength - ta.value.length;
    out.textContent = left === 1 ? "1 character left" : `${left} characters left`;
  };
  ta.addEventListener("input", update);
  update();
}

// Handle suggestions from accounts Unblock already knows about.
for (const input of document.querySelectorAll("input[data-suggest]")) {
  const list = input.closest("form").querySelector(".suggest");
  let timer;
  let seq = 0;
  const hide = () => {
    list.hidden = true;
    list.replaceChildren();
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim().replace(/^@/, "");
    if (!q) return hide();
    timer = setTimeout(async () => {
      const mine = ++seq;
      let rows = [];
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) rows = await res.json();
      } catch {}
      if (mine !== seq) return;
      if (!rows.length) return hide();
      list.replaceChildren(
        ...rows.map((r) => {
          const li = document.createElement("li");
          const b = document.createElement("button");
          b.type = "button";
          const strong = document.createElement("b");
          strong.textContent = `@${r.handle}`;
          b.append(strong);
          if (r.name) {
            const span = document.createElement("span");
            span.className = "muted";
            span.textContent = r.name;
            b.append(span);
          }
          b.addEventListener("click", () => {
            input.value = r.handle;
            hide();
            document.getElementById("note")?.focus();
          });
          li.append(b);
          return li;
        }),
      );
      list.hidden = false;
    }, 150);
  });
}

// "View page" lookup on the signed-out home page.
for (const form of document.querySelectorAll("form[data-lookup]")) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const handle = form.querySelector("input").value.trim().replace(/^@/, "");
    if (handle) location.href = `/@${encodeURIComponent(handle)}`;
  });
}

for (const form of document.querySelectorAll("form[data-confirm]")) {
  form.addEventListener("submit", (e) => {
    if (!confirm(form.dataset.confirm)) e.preventDefault();
  });
}

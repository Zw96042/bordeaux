  if (!menuButton || !navigation) return;
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.querySelector(".sr-only").textContent = open ? "Close navigation" : "Open navigation";
  navigation.toggleAttribute("data-open", open);
  navigation.inert = mobileNavigation.matches && !open;
};

if (menuButton && navigation) {
  setMenuOpen(false);

  menuButton.addEventListener("click", () => {
    setMenuOpen(menuButton.getAttribute("aria-expanded") !== "true");
  });

  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      setMenuOpen(false);
      menuButton.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-header]") && menuButton.getAttribute("aria-expanded") === "true") {
      setMenuOpen(false);
    }
  });

  mobileNavigation.addEventListener("change", () => setMenuOpen(false));
}

const updateHeader = () => {
  header?.toggleAttribute("data-scrolled", window.scrollY > 20);
};

updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

const chapFrame = document.querySelector("[data-wrlp-chap-frame]");
const chapToggle = document.querySelector("[data-chap-toggle]");

if (chapFrame && window.WrlpChapMarkup) {
  chapFrame.innerHTML = window.WrlpChapMarkup;
  const chap = chapFrame.querySelector("svg");
  let userPaused = false;

  const setChapPaused = (paused) => {
    chap.dataset.paused = String(paused);
    chapToggle?.toggleAttribute("data-paused", paused);
    chapToggle?.setAttribute("aria-label", paused ? "Play Chap animation" : "Pause Chap animation");
  };

  const syncChapMotion = () => {
    if (chapToggle) chapToggle.hidden = reducedMotion.matches;
    setChapPaused(reducedMotion.matches || userPaused);
  };

  chapToggle?.addEventListener("click", () => {
    userPaused = !userPaused;
    syncChapMotion();
  });

  reducedMotion.addEventListener("change", syncChapMotion);
  syncChapMotion();
}

const copyButton = document.querySelector("[data-copy-code]");
const codeSample = document.querySelector("[data-code]");

if (copyButton && codeSample) {
  copyButton.addEventListener("click", async () => {
    const label = copyButton.querySelector("span");
    try {
      await navigator.clipboard.writeText(codeSample.textContent);
      label.textContent = "Copied";
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(codeSample);
      selection?.removeAllRanges();
      selection?.addRange(range);
      label.textContent = selection ? "Selected" : "Copy unavailable";
    }

    window.setTimeout(() => {
      label.textContent = "Copy";
    }, 1600);
  });
}

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = new Date().getFullYear();
});

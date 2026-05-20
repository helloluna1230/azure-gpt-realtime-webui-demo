// Premium UX layer: preloader, reveal, custom cursor, magnetic CTA, orb parallax.
// Pure vanilla, zero dependencies. Degrades on touch / reduced-motion.

const body = document.body;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;

// Entrance class flips reveal opacity/transforms.
requestAnimationFrame(() => body.classList.add("is-ready"));

// Preloader dismiss.
const preloader = document.getElementById("preloader");
if (preloader) {
  const dismiss = () => {
    preloader.classList.add("is-leaving");
    setTimeout(() => preloader.classList.add("is-gone"), reduced ? 0 : 1200);
  };
  if (document.readyState === "complete") {
    setTimeout(dismiss, 240);
  } else {
    window.addEventListener("load", () => setTimeout(dismiss, 200), {
      once: true,
    });
  }
}

if (fine && !reduced) {
  // Ambient orb parallax driven by pointer.
  const ambient = document.querySelector(".ambient");
  if (ambient) {
    let pending = 0;
    window.addEventListener(
      "pointermove",
      (e) => {
        if (pending) return;
        pending = requestAnimationFrame(() => {
          const mx = (e.clientX / window.innerWidth - 0.5) * 2;
          const my = (e.clientY / window.innerHeight - 0.5) * 2;
          ambient.style.setProperty("--mx", mx.toFixed(3));
          ambient.style.setProperty("--my", my.toFixed(3));
          pending = 0;
        });
      },
      { passive: true },
    );
  }

  // Magnetic interactive elements.
  document.querySelectorAll(".magnetic").forEach((el) => {
    const strength = 0.32;
    const reset = () => {
      el.style.setProperty("--mx", "0px");
      el.style.setProperty("--my", "0px");
      el.style.setProperty("--gx", "0px");
      el.style.setProperty("--gy", "0px");
    };
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      el.style.setProperty("--mx", `${dx * strength}px`);
      el.style.setProperty("--my", `${dy * strength}px`);
      el.style.setProperty("--gx", `${dx * 0.6}px`);
      el.style.setProperty("--gy", `${dy * 0.6}px`);
    });
    el.addEventListener("pointerleave", reset);
    el.addEventListener("blur", reset);
  });
}

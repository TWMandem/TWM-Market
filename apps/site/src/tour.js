/**
 * «Камера» по окну приложения: выбранный шаг приближает нужную часть
 * снимка и обводит её. Шаги переключаются прокруткой и нажатием.
 */

// Области на снимках, в пикселях исходных картинок.
const SHOTS = { tour: { w: 1280, h: 1300 }, chat: { w: 1280, h: 820 } };
const STEPS = [
  { shot: "tour", x: 940, y: 350, w: 292, h: 84 }, // цена в сравнении
  { shot: "tour", x: 24, y: 754, w: 864, h: 544 }, // история цены
  { shot: "tour", x: 916, y: 748, w: 340, h: 414 }, // продавец
  { shot: "chat", x: 341, y: 258, w: 915, h: 410 }, // предложение цены
];
const PAD = 14;

export function initTour() {
  const tour = document.querySelector("[data-tour]");
  if (!tour) return;
  const frame = tour.querySelector(".tour-frame");
  const spot = tour.querySelector("[data-spot]");
  const shots = Object.fromEntries([...tour.querySelectorAll("[data-shot]")].map((img) => [img.dataset.shot, img]));
  const steps = [...tour.querySelectorAll("[data-step]")];
  let current = -1;

  function go(index, force = false) {
    if (index === current && !force) return;
    current = index;
    const step = STEPS[index];
    const size = SHOTS[step.shot];
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const base = fw / size.w; // снимок во всю ширину рамки
    // Приближаем так, чтобы область заняла около 70% рамки, но не больше чем вдвое.
    const zoom = Math.max(1, Math.min(2.1, (fw * 0.72) / (step.w * base), (fh * 0.72) / (step.h * base)));
    const scale = base * zoom;
    const cx = (step.x + step.w / 2) * scale;
    const cy = (step.y + step.h / 2) * scale;
    const tx = Math.min(0, Math.max(fw - size.w * scale, fw / 2 - cx));
    const ty = Math.min(0, Math.max(fh - size.h * scale, fh / 2 - cy));

    for (const [name, img] of Object.entries(shots)) {
      if (name === step.shot) {
        img.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
        img.setAttribute("data-active", "");
      } else {
        img.removeAttribute("data-active");
      }
    }
    spot.style.width = `${step.w * scale + PAD * 2}px`;
    spot.style.height = `${step.h * scale + PAD * 2}px`;
    spot.style.transform = `translate(${step.x * scale + tx - PAD}px, ${step.y * scale + ty - PAD}px)`;
    steps.forEach((el, i) => el.setAttribute("aria-current", i === index ? "true" : "false"));
  }

  steps.forEach((el, i) => {
    el.addEventListener("click", () => go(i));
    el.addEventListener("focus", () => go(i));
  });

  // Прокрутка: активен шаг, который проходит через «окно» под снимком
  // (на широком экране — середина, на узком — ниже прилипшего снимка).
  const wide = window.matchMedia("(min-width: 1024px)").matches;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) go(steps.indexOf(entry.target));
      }
    },
    { rootMargin: wide ? "-45% 0px -45% 0px" : "-62% 0px -30% 0px" },
  );
  steps.forEach((el) => observer.observe(el));

  new ResizeObserver(() => go(Math.max(current, 0), true)).observe(frame);
}

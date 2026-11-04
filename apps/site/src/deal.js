/**
 * «Как проходит сделка»: переписка разыгрывается по шагам, этапы слева
 * подсвечиваются вместе с ней. Нажатие на этап показывает переписку
 * до конца этого этапа. Сцена играет один раз, когда появляется на экране.
 */
import { reduced } from "./flaps.js";

// Покупатель — «я» (справа), продавец — собеседник (слева).
const SCRIPT = [
  { stage: 0, kind: "msg", text: "Здравствуйте! Машина ещё продаётся?", who: "me" },
  { stage: 0, kind: "msg", text: "Да, на ходу, полный тюнинг. Могу показать на авторынке.", who: "them" },
  { stage: 1, kind: "offer", who: "me", label: "Предложение цены", price: "17 000 000 ₽", sub: "на 7% ниже цены объявления" },
  { stage: 1, kind: "offer", who: "them", label: "Встречное предложение", price: "17 600 000 ₽", sub: "на 3% ниже цены объявления" },
  { stage: 1, kind: "system", text: "maks принял(а) цену 17 600 000 ₽. Встретьтесь в игре, а после обмена отметьте сделку." },
  { stage: 2, kind: "scene", title: "Встреча в игре", text: "Авторынок «Анашан», сервер RED. Сверили ники, машина перешла к покупателю." },
  { stage: 3, kind: "system", text: "maks отметил(а), что сделка состоялась. Вторая сторона должна подтвердить." },
  { stage: 3, kind: "system", tone: "ok", text: "Сделка подтверждена обеими сторонами: 17 600 000 ₽" },
  { stage: 4, kind: "review", text: "Всё честно, быстро встретились. Рекомендую!", by: "maks" },
];

function render(step) {
  const el = document.createElement("div");
  if (step.kind === "msg") {
    el.className = `deal-msg ${step.who === "me" ? "is-me" : ""}`;
    el.textContent = step.text;
  } else if (step.kind === "offer") {
    el.className = `deal-msg deal-offer ${step.who === "me" ? "is-me" : ""}`;
    el.innerHTML = `<small></small><b></b><span></span>`;
    el.querySelector("small").textContent = step.label;
    el.querySelector("b").textContent = step.price;
    el.querySelector("span").textContent = step.sub;
  } else if (step.kind === "system") {
    el.className = `deal-system ${step.tone === "ok" ? "is-ok" : ""}`;
    el.textContent = step.text;
  } else if (step.kind === "scene") {
    el.className = "deal-scene";
    el.innerHTML = `<b></b><span></span>`;
    el.querySelector("b").textContent = step.title;
    el.querySelector("span").textContent = step.text;
  } else if (step.kind === "review") {
    el.className = "deal-review";
    el.innerHTML = `<span class="deal-thumbs" aria-hidden="true">👍</span><span><small></small><span></span></span>`;
    el.querySelector("small").textContent = `Отзыв от ${step.by}`;
    el.querySelector("span > span").textContent = step.text;
  }
  return el;
}

function typing(who) {
  const el = document.createElement("div");
  el.className = `deal-msg deal-typing ${who === "me" ? "is-me" : ""}`;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = "<i></i><i></i><i></i>";
  return el;
}

export function initDeal() {
  const root = document.querySelector("[data-deal]");
  if (!root) return;
  const log = root.querySelector("[data-deal-log]");
  const stages = [...root.querySelectorAll("[data-stage]")];
  const replay = root.querySelector("[data-deal-replay]");
  let run = 0; // номер запуска: старые таймеры проверяют его и останавливаются

  const mark = (stage, done) => {
    stages.forEach((btn, i) => {
      btn.toggleAttribute("data-current", i === stage);
      btn.toggleAttribute("data-done", i < stage || (done && i === stage));
    });
  };
  const scrollDown = () => log.scrollTo({ top: log.scrollHeight, behavior: reduced() ? "auto" : "smooth" });

  /** Показать всё до конца этапа без анимации. */
  function jump(stage) {
    run += 1;
    log.replaceChildren(...SCRIPT.filter((s) => s.stage <= stage).map(render));
    mark(stage, true);
    log.scrollTop = log.scrollHeight;
  }

  /** Разыграть с начала. */
  async function play() {
    const id = ++run;
    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    log.replaceChildren();
    for (const step of SCRIPT) {
      if (id !== run) return;
      mark(step.stage, false);
      if (step.kind === "msg" || step.kind === "offer") {
        const dots = typing(step.who);
        log.append(dots);
        scrollDown();
        await wait(step.kind === "msg" ? 1100 : 800);
        if (id !== run) return;
        dots.remove();
      } else {
        await wait(650);
        if (id !== run) return;
      }
      const el = render(step);
      el.classList.add("is-new");
      log.append(el);
      scrollDown();
      await wait(step.kind === "scene" ? 1500 : 700);
    }
    if (id === run) mark(SCRIPT[SCRIPT.length - 1].stage, true);
  }

  stages.forEach((btn, i) => btn.addEventListener("click", () => jump(i)));
  replay.addEventListener("click", () => (reduced() ? jump(4) : void play()));

  // До появления на экране — первые реплики, чтобы окно не было пустым.
  jump(0);
  mark(-1, false);
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      if (reduced()) jump(4);
      else void play();
    },
    { threshold: 0.45 },
  );
  observer.observe(root);
}

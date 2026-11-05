import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { OPERATION_LABELS, formatPrice } from "@twm/shared";
import type { AppContext } from "../../context.js";
import { mediaUrl } from "../../lib/media.js";

/**
 * Страница-ссылка на объявление: twm-market.ru/l/ID (nginx сайта передаёт
 * её сюда как /share/l/ID). Discord, VK и Telegram читают из неё заголовок,
 * цену и картинку и показывают карточку. Человек видит краткое описание,
 * кнопку «Открыть в приложении» (twm-market://listing/ID), ссылку на веб-приложение
 * (twm-market.ru/app/ — для iPhone и браузеров) и ссылку на скачивание.
 * Только то, что и так видно всем в каталоге: без логина и контактов.
 */

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const escape = escapeHtml;

const idParam = z.object({ id: z.string().uuid() });

interface ShareRow {
  id: string;
  title: string;
  price: string | null;
  operation: "sell" | "buy" | "exchange";
  description: string;
  quantity: number;
  sectionCode: string;
  serverName: string;
  serverColor: string;
  nickname: string;
  imagePath: string | null;
  iconPath: string | null;
  iconKind: "image" | "video" | null;
}

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0e1014;color:#eceef2;
font:16px/1.55 "Segoe UI",system-ui,-apple-system,sans-serif}
a{color:inherit}
.wrap{width:100%;max-width:560px}
.brand{display:flex;align-items:center;gap:10px;margin:0 0 18px;font-weight:800;text-decoration:none}
.logo{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#ffb224;color:#1a1200;font-size:12px}
.card{overflow:hidden;border:1px solid #2a2f3a;border-radius:22px;background:#161920}
.media{aspect-ratio:16/9;background:#1d212a;display:grid;place-items:center;overflow:hidden}
.media img{width:100%;height:100%;object-fit:cover}
.media img.icon{width:auto;height:auto;max-width:60%;max-height:80%;object-fit:contain}
.body{display:flex;flex-direction:column;gap:12px;padding:22px 24px 24px}
.tags{display:flex;flex-wrap:wrap;gap:8px;font-size:13px;font-weight:700}
.tag{border-radius:8px;padding:3px 9px;background:#1d212a;color:#c9ced8}
.op-sell{background:rgba(255,178,36,.18);color:#ffc75a}.op-buy{background:rgba(108,180,255,.18);color:#8ec5ff}.op-exchange{background:rgba(183,156,255,.18);color:#c9b6ff}
h1{margin:0;font-size:26px;line-height:1.2}
.price{font:700 30px/1.1 Consolas,"Cascadia Mono",monospace;color:#ffc75a}
.meta{display:flex;flex-wrap:wrap;gap:6px 16px;color:#a0a7b4;font-size:14px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:1px}
.nick{font-family:Consolas,"Cascadia Mono",monospace;color:#eceef2}
.desc{margin:0;color:#c9ced8;white-space:pre-line}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
.btn{display:inline-flex;align-items:center;height:48px;padding:0 20px;border-radius:13px;font-weight:800;text-decoration:none}
.primary{background:#ffb224;color:#1a1200}.primary:hover{background:#ffc75a}
.secondary{border:1px solid #2a2f3a}.secondary:hover{border-color:#8b93a1}
.note{margin:4px 0 0;color:#8b93a1;font-size:13px}
`;

function page(site: string, head: string, body: string): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
<meta name="theme-color" content="#0e1014">
<link rel="icon" href="${site}/favicon.svg" type="image/svg+xml">
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<a class="brand" href="${site}/"><span class="logo">TW</span>TWM Market</a>
${body}
</div>
</body>
</html>`;
}

export async function shareRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const sql = ctx.sql;
  const site = ctx.config.SITE_URL;

  app.get("/share/l/:id", async (request, reply) => {
    reply.header("Content-Type", "text/html; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=300");
    const params = idParam.safeParse(request.params);
    const [row] = params.success
      ? await sql<ShareRow[]>`
          SELECT l.id, l.title, l.price, l.operation, l.description, l.quantity, s.code AS section_code,
                 sv.name AS server_name, sv.color AS server_color, gp.nickname,
                 (SELECT i.full_path FROM listing_images i WHERE i.listing_id = l.id
                   ORDER BY i.is_main DESC, i.sort_order, i.created_at LIMIT 1) AS image_path,
                 ci.icon_path, ci.icon_kind
          FROM listings l
          JOIN listing_types t ON t.id = l.listing_type_id
          JOIN sections s ON s.id = t.section_id
          JOIN servers sv ON sv.id = l.server_id
          JOIN game_profiles gp ON gp.id = l.game_profile_id
          JOIN users u ON u.id = l.user_id
          LEFT JOIN catalog_items ci ON ci.id = l.catalog_item_id
          WHERE l.id = ${params.data.id} AND l.status = 'active' AND l.expires_at > now() AND u.status = 'active'`
      : [];

    if (!row) {
      reply.code(404);
      return page(
        site,
        `<title>Объявление снято — TWM Market</title><meta name="robots" content="noindex">`,
        `<main class="card"><div class="body"><h1>Объявление снято или не найдено</h1>
<p class="desc">Возможно, его уже продали. Похожие предложения — в приложении TWM Market.</p>
<div class="actions"><a class="btn primary" href="${site}/">Скачать приложение</a></div></div></main>`,
      );
    }

    const price = row.price === null ? null : Number(row.price);
    const priceText =
      row.operation === "exchange" || price === null ? "Обмен" : row.operation === "buy" ? `до ${formatPrice(price)}` : formatPrice(price);
    const operation = OPERATION_LABELS[row.operation];
    // Картинка: фото объявления или иконка предмета (видео-иконки для карточки не подходят).
    const iconPath = row.iconKind === "image" ? row.iconPath : null;
    const imagePath = row.imagePath ?? iconPath;
    const image = imagePath ? `${site}${mediaUrl(imagePath)}` : `${site}/img/og.jpg`;
    const excerpt = row.description.length > 220 ? `${row.description.slice(0, 217)}…` : row.description;
    const summary = `${operation} на сервере ${row.serverName}. ${excerpt || "Подробности и переписка с продавцом — в приложении TWM Market."}`;
    const url = `${site}/l/${row.id}`;
    const title = `${row.title} — ${priceText}`;

    const head = `<title>${escape(title)} · TWM Market</title>
<meta name="description" content="${escape(summary)}">
<link rel="canonical" href="${escape(url)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="TWM Market">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(summary)}">
<meta property="og:url" content="${escape(url)}">
<meta property="og:image" content="${escape(image)}">
<meta name="twitter:card" content="summary_large_image">`;

    const media = imagePath
      ? `<div class="media"><img${row.imagePath ? "" : ' class="icon"'} src="${escape(`${site}${mediaUrl(imagePath)}`)}" alt="${escape(row.title)}"></div>`
      : "";
    const quantity = row.quantity > 1 && row.sectionCode === "items" ? `<span class="tag">${row.quantity} шт.</span>` : "";

    const body = `<main class="card">
${media}
<div class="body">
<div class="tags"><span class="tag op-${row.operation}">${escape(operation)}</span>${quantity}</div>
<h1>${escape(row.title)}</h1>
<div class="price">${escape(priceText)}</div>
<div class="meta"><span><span class="dot" style="background:${escape(row.serverColor)}"></span>${escape(row.serverName)}</span><span>Продавец <span class="nick">${escape(row.nickname)}</span></span></div>
${excerpt ? `<p class="desc">${escape(excerpt)}</p>` : ""}
<div class="actions">
<a class="btn primary" href="twm-market://listing/${row.id}">Открыть в приложении</a>
<a class="btn secondary" href="${site}/app/#/listing/${row.id}">Открыть в браузере или на iPhone</a>
<a class="btn secondary" href="${site}/">Скачать TWM Market</a>
</div>
<p class="note">Написать продавцу и договориться о цене можно в приложении. Сделка проходит в игре; торговля за реальные деньги запрещена.</p>
</div>
</main>`;
    return page(site, head, body);
  });
}

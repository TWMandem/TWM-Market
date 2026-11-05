import type { IconName } from "../components/Icon";

export type SectionKey = "items" | "cars" | "notary";

export interface SectionInfo {
  key: SectionKey;
  path: string;
  title: string;
  description: string;
  icon: IconName;
  /** Цвет акцента раздела (класс Tailwind для текста). */
  tone: string;
  /** Полупрозрачная подложка иконки. */
  toneBg: string;
}

export const SECTIONS: readonly SectionInfo[] = [
  {
    key: "items",
    path: "/items",
    title: "Рынок предметов",
    description: "Аксессуары и предметы с Центрального рынка и рынка ТЦ «Анашан». Продажа и скупка.",
    icon: "box",
    tone: "text-accent-ink",
    toneBg: "bg-accent/15",
  },
  {
    key: "cars",
    path: "/cars",
    title: "Авторынок",
    description: "Весь транспорт в одном каталоге: продажа через авторынок «Анашан» или нотариальную контору.",
    icon: "car",
    tone: "text-buy",
    toneBg: "bg-buy/15",
  },
  {
    key: "notary",
    path: "/notary",
    title: "Нотариальная контора",
    description: "Дома, квартиры, бизнесы, SIM-карты и семейное имущество. Продажа и обмен с доплатой.",
    icon: "building",
    tone: "text-exchange",
    toneBg: "bg-exchange/15",
  },
];

export function getSection(key: SectionKey): SectionInfo {
  const section = SECTIONS.find((s) => s.key === key);
  if (!section) throw new Error(`Неизвестный раздел: ${key}`);
  return section;
}

/**
 * Игровые серверы Amazing Online на момент запуска.
 *
 * Это только начальные данные для заполнения базы. Рабочий список хранится
 * в базе данных и редактируется в админ-панели: новые серверы, цвета
 * и флаг «открыт для перевода» меняются без правки кода.
 */
export interface GameServerSeed {
  number: number;
  name: string;
  /** Цвет метки сервера в интерфейсе. */
  color: string;
}

export const DEFAULT_SERVERS: readonly GameServerSeed[] = [
  { number: 1, name: "RED", color: "#FF5A5F" },
  { number: 2, name: "YELLOW", color: "#FFD43B" },
  { number: 3, name: "GREEN", color: "#3DDC84" },
  { number: 4, name: "AZURE", color: "#3BC9DB" },
  { number: 5, name: "SILVER", color: "#C0C7D1" },
  { number: 6, name: "ROSE", color: "#FF8FB1" },
  { number: 7, name: "BLACK", color: "#8B93A1" },
  { number: 8, name: "SKY", color: "#74C0FC" },
  { number: 9, name: "TITAN", color: "#B197FC" },
  { number: 10, name: "X", color: "#F1F3F5" },
  { number: 11, name: "FIRE", color: "#FF922B" },
  { number: 12, name: "LIME", color: "#A9E34B" },
  { number: 13, name: "NIGHT", color: "#748FFC" },
];

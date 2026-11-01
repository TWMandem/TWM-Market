/**
 * Безопасная работа с localStorage: если хранилище недоступно,
 * приложение продолжает работать со значениями по умолчанию.
 * Здесь хранятся только удобства вроде выбранного сервера —
 * токены входа будут лежать в хранилище учётных данных Windows.
 */
export function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(`twm:${key}`);
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string): void {
  try {
    window.localStorage.setItem(`twm:${key}`, value);
  } catch {
    // Не страшно: настройка просто не запомнится.
  }
}

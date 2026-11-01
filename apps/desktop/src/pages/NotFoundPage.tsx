import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="m-0 font-display text-[32px] font-bold">Страница не найдена</h1>
      <p className="m-0 text-muted">Возможно, ссылка устарела или объявление удалено.</p>
      <Link to="/" className="font-bold text-accent hover:text-accent-soft">
        На главную →
      </Link>
    </div>
  );
}

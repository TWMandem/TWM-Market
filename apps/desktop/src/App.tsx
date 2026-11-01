import { createHashRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import { ServerProvider } from "./lib/server-context";
import { HomePage } from "./pages/HomePage";
import { SectionPage } from "./pages/SectionPage";
import { NotFoundPage } from "./pages/NotFoundPage";

// Hash-маршруты (#/items) надёжно работают внутри Tauri:
// приложение всегда загружает один index.html.
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "items", element: <SectionPage section="items" /> },
      { path: "cars", element: <SectionPage section="cars" /> },
      { path: "notary", element: <SectionPage section="notary" /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return (
    <ServerProvider>
      <RouterProvider router={router} />
    </ServerProvider>
  );
}

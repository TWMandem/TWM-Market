import { createHashRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { AuthProvider } from "./lib/auth-context";
import { ServerProvider } from "./lib/server-context";
import { HomePage } from "./pages/HomePage";
import { SectionPage } from "./pages/SectionPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { VerifyEmailPage } from "./pages/auth/VerifyEmailPage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { AccountPage } from "./pages/account/AccountPage";

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
      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },
      { path: "forgot-password", element: <ForgotPasswordPage /> },
      {
        path: "verify-email",
        element: (
          <RequireAuth>
            <VerifyEmailPage />
          </RequireAuth>
        ),
      },
      {
        path: "account",
        element: (
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        ),
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return (
    <ServerProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ServerProvider>
  );
}

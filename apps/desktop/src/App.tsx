import { createHashRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { AuthProvider } from "./lib/auth-context";
import { ServerProvider } from "./lib/server-context";
import { UpdatesProvider } from "./lib/updates-context";
import { ChatsPage } from "./pages/chat/ChatsPage";
import { UserPage } from "./pages/user/UserPage";
import { ModerationPage } from "./pages/admin/ModerationPage";
import { StopWordsPage } from "./pages/admin/StopWordsPage";
import { HomePage } from "./pages/HomePage";
import { CatalogPage } from "./pages/catalog/CatalogPage";
import { ListingPage } from "./pages/listing/ListingPage";
import { ListingFormPage } from "./pages/listing/ListingFormPage";
import { MyListingsPage } from "./pages/account/MyListingsPage";
import { FavoritesPage } from "./pages/account/FavoritesPage";
import { SavedSearchesPage } from "./pages/account/SavedSearchesPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { VerifyEmailPage } from "./pages/auth/VerifyEmailPage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { AccountPage } from "./pages/account/AccountPage";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AuditPage } from "./pages/admin/AuditPage";
import { CategoriesPage } from "./pages/admin/CategoriesPage";
import { DashboardPage } from "./pages/admin/DashboardPage";
import { FieldsPage } from "./pages/admin/FieldsPage";
import { ServersPage } from "./pages/admin/ServersPage";
import { StructurePage } from "./pages/admin/StructurePage";
import { UserDetailPage } from "./pages/admin/UserDetailPage";
import { UsersPage } from "./pages/admin/UsersPage";

// Hash-маршруты (#/items) надёжно работают внутри Tauri:
// приложение всегда загружает один index.html.
const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "items", element: <CatalogPage key="items" section="items" /> },
      { path: "cars", element: <CatalogPage key="cars" section="cars" /> },
      { path: "notary", element: <CatalogPage key="notary" section="notary" /> },
      { path: "search", element: <CatalogPage key="search" section="search" /> },
      { path: "listing/:id", element: <ListingPage /> },
      {
        path: "listings/new",
        element: (
          <RequireAuth>
            <ListingFormPage key="new" />
          </RequireAuth>
        ),
      },
      {
        path: "listings/:id/edit",
        element: (
          <RequireAuth>
            <ListingFormPage />
          </RequireAuth>
        ),
      },
      {
        path: "my/listings",
        element: (
          <RequireAuth>
            <MyListingsPage />
          </RequireAuth>
        ),
      },
      {
        path: "my/searches",
        element: (
          <RequireAuth>
            <SavedSearchesPage />
          </RequireAuth>
        ),
      },
      {
        path: "favorites",
        element: (
          <RequireAuth>
            <FavoritesPage />
          </RequireAuth>
        ),
      },
      {
        path: "chats",
        element: (
          <RequireAuth>
            <ChatsPage />
          </RequireAuth>
        ),
      },
      {
        path: "chats/:id",
        element: (
          <RequireAuth>
            <ChatsPage />
          </RequireAuth>
        ),
      },
      { path: "user/:login", element: <UserPage /> },
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
      {
        path: "admin",
        element: (
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "users", element: <UsersPage /> },
          { path: "users/:id", element: <UserDetailPage /> },
          { path: "servers", element: <ServersPage /> },
          { path: "structure", element: <StructurePage /> },
          { path: "categories", element: <CategoriesPage /> },
          { path: "fields", element: <FieldsPage /> },
          { path: "audit", element: <AuditPage /> },
          { path: "moderation", element: <ModerationPage /> },
          { path: "stop-words", element: <StopWordsPage /> },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return (
    <ServerProvider>
      <AuthProvider>
        <UpdatesProvider>
          <RouterProvider router={router} />
        </UpdatesProvider>
      </AuthProvider>
    </ServerProvider>
  );
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthResponseDto, MeDto } from "@twm/shared";
import { api, applyAuth, clearAuth, refreshSession, setSessionEndedHandler } from "./api";

type AuthStatus = "loading" | "guest" | "authed";

interface AuthContextValue {
  status: AuthStatus;
  user: MeDto | null;
  /** Сохраняет ответ сервера после входа, регистрации или сброса пароля. */
  signIn: (auth: AuthResponseDto) => Promise<void>;
  signOut: () => Promise<void>;
  /** Обновить данные пользователя (например, после подтверждения email). */
  setUser: (user: MeDto) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUserState] = useState<MeDto | null>(null);

  const becomeGuest = useCallback(() => {
    setUserState(null);
    setStatus("guest");
  }, []);

  // При запуске пробуем восстановить вход по сохранённому токену.
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((auth) => {
        if (cancelled) return;
        if (auth) {
          setUserState(auth.user);
          setStatus("authed");
        } else {
          becomeGuest();
        }
      })
      .catch(() => {
        // Сервер недоступен: показываем приложение как гостю, токен не трогаем.
        if (!cancelled) becomeGuest();
      });
    return () => {
      cancelled = true;
    };
  }, [becomeGuest]);

  useEffect(() => {
    setSessionEndedHandler(() => {
      void clearAuth();
      becomeGuest();
    });
    return () => setSessionEndedHandler(null);
  }, [becomeGuest]);

  const signIn = useCallback(async (auth: AuthResponseDto) => {
    await applyAuth(auth);
    setUserState(auth.user);
    setStatus("authed");
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Даже если сервер недоступен, на этом устройстве выходим.
    }
    await clearAuth();
    becomeGuest();
  }, [becomeGuest]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signIn, signOut, setUser: setUserState }),
    [status, user, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth должен вызываться внутри AuthProvider");
  return value;
}

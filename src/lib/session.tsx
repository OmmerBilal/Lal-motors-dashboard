"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { mockUsers } from "@/lib/mock/users";
import type { User } from "@/lib/types";

const STORAGE_KEY = "lal-motors:session-user-id";

type SessionContextValue = {
  user: User;
  users: User[];
  setUserId: (id: string) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState(mockUsers[0].id);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && mockUsers.some((u) => u.id === stored)) setUserId(stored);
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    const user = mockUsers.find((u) => u.id === userId) ?? mockUsers[0];
    return {
      user,
      users: mockUsers,
      setUserId: (id: string) => {
        window.localStorage.setItem(STORAGE_KEY, id);
        setUserId(id);
      },
    };
  }, [userId]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

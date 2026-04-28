import { useState, useEffect, useCallback } from "react";
import { API_ENDPOINTS } from "../config/api";

export default function useCurrentUser() {
  const [user, setUser] = useState(null);

  const fetchUser = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setUser(null);
      return null;
    }

    try {
      const response = await fetch(API_ENDPOINTS.currentUser, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Ошибка при получении пользователя");
      const data = await response.json();
      setUser(data);
      return data;
    } catch (err) {
      console.error(err);
      try {
        const raw = localStorage.getItem("user");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            setUser(parsed);
            return null;
          }
        }
      } catch {
        /* ignore */
      }
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return { user, setUser, fetchUser };
}

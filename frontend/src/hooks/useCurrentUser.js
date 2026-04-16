import { useState, useEffect } from "react";
import { API_ENDPOINTS } from "../config/api";

export default function useCurrentUser() {
  const [user, setUser] = useState(null);

  const fetchUser = async () => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setUser(null);
      return;
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
    } catch (err) {
      console.error(err);
      setUser(null);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  return { user, setUser, fetchUser };
}

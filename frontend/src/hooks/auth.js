import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { API_ENDPOINTS } from "../config/api";

export default function useAuth() {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  });

  // ✅ Логин / регистрация
  const authenticateUser = async (url, payload) => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, message: data.detail || JSON.stringify(data) };
      }

      // Сохраняем токены
      localStorage.setItem("access_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);

      // Сохраняем пользователя
      if (data.user) {
        localStorage.setItem("user", JSON.stringify(data.user));
        setUser(data.user); // ✅ обновляем state
      }

      navigate("/lk/dashboard");

      return { success: true };
    } catch (error) {
      console.error("Ошибка аутентификации:", error);
      return { success: false, message: "Произошла ошибка, попробуйте позже" };
    }
  };

  // ✅ Обновление access токена
  const refreshAccessToken = async () => {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) {
      logout();
      return null;
    }

    try {
      const response = await fetch(API_ENDPOINTS.refreshToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: refreshToken }),
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem("access_token", data.access);
        return data.access;
      } else {
        logout();
        return null;
      }
    } catch (error) {
      console.error("Ошибка обновления токена:", error);
      logout();
      return null;
    }
  };

  // ✅ Получение текущего пользователя
  const getCurrentUser = () => user;

  // ✅ Выход из аккаунта
  const logout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    setUser(null); // ✅ очищаем state
    navigate("/login");
  };

  return { authenticateUser, refreshAccessToken, getCurrentUser, logout, user, setUser };
}

import './registration.css';
import { useState } from "react";
import { API_ENDPOINTS } from "../../config/api";

const REGISTER_URL = API_ENDPOINTS.register;
/** Если бэкенд не прислал redirect_url — открываем ЛК (после выдачи JWT при регистрации). */
const DEFAULT_REDIRECT = "/lk";

function formatErrors(data) {
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) return data.detail.join("\n");
  if (typeof data === "object" && data !== null) {
    return Object.entries(data)
      .map(([field, messages]) =>
        Array.isArray(messages)
          ? `${field}: ${messages.join(" ")}`
          : `${field}: ${messages}`
      )
      .join("\n");
  }
  return "Ошибка регистрации";
}

function Registration() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const payload = { email, password };
    if (username.trim()) payload.username = username.trim();

    try {
      const res = await fetch(REGISTER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        if (data.access && data.refresh) {
          localStorage.setItem("access_token", data.access);
          localStorage.setItem("refresh_token", data.refresh);
          if (data.user) {
            localStorage.setItem("user", JSON.stringify(data.user));
          }
        }
        const redirectUrl = data.redirect_url || DEFAULT_REDIRECT;
        window.location.href = redirectUrl.startsWith("http")
          ? redirectUrl
          : `${window.location.origin}${redirectUrl.startsWith("/") ? redirectUrl : "/" + redirectUrl}`;
        return;
      }

      if (res.status === 400) {
        setMessage(formatErrors(data));
        setLoading(false);
        return;
      }

      setMessage(data.detail || "Не удалось зарегистрироваться");
    } catch (err) {
      console.error("Registration error:", err);
      setMessage("Ошибка сети или сервера. Попробуйте позже.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="registration-page">
      <div className="container">
        {message && (
          <div
            className="message"
            style={{
              backgroundColor: message.startsWith("✅") ? "#0d9488" : "#dc2626",
              color: "#fff",
            }}
          >
            {message}
          </div>
        )}

        <div className="circle"></div>
        <h1>Регистрация</h1>
        <h2>Создайте аккаунт</h2>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <input
              type="text"
              id="username"
              name="username"
              placeholder=" "
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <label htmlFor="username">Имя</label>
          </div>
          <div className="form-group">
            <input
              type="email"
              id="email"
              name="email"
              placeholder=" "
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <label htmlFor="email">Email</label>
          </div>
          <div className="form-group">
            <input
              type="password"
              id="password"
              name="password"
              placeholder=" "
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <label htmlFor="password">Пароль</label>
          </div>
          <button type="submit" disabled={loading}>
            {loading ? "Регистрация..." : "Зарегистрироваться"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Registration;

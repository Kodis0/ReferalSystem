import './login.css';
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_ENDPOINTS } from "../../config/api";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(API_ENDPOINTS.token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        // выводим ошибки
        let errorMsg = "";
        if (data.detail) {
          errorMsg = data.detail;
        } else {
          for (const key in data) {
            if (Array.isArray(data[key])) {
              errorMsg += `${key}: ${data[key].join(" ")}\n`;
            } else {
              errorMsg += `${key}: ${data[key]}\n`;
            }
          }
        }
        setMessage(errorMsg);
        setLoading(false);
        return;
      }

      // Сохраняем токены в localStorage (можно sessionStorage)
      localStorage.setItem("access_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);

      setMessage("✅ Вход выполнен!");
      setEmail("");
      setPassword("");

      // Перенаправляем во вкладку «Панель»
      navigate("/lk/dashboard");

    } catch (error) {
      console.error("Ошибка при логине:", error);
      setMessage("Произошла ошибка, попробуйте позже");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="container">
        {message && (
          <div style={{
            marginBottom: "20px",
            padding: "10px",
            borderRadius: "5px",
            backgroundColor: message.startsWith("✅") ? "#4caf50" : "#f44336",
            color: "white",
            fontWeight: "bold",
            whiteSpace: "pre-line",
            textAlign: "center"
          }}>
            {message}
          </div>
        )}
        <div className="circle"></div>

        <h1>Вход</h1>
        <h2>Введите данные для входа</h2>

        <form onSubmit={handleSubmit}>
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
            {loading ? "Вход..." : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;

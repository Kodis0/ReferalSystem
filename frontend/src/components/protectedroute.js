import React from "react";
import { Navigate } from "react-router-dom";

function isTokenExpired(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    // exp — время в секундах с 1970 года
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

const ProtectedRoute = ({ children }) => {
  const accessToken = localStorage.getItem("access_token");
 
  if (!accessToken || isTokenExpired(accessToken)) {
    // Если токена нет или он истёк — редирект на страницу логинаs
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

export const API_ENDPOINTS = {
  register: `${API_BASE}/users/register/`,
  token: `${API_BASE}/users/token/`,
  refreshToken: `${API_BASE}/users/token/refresh/`,
  currentUser: `${API_BASE}/users/me/`,
  referralCapture: `${API_BASE}/referrals/capture/`,
  partnerOnboard: `${API_BASE}/referrals/partner/onboard/`,
  partnerMe: `${API_BASE}/referrals/partner/me/`,
};

export { API_BASE };

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

export const API_ENDPOINTS = {
  register: `${API_BASE}/users/register/`,
  siteCtaJoin: `${API_BASE}/users/site/join/`,
  token: `${API_BASE}/users/token/`,
  refreshToken: `${API_BASE}/users/token/refresh/`,
  currentUser: `${API_BASE}/users/me/`,
  myPrograms: `${API_BASE}/users/me/programs/`,
  myProgramDetail: (sitePublicId) => `${API_BASE}/users/me/programs/${encodeURIComponent(sitePublicId)}/`,
  referralCapture: `${API_BASE}/referrals/capture/`,
  partnerOnboard: `${API_BASE}/referrals/partner/onboard/`,
  partnerMe: `${API_BASE}/referrals/partner/me/`,
  siteBootstrap: `${API_BASE}/referrals/site/bootstrap/`,
  siteCreate: `${API_BASE}/referrals/site/create/`,
  siteIntegration: `${API_BASE}/referrals/site/integration/`,
  siteIntegrationDiagnostics: `${API_BASE}/referrals/site/integration/diagnostics/`,
  siteIntegrationMembers: `${API_BASE}/referrals/site/integration/members/`,
  siteIntegrationVerify: `${API_BASE}/referrals/site/integration/verify/`,
  siteIntegrationActivate: `${API_BASE}/referrals/site/integration/activate/`,
};

export { API_BASE };

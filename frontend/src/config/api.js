/**
 * База URL для fetch к Django API.
 * В `npm start` (NODE_ENV=development) используем пустую строку: запросы идут на тот же origin,
 * что и SPA, а `package.json` → `"proxy"` пересылает их на бэкенд — без CORS и без привязки к списку origins в Django.
 * Production-сборка задаёт `REACT_APP_API_URL` при `npm run build` (см. deploy/deploy.sh).
 */
function resolveApiBase() {
  if (process.env.NODE_ENV === "development") {
    return "";
  }
  const explicit = process.env.REACT_APP_API_URL;
  if (explicit != null && String(explicit).trim() !== "") {
    return String(explicit).replace(/\/$/, "");
  }
  return "http://localhost:8000";
}

const API_BASE = resolveApiBase();

export const API_ENDPOINTS = {
  platformServiceStatus: `${API_BASE}/referrals/platform-service-status/`,
  register: `${API_BASE}/users/register/`,
  siteCtaJoin: `${API_BASE}/users/site/join/`,
  siteCtaLeave: `${API_BASE}/users/site/leave/`,
  token: `${API_BASE}/users/token/`,
  tokenGoogle: `${API_BASE}/users/token/google/`,
  tokenVkStart: `${API_BASE}/users/token/vk/start/`,
  tokenTelegramStart: `${API_BASE}/users/token/telegram/start/`,
  tokenTelegramWidget: `${API_BASE}/users/token/telegram/widget/`,
  tokenPasskeyLoginOptions: `${API_BASE}/users/token/passkey/login/options/`,
  tokenPasskeyLoginVerify: `${API_BASE}/users/token/passkey/login/verify/`,
  passkeysRegisterOptions: `${API_BASE}/users/me/passkeys/register/options/`,
  passkeysRegisterVerify: `${API_BASE}/users/me/passkeys/register/verify/`,
  passkeysList: `${API_BASE}/users/me/passkeys/`,
  passkeyDetail: (credentialId) =>
    `${API_BASE}/users/me/passkeys/${encodeURIComponent(credentialId)}/`,
  refreshToken: `${API_BASE}/users/token/refresh/`,
  currentUser: `${API_BASE}/users/me/`,
  /** Дополнительные пользователи аккаунта (учётные записи с привязкой к владельцу). */
  accountUsers: `${API_BASE}/users/me/account-users/`,
  changePassword: `${API_BASE}/users/me/password/`,
  oauthUnlink: `${API_BASE}/users/me/oauth/unlink/`,
  supportTickets: `${API_BASE}/users/me/support-tickets/`,
  supportTicketDetail: (ticketId) =>
    `${API_BASE}/users/me/support-tickets/${encodeURIComponent(ticketId)}/`,
  /** GET с заголовком Authorization: Bearer — отдаёт байты вложения (аудио для плеера в ЛК). */
  supportTicketAttachment: (ticketId, fileName) =>
    `${API_BASE}/users/me/support-tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(fileName)}/`,
  programsCatalog: `${API_BASE}/users/programs/`,
  programDetail: (sitePublicId) => `${API_BASE}/users/programs/${encodeURIComponent(sitePublicId)}/`,
  myPrograms: `${API_BASE}/users/me/programs/`,
  myProgramDetail: (sitePublicId) => `${API_BASE}/users/me/programs/${encodeURIComponent(sitePublicId)}/`,
  referralCapture: `${API_BASE}/referrals/capture/`,
  partnerOnboard: `${API_BASE}/referrals/partner/onboard/`,
  partnerMe: `${API_BASE}/referrals/partner/me/`,
  siteBootstrap: `${API_BASE}/referrals/site/bootstrap/`,
  siteCreate: `${API_BASE}/referrals/site/create/`,
  projectCreate: `${API_BASE}/referrals/project/create/`,
  projectDetail: (projectId) => `${API_BASE}/referrals/project/${encodeURIComponent(projectId)}/`,
  siteOwnerSites: `${API_BASE}/referrals/site/owner-sites/`,
  sitePageScan: `${API_BASE}/referrals/site/page-scan/`,
  // Same path, different methods: backend `ProjectSiteOwnerCreateView` (referrals/views.py).
  // POST = create child Site in project. DELETE = remove Site; requires `site_public_id` in query or JSON body (`_requested_site_public_id`).
  projectSiteCreate: (projectId) => `${API_BASE}/referrals/project/${encodeURIComponent(projectId)}/site/create/`,
  projectSiteDelete: (projectId) => `${API_BASE}/referrals/project/${encodeURIComponent(projectId)}/site/create/`,
  siteIntegration: `${API_BASE}/referrals/site/integration/`,
  siteIntegrationDiagnostics: `${API_BASE}/referrals/site/integration/diagnostics/`,
  siteIntegrationAnalytics: `${API_BASE}/referrals/site/integration/analytics/`,
  siteIntegrationMembers: `${API_BASE}/referrals/site/integration/members/`,
  siteIntegrationVerify: `${API_BASE}/referrals/site/integration/verify/`,
  siteIntegrationActivate: `${API_BASE}/referrals/site/integration/activate/`,
  siteReachability: `${API_BASE}/referrals/site/reachability/`,
  siteIntegrationActivity: `${API_BASE}/referrals/site/integration/activity/`,
  /** Журнал действий аккаунта (проекты, сайты, интеграция). */
  accountOwnerActivity: `${API_BASE}/referrals/account/activity/`,
  gamificationSummary: `${API_BASE}/referrals/gamification/summary/`,
  gamificationDailyChallengeStart: `${API_BASE}/referrals/gamification/daily-challenge/start/`,
  gamificationDailyChallengeFinish: `${API_BASE}/referrals/gamification/daily-challenge/finish/`,
  gamificationDailyChallengeLeaderboard: `${API_BASE}/referrals/gamification/daily-challenge/leaderboard/`,
  /** GET ?period=week|month|all — рейтинг рефералов по подтверждённым продажам */
  gamificationReferralLeaderboard: `${API_BASE}/referrals/gamification/leaderboard/`,
};

export { API_BASE };

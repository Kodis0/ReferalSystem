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
  passwordResetCaptcha: `${API_BASE}/users/password-reset/captcha/`,
  /** Legacy: ссылка по uid/token в письме (если используется отдельно). */
  passwordResetRequest: `${API_BASE}/users/password-reset/request/`,
  passwordResetCodeRequest: `${API_BASE}/users/api/password-reset/request/`,
  passwordResetCodeVerify: `${API_BASE}/users/api/password-reset/verify-code/`,
  passwordResetCodeConfirm: `${API_BASE}/users/api/password-reset/confirm/`,
  /** GET — список достижений и сводка для ЛК (Bearer). */
  usersAchievements: `${API_BASE}/users/api/achievements/`,
  passkeysRegisterOptions: `${API_BASE}/users/me/passkeys/register/options/`,
  passkeysRegisterVerify: `${API_BASE}/users/me/passkeys/register/verify/`,
  passkeysList: `${API_BASE}/users/me/passkeys/`,
  passkeyDetail: (credentialId) =>
    `${API_BASE}/users/me/passkeys/${encodeURIComponent(credentialId)}/`,
  refreshToken: `${API_BASE}/users/token/refresh/`,
  currentUser: `${API_BASE}/users/me/`,
  /** Дополнительные пользователи аккаунта (учётные записи с привязкой к владельцу). */
  accountUsers: `${API_BASE}/users/me/account-users/`,
  /** Админ-кабинет: список пользователей (read-only, требует is_staff). */
  adminUsersList: `${API_BASE}/users/admin/users/`,
  /** Админ-кабинет: детали пользователя по числовому PK (read-only, требует is_staff). */
  adminUserDetail: (userId) =>
    `${API_BASE}/users/admin/users/${encodeURIComponent(userId)}/`,
  /** Админ-кабинет: блок/разблок пользователя — POST `{is_active: bool}`, требует fresh AdminSession. */
  adminUserSetActive: (userId) =>
    `${API_BASE}/users/admin/users/${encodeURIComponent(userId)}/active/`,
  /** Админ-кабинет: список партнёрских профилей (read-only, требует fresh AdminSession). */
  adminPartnersList: `${API_BASE}/referrals/admin/partners/`,
  /** Админ-кабинет: детали партнёра по числовому PK (read-only). */
  adminPartnerDetail: (partnerId) =>
    `${API_BASE}/referrals/admin/partners/${encodeURIComponent(partnerId)}/`,
  /** Админ-кабинет: смена статуса партнёра — PATCH `{status: "pending"|"active"|"blocked"}`. */
  adminPartnerSetStatus: (partnerId) =>
    `${API_BASE}/referrals/admin/partners/${encodeURIComponent(partnerId)}/status/`,
  /** Админ-кабинет: список Project (read-only, требует fresh AdminSession). */
  adminProjectsList: `${API_BASE}/referrals/admin/projects/`,
  /** Админ-кабинет: детали Project по числовому PK (read-only). */
  adminProjectDetail: (projectId) =>
    `${API_BASE}/referrals/admin/projects/${encodeURIComponent(projectId)}/`,
  /** Админ-кабинет: список Site (включая archived, через `Site.all_objects`). */
  adminSitesList: `${API_BASE}/referrals/admin/sites/`,
  /** Админ-кабинет: детали Site по числовому PK (включая archived). */
  adminSiteDetail: (siteId) =>
    `${API_BASE}/referrals/admin/sites/${encodeURIComponent(siteId)}/`,
  /** Админ-кабинет: список Order (read-only, требует fresh AdminSession). */
  adminOrdersList: `${API_BASE}/referrals/admin/orders/`,
  /** Админ-кабинет: детали Order по числовому PK (read-only, включая raw_payload). */
  adminOrderDetail: (orderId) =>
    `${API_BASE}/referrals/admin/orders/${encodeURIComponent(orderId)}/`,
  /** Админ-кабинет: список Commission (read-only, требует fresh AdminSession). */
  adminCommissionsList: `${API_BASE}/referrals/admin/commissions/`,
  /** Админ-кабинет: детали Commission по числовому PK (read-only). */
  adminCommissionDetail: (commissionId) =>
    `${API_BASE}/referrals/admin/commissions/${encodeURIComponent(commissionId)}/`,
  /** Админ-кабинет: список ReferralLeadEvent (read-only, требует fresh AdminSession). */
  adminLeadEventsList: `${API_BASE}/referrals/admin/lead-events/`,
  /** Админ-кабинет: детали ReferralLeadEvent по числовому PK (read-only, включая raw_payload). */
  adminLeadEventDetail: (leadEventId) =>
    `${API_BASE}/referrals/admin/lead-events/${encodeURIComponent(leadEventId)}/`,
  /** Админ-кабинет: список PublicLeadIngestAudit (read-only, требует fresh AdminSession). */
  adminIngestAuditsList: `${API_BASE}/referrals/admin/ingest-audits/`,
  /** Админ-кабинет: детали PublicLeadIngestAudit по числовому PK (read-only). */
  adminIngestAuditDetail: (auditId) =>
    `${API_BASE}/referrals/admin/ingest-audits/${encodeURIComponent(auditId)}/`,
  /** Админ-кабинет: журнал действий админа (read-only, требует fresh AdminSession). */
  adminActionAuditsList: `${API_BASE}/users/admin/action-audits/`,
  /** Админ-кабинет: детали записи журнала по числовому PK (read-only). */
  adminActionAuditDetail: (auditId) =>
    `${API_BASE}/users/admin/action-audits/${encodeURIComponent(auditId)}/`,
  /** Админ-кабинет: список обращений в поддержку (read-only, требует fresh AdminSession). */
  adminSupportTicketsList: `${API_BASE}/users/admin/support-tickets/`,
  /** Админ-кабинет: детали обращения в поддержку (GET, требует fresh AdminSession). */
  adminSupportTicketDetail: (ticketId) =>
    `${API_BASE}/users/admin/support-tickets/${encodeURIComponent(ticketId)}/`,
  /** Админ-кабинет: закрыть/открыть обращение — PATCH `{is_closed: bool}` (тот же URL, что и detail). */
  adminSupportTicketUpdate: (ticketId) =>
    `${API_BASE}/users/admin/support-tickets/${encodeURIComponent(ticketId)}/`,
  /** Админ step-up сессия: текущее состояние elevation (GET). */
  adminSession: `${API_BASE}/users/admin/session/`,
  /** Админ step-up сессия: dev-confirm (POST), доступен только при DEBUG=True. */
  adminSessionDevConfirm: `${API_BASE}/users/admin/session/dev-confirm/`,
  /** Админ step-up сессия: revoke активных elevated сессий (POST). */
  adminSessionRevoke: `${API_BASE}/users/admin/session/revoke/`,
  /** Telegram MFA: запрос 6-значного кода в Telegram (POST). */
  adminTelegramMfaChallenge: `${API_BASE}/users/admin/mfa/telegram/challenge/`,
  /** Telegram MFA: проверка введённого кода и elevation (POST). */
  adminTelegramMfaVerify: `${API_BASE}/users/admin/mfa/telegram/verify/`,
  /** Telegram MFA bind: запросить t.me/<bot>?start=<token>-ссылку для привязки/перепривязки (POST). */
  adminTelegramBindStart: `${API_BASE}/users/admin/mfa/telegram/bind/start/`,
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
  programBudgetBalance: `${API_BASE}/referrals/partner/balance/program-budget/`,
  programBudgetTopUp: `${API_BASE}/referrals/partner/balance/program-budget/topup/`,
  programBudgetTransactions: `${API_BASE}/referrals/partner/balance/program-budget/transactions/`,
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
  gamificationShop: `${API_BASE}/referrals/gamification/shop/`,
  gamificationShopRedeem: `${API_BASE}/referrals/gamification/shop/redeem/`,
  gamificationShopSelectFrame: `${API_BASE}/referrals/gamification/shop/select-frame/`,
};

export { API_BASE };

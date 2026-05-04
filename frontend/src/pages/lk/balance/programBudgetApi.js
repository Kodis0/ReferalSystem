import { API_ENDPOINTS } from "../../../config/api";

export const PROGRAM_BUDGET_UPDATED_EVENT = "lk-program-budget-updated";

const DEFAULT_PROGRAM_BUDGET = {
  availableAmount: 0,
  holdAmount: 0,
  currency: "RUB",
  minimumActivationAmount: 1000,
  isProgramActive: false,
};

function toNumber(value, fallback = 0) {
  const numberValue = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeProgramBudgetBalance(raw = {}) {
  const availableAmount = Math.max(0, toNumber(raw.availableAmount, DEFAULT_PROGRAM_BUDGET.availableAmount));
  const minimumActivationAmount = Math.max(
    0,
    toNumber(raw.minimumActivationAmount, DEFAULT_PROGRAM_BUDGET.minimumActivationAmount),
  );

  return {
    availableAmount,
    holdAmount: Math.max(0, toNumber(raw.holdAmount, DEFAULT_PROGRAM_BUDGET.holdAmount)),
    currency: typeof raw.currency === "string" && raw.currency.trim() ? raw.currency.trim() : DEFAULT_PROGRAM_BUDGET.currency,
    minimumActivationAmount,
    isProgramActive: availableAmount >= minimumActivationAmount,
  };
}

function authHeaders() {
  const token = localStorage.getItem("access_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseApiResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.detail || fallbackMessage);
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function formatProgramBudgetMoney(raw, currency = "RUB") {
  const value = toNumber(raw);
  const suffix = currency === "RUB" ? "₽" : currency;
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ${suffix}`;
}

export async function fetchProgramBudgetBalance() {
  const response = await fetch(API_ENDPOINTS.programBudgetBalance, {
    method: "GET",
    headers: authHeaders(),
    credentials: "include",
  });
  const payload = await parseApiResponse(response, "Не удалось загрузить бюджет программы");
  return normalizeProgramBudgetBalance(payload);
}

export async function fetchProgramBudgetTransactions() {
  const response = await fetch(API_ENDPOINTS.programBudgetTransactions, {
    method: "GET",
    headers: authHeaders(),
    credentials: "include",
  });
  const payload = await parseApiResponse(response, "Не удалось загрузить историю пополнений");
  return Array.isArray(payload?.transactions) ? payload.transactions : [];
}

export async function topUpProgramBudget(payload) {
  const amount = Math.max(0, toNumber(payload?.amount));
  if (amount <= 0) {
    throw new Error("Введите сумму пополнения");
  }

  const response = await fetch(API_ENDPOINTS.programBudgetTopUp, {
    method: "POST",
    headers: authHeaders(),
    credentials: "include",
    body: JSON.stringify({
      amount,
      paymentMethod: "bank_card",
    }),
  });
  const result = await parseApiResponse(response, "Не удалось создать заявку на пополнение");
  const nextBalance = normalizeProgramBudgetBalance(result?.balance);

  window.dispatchEvent(new CustomEvent(PROGRAM_BUDGET_UPDATED_EVENT, { detail: nextBalance }));

  return {
    balance: nextBalance,
    topup: result?.topup || null,
    paymentUrl: result?.paymentUrl || "",
    code: result?.code || "",
    detail: result?.detail || "",
  };
}

/**
 * Подготовка опций WebAuthn для браузера и сериализация credential для Django (py_webauthn).
 */

function base64URLStringToBuffer(base64URLString) {
  const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToBase64URLString(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** CredentialDescriptor из JSON сервера → для navigator.credentials.get */
export function preparePublicKeyCredentialRequestOptions(options) {
  if (!options || typeof options !== "object") return null;
  const allowCredentials = (options.allowCredentials || []).map((d) => ({
    type: d.type || "public-key",
    id: base64URLStringToBuffer(d.id),
    transports: d.transports,
  }));
  return {
    challenge: base64URLStringToBuffer(options.challenge),
    timeout: options.timeout,
    rpId: options.rpId,
    allowCredentials: allowCredentials.length ? allowCredentials : undefined,
    userVerification: options.userVerification,
    extensions: options.extensions,
  };
}

/** PublicKeyCredentialCreationOptions из JSON сервера → для navigator.credentials.create */
export function preparePublicKeyCredentialCreationOptions(options) {
  if (!options || typeof options !== "object") return null;
  const excludeCredentials = (options.excludeCredentials || []).map((d) => ({
    type: d.type || "public-key",
    id: base64URLStringToBuffer(d.id),
    transports: d.transports,
  }));
  const user = options.user
    ? {
        ...options.user,
        id: base64URLStringToBuffer(options.user.id),
      }
    : undefined;
  return {
    rp: options.rp,
    user,
    challenge: base64URLStringToBuffer(options.challenge),
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    excludeCredentials: excludeCredentials.length ? excludeCredentials : undefined,
    authenticatorSelection: options.authenticatorSelection,
    attestation: options.attestation,
    hints: options.hints,
    extensions: options.extensions,
  };
}

/** Ответ аутентификации → JSON для POST на бэкенд */
export function authenticationCredentialToJSON(credential) {
  if (!credential || !credential.response) return null;
  const response = credential.response;
  return {
    id: bufferToBase64URLString(credential.rawId),
    rawId: bufferToBase64URLString(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: bufferToBase64URLString(response.authenticatorData),
      clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      signature: bufferToBase64URLString(response.signature),
      userHandle: response.userHandle && response.userHandle.byteLength ? bufferToBase64URLString(response.userHandle) : null,
    },
    authenticatorAttachment: credential.authenticatorAttachment ?? null,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

/** Ответ регистрации → JSON для POST на бэкенд */
export function registrationCredentialToJSON(credential) {
  if (!credential || !credential.response) return null;
  const response = credential.response;
  const transports = typeof response.getTransports === "function" ? response.getTransports() : [];
  return {
    json: {
      id: bufferToBase64URLString(credential.rawId),
      rawId: bufferToBase64URLString(credential.rawId),
      type: credential.type,
      response: {
        attestationObject: bufferToBase64URLString(response.attestationObject),
        clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      },
      authenticatorAttachment: credential.authenticatorAttachment ?? null,
      clientExtensionResults: credential.getClientExtensionResults(),
    },
    transports: Array.isArray(transports) ? transports : [],
  };
}

export function webAuthnSupported() {
  return typeof window !== "undefined" && window.PublicKeyCredential !== undefined;
}

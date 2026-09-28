// =========================================================
// Asiento Libre — Lógica de Autenticación (Login, Sign-Up & Verificación)
// =========================================================

import { setActiveUser } from "../../components/header/header";
import { authService } from "../../../core/services/auth.service";
import type { AuthUser } from "../../../core/services/auth.service";
import { escapeHtml } from "../../../core/dom";

interface VehicleData {
  brand: string;
  model: string;
  color: string;
  plate: string;
  capacity: number;
  documents: File[];
}

interface UserSignUp {
  firstName: string;
  lastName: string;
  nationalId: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: 'pasajero' | 'conductor';
  skipVehicle: boolean;
  vehicle?: VehicleData;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let uploadedDocuments: File[] = [];
let resendCooldownTimer: ReturnType<typeof setInterval> | undefined;

// ---- Utilidades DOM Seguras ----
function $<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function showToast(message: string): void {
  const toast = $<HTMLDivElement>("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function showError(message: string): void {
  const errorBox = $<HTMLDivElement>("#form-error");
  const errorMsg = $<HTMLSpanElement>("#error-message");
  if (errorMsg) errorMsg.textContent = message;
  if (errorBox) {
    errorBox.hidden = false;
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function hideError(): void {
  const errorBox = $<HTMLDivElement>("#form-error");
  if (errorBox) errorBox.hidden = true;
}

// ====================================================================
// PANTALLA DE VERIFICACIÓN DE CORREO
// ====================================================================

/**
 * Muestra la pantalla de "Correo en verificación" y oculta los formularios.
 * El usuario no puede acceder a ninguna funcionalidad hasta verificar.
 */
export function showVerificationPending(user: AuthUser): void {
  // Guardar datos del usuario en session storage (sin token de acceso, no está activo)
  sessionStorage.setItem('pending_verification_user', JSON.stringify(user));

  const authCard = $<HTMLDivElement>(".auth-card");
  if (!authCard) return;

  authCard.innerHTML = `
    <div class="verification-pending" id="verification-pending-screen">
      <!-- Icono animado -->
      <div class="verification-icon-wrapper" aria-hidden="true">
        <div class="verification-icon-circle">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6"/>
            <path d="M21 8H3"/>
            <path d="m7 8 5-5 5 5"/>
          </svg>
        </div>
        <div class="verification-pulse" aria-hidden="true"></div>
      </div>

      <h1 class="verification-title">Verifica tu correo</h1>
      <p class="verification-subtitle">
        ¡Ya casi, <strong>${escapeHtml(user.firstName)}</strong>! Hemos enviado un enlace de activación a:
      </p>
      <div class="verification-email-chip" id="verification-email-display">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <polyline points="22,6 12,13 2,6"/>
        </svg>
        <span>${escapeHtml(user.email)}</span>
      </div>

      <p class="verification-hint">
        Revisa tu carpeta de <strong>bandeja de entrada</strong> y también <strong>spam</strong>. El enlace es válido por <strong>24 horas</strong>.
      </p>

      <!-- Botón principal: Reenviar correo -->
      <button
        class="btn-verify-primary"
        id="btn-resend-verification"
        type="button"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 .49-4.42"/>
        </svg>
        <span id="resend-btn-text">Reenviar correo de verificación</span>
      </button>

      <!-- Separador -->
      <div class="verification-divider">
        <span>¿Te equivocaste al escribir el correo?</span>
      </div>

      <!-- Botón: Cambiar correo -->
      <button
        class="btn-verify-secondary"
        id="btn-change-email"
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        Cambiar correo electrónico
      </button>

      <!-- Formulario de cambio de correo (oculto por defecto) -->
      <div class="change-email-form" id="change-email-form" hidden>
        <div class="field">
          <label for="new-email-input">Nuevo correo electrónico</label>
          <div class="input-container">
            <input
              id="new-email-input"
              type="email"
              placeholder="nuevo@correo.com"
              autocomplete="email"
            />
          </div>
        </div>
        <div class="field">
          <label for="change-email-password">Confirma tu contraseña</label>
          <div class="input-container">
            <input id="change-email-password" type="password" autocomplete="current-password" />
          </div>
        </div>
        <div class="change-email-actions">
          <button class="btn-verify-confirm" id="btn-confirm-change-email" type="button">Confirmar cambio</button>
          <button class="btn-verify-cancel" id="btn-cancel-change-email" type="button">Cancelar</button>
        </div>
        <div class="change-email-error" id="change-email-error" hidden></div>
      </div>

      <!-- Separador -->
      <div class="verification-divider"></div>

      <!-- Cerrar sesión -->
      <button class="btn-verify-logout" id="btn-verification-logout" type="button">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Volver al inicio / Cerrar sesión
      </button>
    </div>
  `;

  bindVerificationScreen(user);
}

function bindVerificationScreen(user: AuthUser): void {
  // Reenviar verificación
  const resendBtn = $<HTMLButtonElement>("#btn-resend-verification");
  if (resendBtn) {
    resendBtn.addEventListener("click", async () => {
      await handleResendVerification(user.email, resendBtn);
    });
  }

  // Toggle formulario de cambio de correo
  const changeEmailBtn = $<HTMLButtonElement>("#btn-change-email");
  const changeEmailForm = $<HTMLDivElement>("#change-email-form");
  const cancelChangeBtn = $<HTMLButtonElement>("#btn-cancel-change-email");
  const confirmChangeBtn = $<HTMLButtonElement>("#btn-confirm-change-email");

  if (changeEmailBtn && changeEmailForm) {
    changeEmailBtn.addEventListener("click", () => {
      changeEmailForm.hidden = !changeEmailForm.hidden;
      if (!changeEmailForm.hidden) {
        $<HTMLInputElement>("#new-email-input")?.focus();
        changeEmailBtn.style.display = "none";
      }
    });
  }

  if (cancelChangeBtn && changeEmailForm) {
    cancelChangeBtn.addEventListener("click", () => {
      changeEmailForm.hidden = true;
      if (changeEmailBtn) changeEmailBtn.style.display = "";
      const errorEl = $<HTMLDivElement>("#change-email-error");
      if (errorEl) errorEl.hidden = true;
    });
  }

  if (confirmChangeBtn) {
    confirmChangeBtn.addEventListener("click", async () => {
      await handleChangeEmail(user);
    });
  }

  // Cerrar sesión / volver
  const logoutBtn = $<HTMLButtonElement>("#btn-verification-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      sessionStorage.removeItem('pending_verification_user');
      localStorage.removeItem('asiento_libre_token');
      localStorage.removeItem('asiento_libre_user');
      window.location.href = "/login.html";
    });
  }
}

async function handleResendVerification(email: string, btn: HTMLButtonElement): Promise<void> {
  const btnText = $<HTMLSpanElement>("#resend-btn-text");
  const originalText = btnText?.textContent || "Reenviar correo de verificación";

  btn.disabled = true;
  if (btnText) {
    btnText.textContent = "Enviando...";
  }

  try {
    const result = await authService.resendVerification(email);
    showToast(result.message || "Correo de verificación reenviado.");

    // Cooldown de 60 segundos para evitar spam
    let seconds = 60;
    clearInterval(resendCooldownTimer);
    resendCooldownTimer = setInterval(() => {
      seconds--;
      if (btnText) {
        btnText.textContent = `Reenviar en ${seconds}s`;
      }
      if (seconds <= 0) {
        clearInterval(resendCooldownTimer);
        btn.disabled = false;
        if (btnText) btnText.textContent = originalText;
      }
    }, 1000);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error al reenviar el correo.";
    showToast(msg);
    btn.disabled = false;
    if (btnText) btnText.textContent = originalText;
  }
}

async function handleChangeEmail(user: AuthUser): Promise<void> {
  const newEmailInput = $<HTMLInputElement>("#new-email-input");
  const passwordInput = $<HTMLInputElement>("#change-email-password");
  const errorEl = $<HTMLDivElement>("#change-email-error");
  const confirmBtn = $<HTMLButtonElement>("#btn-confirm-change-email");

  if (!newEmailInput || !passwordInput) return;

  const newEmail = newEmailInput.value.trim();
  const password = passwordInput.value;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!newEmail || !emailRegex.test(newEmail)) {
    if (errorEl) {
      errorEl.textContent = "Por favor ingresa un correo electrónico válido.";
      errorEl.hidden = false;
    }
    return;
  }

  if (newEmail.toLowerCase() === user.email.toLowerCase()) {
    if (errorEl) {
      errorEl.textContent = "El nuevo correo debe ser diferente al actual.";
      errorEl.hidden = false;
    }
    return;
  }
  if (password.length < 6) {
    if (errorEl) {
      errorEl.textContent = "Ingresa la contraseña actual de la cuenta.";
      errorEl.hidden = false;
    }
    return;
  }

  if (errorEl) errorEl.hidden = true;
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Cambiando...";
  }

  try {
    const result = await authService.changeUnverifiedEmail(user.email, newEmail, password);
    showToast(result.message || "Correo actualizado. Revisa tu nueva bandeja de entrada.");

    // Actualizar la UI con el nuevo correo
    user.email = newEmail;
    sessionStorage.setItem('pending_verification_user', JSON.stringify(user));

    const emailDisplay = $<HTMLSpanElement>("#verification-email-display span");
    if (emailDisplay) emailDisplay.textContent = newEmail;

    const changeEmailForm = $<HTMLDivElement>("#change-email-form");
    const changeEmailBtn = $<HTMLButtonElement>("#btn-change-email");
    if (changeEmailForm) changeEmailForm.hidden = true;
    if (changeEmailBtn) changeEmailBtn.style.display = "";

    // Re-vincular el botón de reenvío con el nuevo correo
    const resendBtn = $<HTMLButtonElement>("#btn-resend-verification");
    if (resendBtn) {
      resendBtn.disabled = false;
      const btnText = $<HTMLSpanElement>("#resend-btn-text");
      if (btnText) btnText.textContent = "Reenviar correo de verificación";
      resendBtn.onclick = () => handleResendVerification(newEmail, resendBtn);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error al cambiar el correo.";
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Confirmar cambio";
    }
  }
}

// ====================================================================
// BANNER DE ACTIVACIÓN EXITOSA / ERROR (desde URL params)
// ====================================================================

function checkUrlParams(): void {
  const params = new URLSearchParams(window.location.search);
  const activated = params.get("activated");
  const error = params.get("error");
  const passwordChanged = params.get("passwordChanged");
  const accountDeleted = params.get("accountDeleted");

  if (passwordChanged === "true") {
    showSuccessBanner(
      "Contraseña actualizada",
      "La sesión se cerró por seguridad. Inicia sesión con tu nueva contraseña."
    );
    window.history.replaceState({}, "", "/login.html");
  } else if (accountDeleted === "true") {
    showSuccessBanner(
      "Cuenta eliminada",
      "Tu cuenta y sus datos asociados fueron eliminados correctamente."
    );
    window.history.replaceState({}, "", "/login.html");
  } else if (activated === "true") {
    showSuccessBanner(
      "¡Correo verificado exitosamente! 🎉",
      "Tu cuenta está activa. Ya puedes iniciar sesión y comenzar a compartir viajes."
    );
    // Limpiar params de la URL
    window.history.replaceState({}, "", "/login.html");
  } else if (error === "expired_token") {
    showErrorBanner(
      "El enlace de verificación ha expirado.",
      "Los enlaces son válidos por 24 horas. Inicia sesión con tu correo y contraseña para solicitar un nuevo enlace."
    );
    window.history.replaceState({}, "", "/login.html");
  } else if (error === "invalid_token") {
    showErrorBanner(
      "Enlace de verificación inválido.",
      "El enlace que usaste no es válido o ya fue utilizado. Intenta iniciar sesión y solicitar uno nuevo."
    );
    window.history.replaceState({}, "", "/login.html");
  }

  // Revisar si hay usuario pendiente de verificación en session storage
  const pendingUser = sessionStorage.getItem('pending_verification_user');
  if (pendingUser) {
    try {
      const user = JSON.parse(pendingUser) as AuthUser;
      if (!user.isActive) {
        showVerificationPending(user);
        return;
      }
    } catch {
      sessionStorage.removeItem('pending_verification_user');
    }
  }
}

function showSuccessBanner(title: string, message: string): void {
  const authTabs = $<HTMLDivElement>(".auth-tabs");
  if (!authTabs) return;

  const banner = document.createElement("div");
  banner.className = "activation-banner activation-banner--success";
  banner.setAttribute("role", "alert");
  banner.innerHTML = `
    <div class="activation-banner-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    </div>
    <div>
      <strong>${title}</strong>
      <p>${message}</p>
    </div>
  `;
  authTabs.parentNode?.insertBefore(banner, authTabs);
}

function showErrorBanner(title: string, message: string): void {
  const authTabs = $<HTMLDivElement>(".auth-tabs");
  if (!authTabs) return;

  const banner = document.createElement("div");
  banner.className = "activation-banner activation-banner--error";
  banner.setAttribute("role", "alert");
  banner.innerHTML = `
    <div class="activation-banner-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    </div>
    <div>
      <strong>${title}</strong>
      <p>${message}</p>
    </div>
  `;
  authTabs.parentNode?.insertBefore(banner, authTabs);
}

// ====================================================================
// CONTROL DE TABS & SLIDER (Login vs Sign-up)
// ====================================================================

export function updateSliderHeight(mode?: 'login' | 'signup'): void {
  const sliderWrapper = $<HTMLDivElement>("#auth-slider-wrapper");
  if (!sliderWrapper) return;

  const isSignupActive = $<HTMLButtonElement>("#tab-signup")?.classList.contains("active");
  const currentMode = mode || (isSignupActive ? 'signup' : 'login');
  const targetPane = currentMode === 'signup' ? $<HTMLDivElement>("#pane-signup") : $<HTMLDivElement>("#pane-login");

  if (targetPane) {
    const paneHeight = targetPane.offsetHeight;
    if (paneHeight > 0) {
      sliderWrapper.style.height = `${paneHeight}px`;
    }
  }
}

export function switchTab(mode: 'login' | 'signup'): void {
  hideError();
  const tabLogin = $<HTMLButtonElement>("#tab-login");
  const tabSignup = $<HTMLButtonElement>("#tab-signup");
  const sliderTrack = $<HTMLDivElement>("#auth-slider-track");
  const paneLogin = $<HTMLDivElement>("#pane-login");
  const paneSignup = $<HTMLDivElement>("#pane-signup");
  const title = $<HTMLHeadingElement>("#auth-title");
  const subtitle = $<HTMLParagraphElement>("#auth-subtitle");

  if (mode === 'login') {
    if (tabLogin) {
      tabLogin.classList.add("active");
      tabLogin.setAttribute("aria-selected", "true");
    }
    if (tabSignup) {
      tabSignup.classList.remove("active");
      tabSignup.setAttribute("aria-selected", "false");
    }
    if (sliderTrack) {
      sliderTrack.classList.remove("slide-signup");
    }
    if (paneLogin) {
      paneLogin.setAttribute("aria-hidden", "false");
    }
    if (paneSignup) {
      paneSignup.setAttribute("aria-hidden", "true");
    }
    if (title) title.innerHTML = 'Bienvenido a <span>Asiento Libre</span>';
    if (subtitle) subtitle.textContent = 'Ingresa tus datos para continuar';
  } else {
    if (tabSignup) {
      tabSignup.classList.add("active");
      tabSignup.setAttribute("aria-selected", "true");
    }
    if (tabLogin) {
      tabLogin.classList.remove("active");
      tabLogin.setAttribute("aria-selected", "false");
    }
    if (sliderTrack) {
      sliderTrack.classList.add("slide-signup");
    }
    if (paneLogin) {
      paneLogin.setAttribute("aria-hidden", "true");
    }
    if (paneSignup) {
      paneSignup.setAttribute("aria-hidden", "false");
    }
    if (title) title.innerHTML = 'Crea tu cuenta en <span>Asiento Libre</span>';
    if (subtitle) subtitle.textContent = 'Únete a nuestra comunidad de viajes compartidos';
  }

  // Ajustar altura inmediatamente y tras animación
  requestAnimationFrame(() => {
    updateSliderHeight(mode);
  });
}

// ---- Toggle para ver / ocultar contraseñas ----
function bindPasswordToggles(): void {
  document.querySelectorAll<HTMLButtonElement>(".btn-toggle-password").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = btn.dataset.target;
      if (!targetId) return;
      const input = document.getElementById(targetId) as HTMLInputElement | null;
      if (!input) return;

      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      btn.setAttribute("aria-label", isPassword ? "Ocultar contraseña" : "Mostrar contraseña");

      btn.innerHTML = isPassword
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
            <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
            <line x1="2" y1="2" x2="22" y2="22"/>
          </svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>`;
    });
  });
}

// ---- Selector de Rol y Despliegue de Vehículo ----
function bindRoleSelector(): void {
  const roleInput = $<HTMLInputElement>("#signup-role");
  const vehicleSection = $<HTMLDivElement>("#vehicle-section");
  const options = document.querySelectorAll<HTMLDivElement>(".role-option");

  options.forEach((opt) => {
    opt.addEventListener("click", () => {
      options.forEach((o) => o.classList.remove("active"));
      opt.classList.add("active");
      const role = opt.dataset.role as 'pasajero' | 'conductor';
      if (roleInput && role) {
        roleInput.value = role;
      }

      if (vehicleSection) {
        vehicleSection.hidden = role !== 'conductor';
      }

      setTimeout(() => updateSliderHeight('signup'), 50);
    });
  });
}

// ---- Control de Omitir Vehículo ("Agregar después") ----
function bindSkipVehicleToggle(): void {
  const skipCheckbox = $<HTMLInputElement>("#skip-vehicle-checkbox");
  const vehicleFields = $<HTMLDivElement>("#vehicle-fields-container");

  if (skipCheckbox && vehicleFields) {
    skipCheckbox.addEventListener("change", () => {
      if (skipCheckbox.checked) {
        vehicleFields.classList.add("is-disabled");
      } else {
        vehicleFields.classList.remove("is-disabled");
      }
      setTimeout(() => updateSliderHeight('signup'), 50);
    });
  }
}

// ---- Carga de Documentos (PDF, Word) ----
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function renderUploadedFiles(): void {
  const list = $<HTMLDivElement>("#uploaded-files-list");
  if (!list) return;
  list.innerHTML = "";

  uploadedDocuments.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "uploaded-file-item";

    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    const iconSvg = isPdf
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C92A2A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1971C2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <line x1="10" y1="9" x2="8" y2="9"/>
        </svg>`;

    item.innerHTML = `
      <div class="file-info">
        ${iconSvg}
        <span class="file-name" title="${file.name}">${file.name}</span>
        <span class="file-size">${formatFileSize(file.size)}</span>
      </div>
      <button class="btn-remove-file" type="button" aria-label="Eliminar archivo" data-index="${index}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;

    item.querySelector(".btn-remove-file")?.addEventListener("click", () => {
      uploadedDocuments.splice(index, 1);
      renderUploadedFiles();
    });

    list.appendChild(item);
  });

  updateSliderHeight('signup');
}

function handleFilesAdded(files: FileList | null): void {
  if (!files) return;
  const allowedExtensions = [".pdf", ".doc", ".docx"];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const extension = "." + file.name.split(".").pop()?.toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      showError(`El archivo "${file.name}" no es válido. Solo se admiten archivos PDF y Word (.doc, .docx).`);
      continue;
    }

    if (file.size > 10 * 1024 * 1024) {
      showError(`El archivo "${file.name}" supera el tamaño máximo permitido de 10 MB.`);
      continue;
    }

    if (!uploadedDocuments.some((f) => f.name === file.name && f.size === file.size)) {
      uploadedDocuments.push(file);
    }
  }

  renderUploadedFiles();
}

function bindDocumentUploader(): void {
  const fileInput = $<HTMLInputElement>("#vehicle-documents");
  const dropzone = $<HTMLDivElement>("#file-dropzone");

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      handleFilesAdded(fileInput.files);
      fileInput.value = "";
    });
  }

  if (dropzone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.add("is-dragover");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.remove("is-dragover");
      });
    });

    dropzone.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files) {
        handleFilesAdded(dt.files);
      }
    });
  }
}

// ====================================================================
// VALIDACIÓN Y MANEJO DEL LOGIN & SIGN-UP
// ====================================================================

function clearFieldErrors(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLInputElement>('.is-invalid').forEach((input) => {
    input.classList.remove('is-invalid');
  });
}

function markInvalidField(input: HTMLInputElement | null, message: string): void {
  if (input) {
    input.classList.add('is-invalid');
    input.focus();
  }
  showError(message);
}

function setupFormValidationListeners(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
    input.addEventListener('input', () => {
      if (input.classList.contains('is-invalid')) {
        input.classList.remove('is-invalid');
      }
      hideError();
    });
  });
}

// ====================================================================
// MANEJO DEL LOGIN
// ====================================================================

async function handleLoginSubmit(event: Event): Promise<void> {
  event.preventDefault();
  hideError();

  const form = $<HTMLFormElement>("#form-login");
  if (!form) return;

  clearFieldErrors(form);

  const inputEmail = form.querySelector<HTMLInputElement>("#login-email");
  const inputPassword = form.querySelector<HTMLInputElement>("#login-password");
  const submitBtn = form.querySelector<HTMLButtonElement>(".btn-submit");
  const originalBtnHtml = submitBtn ? submitBtn.innerHTML : "";

  const data = new FormData(form);
  const email = String(data.get("email") ?? "").trim();
  const password = String(data.get("password") ?? "");

  // Validación de Correo
  if (!email) {
    markInvalidField(inputEmail, "Por favor ingresa tu correo electrónico.");
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    markInvalidField(inputEmail, "Por favor ingresa un correo electrónico válido (ejemplo@correo.com).");
    return;
  }

  // Validación de Contraseña
  if (!password) {
    markInvalidField(inputPassword, "Por favor ingresa tu contraseña.");
    return;
  }

  if (password.length < 6) {
    markInvalidField(inputPassword, "La contraseña debe tener al menos 6 caracteres.");
    return;
  }

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
          <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"/>
        </svg>
        Iniciando sesión...
      `;
    }

    const response = await authService.login({ email, password });

    // Si el usuario NO está activo, mostrar pantalla de verificación
    if (!response.user.isActive) {
      showVerificationPending(response.user);
      return;
    }

    setActiveUser(response.user);

    if (response.user.role === 'admin') {
      showToast(`¡Bienvenido Administrador, ${response.user.firstName}! Accediendo al panel...`);
      setTimeout(() => {
        window.location.href = "/admin.html";
      }, 900);
      return;
    }

    showToast(`¡Bienvenido de nuevo, ${response.user.firstName}! Redirigiendo...`);
    setTimeout(() => {
      window.location.href = "/index.html";
    }, 1000);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Error al iniciar sesión.";
    showError(errorMsg);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }
}

// ====================================================================
// MANEJO DEL SIGN-UP
// ====================================================================

async function handleSignUpSubmit(event: Event): Promise<void> {
  event.preventDefault();
  hideError();

  const form = $<HTMLFormElement>("#form-signup");
  if (!form) return;

  clearFieldErrors(form);

  const inputFirstName = form.querySelector<HTMLInputElement>("#signup-firstname");
  const inputLastName = form.querySelector<HTMLInputElement>("#signup-lastname");
  const inputId = form.querySelector<HTMLInputElement>("#signup-id");
  const inputPhone = form.querySelector<HTMLInputElement>("#signup-phone");
  const inputEmail = form.querySelector<HTMLInputElement>("#signup-email");
  const inputPassword = form.querySelector<HTMLInputElement>("#signup-password");
  const inputConfirmPassword = form.querySelector<HTMLInputElement>("#signup-confirm-password");
  const submitBtn = form.querySelector<HTMLButtonElement>(".btn-submit");
  const originalBtnHtml = submitBtn ? submitBtn.innerHTML : "";

  const data = new FormData(form);
  const role = (String(data.get("role") ?? "pasajero")) as 'pasajero' | 'conductor';
  const skipVehicle = Boolean(data.get("skipVehicle"));

  const payload: UserSignUp = {
    firstName: String(data.get("firstName") ?? "").trim(),
    lastName: String(data.get("lastName") ?? "").trim(),
    nationalId: String(data.get("nationalId") ?? "").trim(),
    phone: String(data.get("phone") ?? "").trim(),
    email: String(data.get("email") ?? "").trim(),
    password: String(data.get("password") ?? ""),
    confirmPassword: String(data.get("confirmPassword") ?? ""),
    role,
    skipVehicle,
  };

  // Validaciones campo por campo
  if (!payload.firstName) {
    markInvalidField(inputFirstName, "Por favor ingresa tu nombre.");
    return;
  }
  if (payload.firstName.length < 2) {
    markInvalidField(inputFirstName, "El nombre debe tener al menos 2 caracteres.");
    return;
  }

  if (!payload.lastName) {
    markInvalidField(inputLastName, "Por favor ingresa tu apellido.");
    return;
  }
  if (payload.lastName.length < 2) {
    markInvalidField(inputLastName, "El apellido debe tener al menos 2 caracteres.");
    return;
  }

  if (!payload.nationalId) {
    markInvalidField(inputId, "Por favor ingresa tu documento de identidad (ID / Cédula).");
    return;
  }
  if (payload.nationalId.length < 5) {
    markInvalidField(inputId, "El documento de identidad debe tener al menos 5 dígitos o caracteres.");
    return;
  }

  if (!payload.phone) {
    markInvalidField(inputPhone, "Por favor ingresa tu número de teléfono.");
    return;
  }
  if (!/^[0-9]{7,15}$/.test(payload.phone)) {
    markInvalidField(inputPhone, "El número de teléfono debe contener entre 7 y 15 dígitos numéricos (ej: 3001234567).");
    return;
  }

  if (!payload.email) {
    markInvalidField(inputEmail, "Por favor ingresa tu correo electrónico.");
    return;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(payload.email)) {
    markInvalidField(inputEmail, "Por favor ingresa un correo electrónico válido (ejemplo@correo.com).");
    return;
  }

  if (!payload.password) {
    markInvalidField(inputPassword, "Por favor ingresa una contraseña.");
    return;
  }
  if (payload.password.length < 6) {
    markInvalidField(inputPassword, "La contraseña debe tener al menos 6 caracteres.");
    return;
  }

  if (!payload.confirmPassword) {
    markInvalidField(inputConfirmPassword, "Por favor confirma tu contraseña.");
    return;
  }
  if (payload.password !== payload.confirmPassword) {
    markInvalidField(inputConfirmPassword, "Las contraseñas no coinciden. Por favor verifícalas.");
    return;
  }

  let vehicleData: VehicleData | undefined = undefined;

  if (role === 'conductor' && !skipVehicle) {
    const inputBrand = form.querySelector<HTMLInputElement>("#vehicle-brand");
    const inputModel = form.querySelector<HTMLInputElement>("#vehicle-model");
    const inputColor = form.querySelector<HTMLInputElement>("#vehicle-color");
    const inputPlate = form.querySelector<HTMLInputElement>("#vehicle-plate");
    const inputCapacity = form.querySelector<HTMLInputElement>("#vehicle-capacity");

    const brand = String(data.get("vehicleBrand") ?? "").trim();
    const model = String(data.get("vehicleModel") ?? "").trim();
    const color = String(data.get("vehicleColor") ?? "").trim();
    const plate = String(data.get("vehiclePlate") ?? "").trim().toUpperCase();
    const capacityValue = String(data.get("vehicleCapacity") ?? "").trim();
    const capacity = Number(capacityValue);

    if (!brand || brand.length < 2) {
      markInvalidField(inputBrand, "Ingresa la marca del vehículo (mínimo 2 caracteres).");
      return;
    }
    if (!model || model.length < 2) {
      markInvalidField(inputModel, "Ingresa el modelo del vehículo (mínimo 2 caracteres).");
      return;
    }
    if (!color || color.length < 2) {
      markInvalidField(inputColor, "Ingresa el color del vehículo.");
      return;
    }
    const cleanPlate = plate.replace(/\s+/g, '');
    if (!plate || !/^[A-Z]{3}[0-9]{3}$/.test(cleanPlate)) {
      markInvalidField(inputPlate, "La placa debe tener tres letras y tres números (ej: ABC123).");
      return;
    }
    if (!capacityValue || !Number.isInteger(capacity) || capacity < 1 || capacity > 8) {
      markInvalidField(inputCapacity, "La capacidad debe ser un número entero entre 1 y 8, sin incluir al conductor.");
      return;
    }

    vehicleData = { brand, model, color, plate: cleanPlate, capacity, documents: uploadedDocuments };
    payload.vehicle = vehicleData;
  }

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <svg class="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
          <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"/>
        </svg>
        Creando cuenta...
      `;
    }

    const response = await authService.register({
      firstName: payload.firstName,
      lastName: payload.lastName,
      nationalId: payload.nationalId,
      phone: payload.phone,
      email: payload.email,
      password: payload.password,
      role: payload.role,
      skipVehicle: payload.skipVehicle,
      vehicle: vehicleData
        ? { brand: vehicleData.brand, model: vehicleData.model, color: vehicleData.color, plate: vehicleData.plate, capacity: vehicleData.capacity }
        : undefined,
    });

    // Mostrar pantalla de verificación (is_active = false recién registrado)
    showVerificationPending(response.user);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Error al registrar la cuenta.";
    showError(errorMsg);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }
}

// ====================================================================
// INICIALIZACIÓN
// ====================================================================

function initAuth(): void {
  // Verificar parámetros de URL (activated=true, error=expired_token, etc.)
  checkUrlParams();

  // Si ya se mostró la pantalla de verificación, no inicializar los formularios
  if ($<HTMLDivElement>("#verification-pending-screen")) return;

  // Tabs
  const tabLogin = $<HTMLButtonElement>("#tab-login");
  const tabSignup = $<HTMLButtonElement>("#tab-signup");
  const linkSignup = $<HTMLAnchorElement>("#link-go-signup");
  const linkLogin = $<HTMLAnchorElement>("#link-go-login");

  if (tabLogin) tabLogin.addEventListener("click", () => switchTab('login'));
  if (tabSignup) tabSignup.addEventListener("click", () => switchTab('signup'));
  if (linkSignup) {
    linkSignup.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab('signup');
    });
  }
  if (linkLogin) {
    linkLogin.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab('login');
    });
  }

  // Formularios
  const formLogin = $<HTMLFormElement>("#form-login");
  const formSignup = $<HTMLFormElement>("#form-signup");

  if (formLogin) {
    formLogin.addEventListener("submit", handleLoginSubmit);
    setupFormValidationListeners(formLogin);
  }
  if (formSignup) {
    formSignup.addEventListener("submit", handleSignUpSubmit);
    setupFormValidationListeners(formSignup);
  }

  // Helpers UI
  bindPasswordToggles();
  bindRoleSelector();
  bindSkipVehicleToggle();
  bindDocumentUploader();

  // Olvidaste contraseña
  const forgotBtn = $<HTMLAnchorElement>("#btn-forgot-password");
  if (forgotBtn) {
    forgotBtn.addEventListener("click", (e) => {
      e.preventDefault();
      showToast("Función de recuperación enviará un enlace a tu correo.");
    });
  }

  // Comprobar hash en la URL (#signup o #login)
  if (window.location.hash === "#signup") {
    switchTab('signup');
  } else {
    requestAnimationFrame(() => {
      updateSliderHeight('login');
    });
  }

  // Listener para ajuste de altura responsivo al redimensionar ventana
  window.addEventListener("resize", () => {
    updateSliderHeight();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuth);
} else {
  initAuth();
}

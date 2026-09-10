// =========================================================
// Asiento Libre — Lógica de la Página de Perfil (Profile)
// =========================================================

import { getActiveUser, setActiveUser, initHeader } from "../../components/header/header";
import type { AuthUser } from "../../components/header/header";
import { authService } from "../../../core/services/auth.service";
import { routesService } from "../../../core/services/routes.service";

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let resendInterval: ReturnType<typeof setInterval> | undefined;
let originalEmail = "";

// ---- Utilidades DOM ----
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
  }, 3500);
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// ---- Visibilidad según el Rol (Conductor vs Pasajero) ----
function updateRoleVisibility(role: 'pasajero' | 'conductor'): void {
  const navVehiculo = $<HTMLAnchorElement>("#nav-vehiculo");
  const sectionVehiculo = $<HTMLElement>("#vehiculo");

  const isDriver = role === 'conductor';

  if (navVehiculo) {
    navVehiculo.style.display = isDriver ? "" : "none";
  }

  if (sectionVehiculo) {
    sectionVehiculo.style.display = isDriver ? "" : "none";
  }
}

// ---- Cargar datos en la UI ----
function populateProfileUI(user: AuthUser): void {
  originalEmail = user.email || "";
  const fullName = `${user.firstName} ${user.lastName}`.trim() || user.email;
  const initials = getInitials(fullName);

  // Sidebar
  const sidebarAvatar = $<HTMLDivElement>("#profile-card-avatar");
  const sidebarName = $<HTMLHeadingElement>("#profile-card-name");
  const sidebarEmail = $<HTMLParagraphElement>("#profile-card-email");
  const sidebarRole = $<HTMLSpanElement>("#profile-card-role");

  if (sidebarAvatar) sidebarAvatar.textContent = initials;
  if (sidebarName) sidebarName.textContent = fullName;
  if (sidebarEmail) sidebarEmail.textContent = user.email;
  if (sidebarRole) {
    sidebarRole.textContent = user.role === 'conductor' ? '🚗 Conductor' : '👤 Pasajero';
  }

  // Formulario 1: Datos Personales
  const inputFirstName = $<HTMLInputElement>("#profile-firstname");
  const inputLastName = $<HTMLInputElement>("#profile-lastname");
  const inputNationalId = $<HTMLInputElement>("#profile-national-id");
  const inputEmail = $<HTMLInputElement>("#profile-email");
  const selectRole = $<HTMLSelectElement>("#profile-role");

  if (inputFirstName) inputFirstName.value = user.firstName || "";
  if (inputLastName) inputLastName.value = user.lastName || "";
  if (inputNationalId) inputNationalId.value = user.nationalId || "";
  if (inputEmail) inputEmail.value = user.email || "";
  if (selectRole) selectRole.value = user.role || "pasajero";

  // Controlar visibilidad del vehículo según el rol
  updateRoleVisibility(user.role || "pasajero");

  // Formulario 2: Vehículo
  const inputBrand = $<HTMLInputElement>("#profile-vehicle-brand");
  const inputModel = $<HTMLInputElement>("#profile-vehicle-model");
  const inputColor = $<HTMLInputElement>("#profile-vehicle-color");
  const inputPlate = $<HTMLInputElement>("#profile-vehicle-plate");
  const inputCapacity = $<HTMLInputElement>("#profile-vehicle-capacity");

  if (user.vehicle) {
    if (inputBrand) inputBrand.value = user.vehicle.brand || "";
    if (inputModel) inputModel.value = user.vehicle.model || "";
    if (inputColor) inputColor.value = user.vehicle.color || "";
    if (inputPlate) inputPlate.value = user.vehicle.plate || "";
    if (inputCapacity) inputCapacity.value = String(user.vehicle.capacity ?? "");
  }
}

// ---- Modal de Verificación de Cambio de Correo ----
function openEmailChangeModal(pendingEmail: string): void {
  const modal = $<HTMLDivElement>("#email-change-modal");
  const targetLabel = $<HTMLElement>("#email-modal-target");
  const errorBox = $<HTMLDivElement>("#email-modal-error");
  const inputCode = $<HTMLInputElement>("#input-email-code");

  if (targetLabel) targetLabel.textContent = pendingEmail;
  if (errorBox) {
    errorBox.textContent = "";
    errorBox.hidden = true;
  }
  if (inputCode) {
    inputCode.value = "";
    setTimeout(() => inputCode.focus(), 150);
  }
  if (modal) modal.hidden = false;

  startResendCooldown(60);
}

function closeEmailChangeModal(): void {
  const modal = $<HTMLDivElement>("#email-change-modal");
  if (modal) modal.hidden = true;
  clearInterval(resendInterval);
}

function startResendCooldown(seconds: number): void {
  const resendBtn = $<HTMLButtonElement>("#btn-resend-email-code");
  if (!resendBtn) return;

  clearInterval(resendInterval);
  let remaining = seconds;
  resendBtn.disabled = true;
  resendBtn.textContent = `Reenviar en ${remaining}s`;

  resendInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(resendInterval);
      resendBtn.disabled = false;
      resendBtn.textContent = "Reenviar código";
    } else {
      resendBtn.textContent = `Reenviar en ${remaining}s`;
    }
  }, 1000);
}

// ---- Guardar Datos Personales ----
async function handlePersonalDataSubmit(event: Event, currentUser: AuthUser): Promise<void> {
  event.preventDefault();
  const form = $<HTMLFormElement>("#form-personal-data");
  if (!form) return;

  const submitBtn = form.querySelector<HTMLButtonElement>("button[type='submit']");
  const data = new FormData(form);
  const firstName = String(data.get("firstName") ?? "").trim();
  const lastName = String(data.get("lastName") ?? "").trim();
  const nationalId = String(data.get("nationalId") ?? "").trim();
  const newEmail = String(data.get("email") ?? "").trim().toLowerCase();
  const role = currentUser.role;

  if (!firstName || !newEmail) {
    showToast("Nombre y correo electrónico son obligatorios.");
    return;
  }

  const isEmailChanged = newEmail !== originalEmail.toLowerCase();

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Guardando...";
    }

    // 1. Si el correo cambió, solicitar validación con código de 6 dígitos
    if (isEmailChanged) {
      await authService.requestEmailChange(newEmail);

      // Guardar cambios de otros campos (nombre, apellido, rol) en BD
      await authService.updateProfile({
        firstName,
        lastName,
        nationalId,
      });

      const updatedUser: AuthUser = {
        ...currentUser,
        firstName,
        lastName,
        nationalId,
        role,
        vehicle: role === 'conductor' ? currentUser.vehicle : undefined,
      };
      setActiveUser(updatedUser);
      populateProfileUI(updatedUser);
      // Revertir el input al original temporalmente hasta verificar
      const inputEmail = $<HTMLInputElement>("#profile-email");
      if (inputEmail) inputEmail.value = originalEmail;

      openEmailChangeModal(newEmail);
      showToast(`Código de verificación enviado a ${newEmail}`);
    } else {
      // 2. Si no cambió el correo, actualizar datos normalmente en Supabase
      await authService.updateProfile({
        firstName,
        lastName,
        nationalId,
      });

      const updatedUser: AuthUser = {
        ...currentUser,
        firstName,
        lastName,
        nationalId,
        role,
        vehicle: role === 'conductor' ? currentUser.vehicle : undefined,
      };

      setActiveUser(updatedUser);
      populateProfileUI(updatedUser);
      initHeader();
      showToast("¡Tus datos personales fueron actualizados con éxito!");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast(msg);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        Guardar cambios
      `;
    }
  }
}

// ---- Confirmar Código de Cambio de Correo ----
async function handleConfirmEmailCode(event: Event): Promise<void> {
  event.preventDefault();
  const inputCode = $<HTMLInputElement>("#input-email-code");
  const errorBox = $<HTMLDivElement>("#email-modal-error");
  const confirmBtn = $<HTMLButtonElement>("#btn-confirm-email-code");

  const code = inputCode?.value.trim() || "";

  if (!code || code.length !== 6) {
    if (errorBox) {
      errorBox.textContent = "El código debe tener exactamente 6 dígitos.";
      errorBox.hidden = false;
    }
    return;
  }

  try {
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Verificando...";
    }
    if (errorBox) errorBox.hidden = true;

    const res = await authService.confirmEmailChange(code);

    const currentUser = getActiveUser();
    if (currentUser) {
      const updatedUser: AuthUser = {
        ...currentUser,
        email: res.newEmail,
      };
      setActiveUser(updatedUser);
      populateProfileUI(updatedUser);
      initHeader();
    }

    closeEmailChangeModal();
    showToast("¡Correo electrónico actualizado con éxito!");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.hidden = false;
    }
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Confirmar y cambiar correo
      `;
    }
  }
}

// ---- Cancelar Cambio de Correo ----
async function handleCancelEmailChange(): Promise<void> {
  try {
    await authService.cancelEmailChange();
  } catch {
    // Ignorar si ya estaba limpio
  } finally {
    closeEmailChangeModal();
    const inputEmail = $<HTMLInputElement>("#profile-email");
    if (inputEmail) inputEmail.value = originalEmail;
    showToast("Solicitud de cambio de correo cancelada.");
  }
}

// ---- Reenviar Código de Cambio de Correo ----
async function handleResendEmailChangeCode(): Promise<void> {
  try {
    const res = await authService.resendEmailChangeCode();
    startResendCooldown(60);
    showToast(res.message || "Nuevo código de verificación enviado.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast(msg);
  }
}

// ---- Guardar Datos del Vehículo ----
async function handleVehicleDataSubmit(event: Event, currentUser: AuthUser): Promise<void> {
  event.preventDefault();
  const form = $<HTMLFormElement>("#form-vehicle-data");
  if (!form) return;

  const submitBtn = form.querySelector<HTMLButtonElement>("button[type='submit']");
  const data = new FormData(form);
  const brand = String(data.get("brand") ?? "").trim();
  const model = String(data.get("model") ?? "").trim();
  const color = String(data.get("color") ?? "").trim();
  const plate = String(data.get("plate") ?? "").trim().toUpperCase();
  const capacity = Number(data.get("capacity"));

  if (!brand || !model || !color || !plate) {
    showToast("Marca, modelo, color y placa son obligatorios.");
    return;
  }
  if (!/^[A-Z]{3}\d{3}$/.test(plate)) {
    showToast("La placa debe usar el formato ABC123.");
    return;
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 8) {
    showToast("La capacidad debe estar entre 1 y 8 pasajeros.");
    return;
  }

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Guardando...";
    }

    const saved = await routesService.saveVehicle({ brand, model, color, plate, capacity });
    const vehicleData = { brand: saved.brand, model: saved.model, color: saved.color, plate: saved.plate, capacity: saved.capacity ?? capacity };

    const updatedUser: AuthUser = {
      ...currentUser,
      vehicle: vehicleData,
    };

    setActiveUser(updatedUser);
    populateProfileUI(updatedUser);
    initHeader();
    showToast("¡Los datos de tu vehículo fueron guardados con éxito!");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast(msg);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        Guardar vehículo
      `;
    }
  }
}

// ---- Guardar Contraseña ----
function handleSecuritySubmit(event: Event): void {
  event.preventDefault();
  const form = $<HTMLFormElement>("#form-security-data");
  if (!form) return;

  const data = new FormData(form);
  const currentPassword = String(data.get("currentPassword") ?? "");
  const newPassword = String(data.get("newPassword") ?? "");
  const confirmNewPassword = String(data.get("confirmNewPassword") ?? "");

  if (!currentPassword || !newPassword) {
    showToast("Por favor completa los campos de contraseña.");
    return;
  }

  if (newPassword.length < 6) {
    showToast("La nueva contraseña debe tener al menos 6 caracteres.");
    return;
  }

  if (newPassword !== confirmNewPassword) {
    showToast("Las nuevas contraseñas no coinciden.");
    return;
  }

  showToast("El cambio de contraseña estará disponible en una próxima historia de usuario.");
}

// ---- Eliminar Cuenta ----
function bindDeleteAccount(): void {
  const openModalBtn = $<HTMLButtonElement>("#btn-open-delete-modal");
  const modalOverlay = $<HTMLDivElement>("#delete-modal-overlay");
  const cancelBtn = $<HTMLButtonElement>("#btn-cancel-delete");
  const confirmBtn = $<HTMLButtonElement>("#btn-confirm-delete");

  if (openModalBtn && modalOverlay) {
    openModalBtn.addEventListener("click", () => {
      modalOverlay.hidden = false;
    });
  }

  if (cancelBtn && modalOverlay) {
    cancelBtn.addEventListener("click", () => {
      modalOverlay.hidden = true;
    });
  }

  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) modalOverlay.hidden = true;
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener("click", () => {
      showToast("La eliminación de cuenta estará disponible en una próxima historia de usuario.");
      if (modalOverlay) modalOverlay.hidden = true;
    });
  }
}

// ---- Navegación del Sidebar ----
function bindSidebarNav(): void {
  const buttons = document.querySelectorAll<HTMLAnchorElement>(".profile-nav-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

// ---- Inicialización Principal ----
async function initProfile(): Promise<void> {
  let user: AuthUser;
  try {
    user = await authService.getMe();
    setActiveUser(user);
    await initHeader(user);
  } catch {
    window.location.href = "/login.html";
    return;
  }

  // Si no hay usuario autenticado, redirigir a Login
  // Si el usuario existe pero no ha verificado su correo, redirigir a verificación
  if (!user.isActive) {
    window.location.href = "/login.html";
    return;
  }

  populateProfileUI(user);

  // Formulario 1: Datos Personales
  const formPersonal = $<HTMLFormElement>("#form-personal-data");
  if (formPersonal) {
    formPersonal.addEventListener("submit", (e) => {
      const currentUser = getActiveUser() ?? user;
      void handlePersonalDataSubmit(e, currentUser);
    });
  }

  // Cambio dinámico de rol en el select de datos personales
  const selectRole = $<HTMLSelectElement>("#profile-role");
  if (selectRole) {
    selectRole.disabled = true;
  }

  // Modal de Confirmación de Código de Correo
  const formConfirmEmail = $<HTMLFormElement>("#form-confirm-email-code");
  if (formConfirmEmail) {
    formConfirmEmail.addEventListener("submit", (e) => void handleConfirmEmailCode(e));
  }

  const btnCancelEmail = $<HTMLButtonElement>("#btn-cancel-email-change");
  if (btnCancelEmail) {
    btnCancelEmail.addEventListener("click", () => void handleCancelEmailChange());
  }

  const btnResendEmail = $<HTMLButtonElement>("#btn-resend-email-code");
  if (btnResendEmail) {
    btnResendEmail.addEventListener("click", () => void handleResendEmailChangeCode());
  }

  // Formulario 2: Vehículo
  const formVehicle = $<HTMLFormElement>("#form-vehicle-data");
  if (formVehicle) {
    formVehicle.addEventListener("submit", (e) => {
      const currentUser = getActiveUser() ?? user;
      void handleVehicleDataSubmit(e, currentUser);
    });
  }

  // Formulario 3: Seguridad
  const formSecurity = $<HTMLFormElement>("#form-security-data");
  if (formSecurity) {
    formSecurity.addEventListener("submit", handleSecuritySubmit);
  }

  // Eliminar Cuenta y Sidebar
  bindDeleteAccount();
  bindSidebarNav();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { void initProfile(); });
} else {
  void initProfile();
}

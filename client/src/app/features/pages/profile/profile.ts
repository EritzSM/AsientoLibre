// =========================================================
// Asiento Libre — Lógica de la Página de Perfil (Profile)
// =========================================================

import { getActiveUser, setActiveUser, logoutUser, initHeader } from "../../components/header/header";
import type { AuthUser } from "../../components/header/header";

let toastTimer: ReturnType<typeof setTimeout> | undefined;

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
  }, 3200);
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// ---- Cargar datos en la UI ----
function populateProfileUI(user: AuthUser): void {
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

  // Formulario 2: Vehículo
  const inputBrand = $<HTMLInputElement>("#profile-vehicle-brand");
  const inputModel = $<HTMLInputElement>("#profile-vehicle-model");
  const inputColor = $<HTMLInputElement>("#profile-vehicle-color");
  const inputPlate = $<HTMLInputElement>("#profile-vehicle-plate");

  if (user.vehicle) {
    if (inputBrand) inputBrand.value = user.vehicle.brand || "";
    if (inputModel) inputModel.value = user.vehicle.model || "";
    if (inputColor) inputColor.value = user.vehicle.color || "";
    if (inputPlate) inputPlate.value = user.vehicle.plate || "";
  }
}

// ---- Guardar Datos Personales ----
function handlePersonalDataSubmit(event: Event, currentUser: AuthUser): void {
  event.preventDefault();
  const form = $<HTMLFormElement>("#form-personal-data");
  if (!form) return;

  const data = new FormData(form);
  const firstName = String(data.get("firstName") ?? "").trim();
  const lastName = String(data.get("lastName") ?? "").trim();
  const nationalId = String(data.get("nationalId") ?? "").trim();
  const email = String(data.get("email") ?? "").trim();
  const role = (String(data.get("role") ?? "pasajero")) as 'pasajero' | 'conductor';

  if (!firstName || !email) {
    showToast("Nombre y correo electrónico son obligatorios.");
    return;
  }

  const updatedUser: AuthUser = {
    ...currentUser,
    firstName,
    lastName,
    nationalId,
    email,
    role,
  };

  setActiveUser(updatedUser);
  populateProfileUI(updatedUser);
  initHeader();
  showToast("¡Tus datos personales fueron actualizados con éxito!");
}

// ---- Guardar Datos del Vehículo ----
function handleVehicleDataSubmit(event: Event, currentUser: AuthUser): void {
  event.preventDefault();
  const form = $<HTMLFormElement>("#form-vehicle-data");
  if (!form) return;

  const data = new FormData(form);
  const brand = String(data.get("brand") ?? "").trim();
  const model = String(data.get("model") ?? "").trim();
  const color = String(data.get("color") ?? "").trim();
  const plate = String(data.get("plate") ?? "").trim().toUpperCase();

  const updatedUser: AuthUser = {
    ...currentUser,
    role: "conductor", // Al guardar vehículo se asegura el rol de conductor
    vehicle: {
      brand,
      model,
      color,
      plate,
    },
  };

  setActiveUser(updatedUser);
  populateProfileUI(updatedUser);
  initHeader();
  showToast("¡Los datos de tu vehículo fueron guardados con éxito!");
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

  form.reset();
  showToast("¡Contraseña actualizada correctamente!");
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
      localStorage.removeItem("asiento_libre_user");
      showToast("Tu cuenta ha sido eliminada permanentemente.");
      setTimeout(() => {
        window.location.href = "/index.html";
      }, 1200);
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
function initProfile(): void {
  initHeader();

  const user = getActiveUser();

  // Si no hay usuario autenticado, redirigir a Login
  if (!user) {
    window.location.href = "/login.html";
    return;
  }

  populateProfileUI(user);

  // Formulario 1: Datos Personales
  const formPersonal = $<HTMLFormElement>("#form-personal-data");
  if (formPersonal) {
    formPersonal.addEventListener("submit", (e) => {
      const currentUser = getActiveUser() ?? user;
      handlePersonalDataSubmit(e, currentUser);
    });
  }

  // Formulario 2: Vehículo
  const formVehicle = $<HTMLFormElement>("#form-vehicle-data");
  if (formVehicle) {
    formVehicle.addEventListener("submit", (e) => {
      const currentUser = getActiveUser() ?? user;
      handleVehicleDataSubmit(e, currentUser);
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
  document.addEventListener("DOMContentLoaded", initProfile);
} else {
  initProfile();
}

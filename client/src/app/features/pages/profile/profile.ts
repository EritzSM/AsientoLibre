// =========================================================
// Asiento Libre — Lógica de la Página de Perfil (Profile)
// =========================================================

import { clearActiveUser, getActiveUser, setActiveUser, initHeader } from "../../components/header/header";
import type { AuthUser } from "../../components/header/header";
import { authService } from "../../../core/services/auth.service";
import { routesService } from "../../../core/services/routes.service";
import type { ConductorDocument } from "../../../core/services/routes.service";

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

// ---- Visibilidad según el Rol (Conductor vs Pasajero vs Admin) ----
function updateRoleVisibility(role?: string): void {
  const navVehiculo = $<HTMLAnchorElement>("#nav-vehiculo");
  const sectionVehiculo = $<HTMLElement>("#vehiculo");
  const navDocumentos = $<HTMLAnchorElement>("#nav-documentos");
  const sectionDocumentos = $<HTMLElement>("#documentos");

  const isDriver = role === 'conductor';

  if (navVehiculo) navVehiculo.style.display = isDriver ? "" : "none";
  if (sectionVehiculo) sectionVehiculo.style.display = isDriver ? "" : "none";
  if (navDocumentos) navDocumentos.style.display = isDriver ? "" : "none";
  if (sectionDocumentos) sectionDocumentos.style.display = isDriver ? "" : "none";
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
    sidebarRole.textContent = 
      user.role === 'admin' ? '🛡️ Administrador' :
      user.role === 'conductor' ? '🚗 Conductor' : '👤 Pasajero';
  }

  // Formulario 1: Datos Personales
  const inputFirstName = $<HTMLInputElement>("#profile-firstname");
  const inputLastName = $<HTMLInputElement>("#profile-lastname");
  const inputNationalId = $<HTMLInputElement>("#profile-national-id");
  const inputPhone = $<HTMLInputElement>("#profile-phone");
  const inputEmail = $<HTMLInputElement>("#profile-email");
  const selectRole = $<HTMLSelectElement>("#profile-role");

  if (inputFirstName) inputFirstName.value = user.firstName || "";
  if (inputLastName) inputLastName.value = user.lastName || "";
  if (inputNationalId) inputNationalId.value = user.nationalId || "";
  if (inputPhone) inputPhone.value = user.phone || "";
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
  const phone = String(data.get("phone") ?? "").trim();
  const newEmail = String(data.get("email") ?? "").trim().toLowerCase();
  const selectedRole = (String(data.get("role") ?? "").trim() || currentUser.role) as 'pasajero' | 'conductor';

  if (!firstName || !lastName || !nationalId || !newEmail) {
    showToast("Nombre, apellido, documento y correo electrónico son obligatorios.");
    return;
  }

  if (phone && !/^\d{7,15}$/.test(phone)) {
    showToast("El teléfono debe contener únicamente entre 7 y 15 dígitos.");
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
        phone,
        role: selectedRole,
      });

      const updatedUser: AuthUser = {
        ...currentUser,
        firstName,
        lastName,
        nationalId,
        phone,
        role: selectedRole,
        vehicle: selectedRole === 'conductor' ? currentUser.vehicle : undefined,
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
        phone,
        role: selectedRole,
      });

      const updatedUser: AuthUser = {
        ...currentUser,
        firstName,
        lastName,
        nationalId,
        phone,
        role: selectedRole,
        vehicle: selectedRole === 'conductor' ? currentUser.vehicle : undefined,
      };

      setActiveUser(updatedUser);
      populateProfileUI(updatedUser);
      void initHeader(updatedUser);

      const isRoleChanged = selectedRole !== currentUser.role;
      const successMsg = isRoleChanged
        ? `¡Datos personales y rol actualizados a ${selectedRole === 'conductor' ? 'Conductor' : 'Pasajero'} con éxito!`
        : "¡Tus datos personales fueron actualizados con éxito!";
      showToast(successMsg);
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
      void initHeader(updatedUser);
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
    void initHeader(updatedUser);
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
async function handleSecuritySubmit(event: Event): Promise<void> {
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

  if (newPassword.length < 8 || newPassword.length > 72 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    showToast("La nueva contraseña debe tener entre 8 y 72 caracteres, con mayúscula, minúscula y número.");
    return;
  }

  if (newPassword !== confirmNewPassword) {
    showToast("Las nuevas contraseñas no coinciden.");
    return;
  }

  if (currentPassword === newPassword) {
    showToast("La nueva contraseña debe ser diferente a la actual.");
    return;
  }

  const submitBtn = form.querySelector<HTMLButtonElement>("button[type='submit']");
  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Actualizando...";
    }
    await authService.changePassword(currentPassword, newPassword);
    clearActiveUser();
    window.location.href = "/login.html?passwordChanged=true";
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : String(err));
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Actualizar contraseña";
    }
  }
}

// ---- Eliminar Cuenta ----
function bindDeleteAccount(): void {
  const openModalBtn = $<HTMLButtonElement>("#btn-open-delete-modal");
  const modalOverlay = $<HTMLDivElement>("#delete-modal-overlay");
  const cancelBtn = $<HTMLButtonElement>("#btn-cancel-delete");
  const form = $<HTMLFormElement>("#form-delete-account");
  const confirmBtn = $<HTMLButtonElement>("#btn-confirm-delete");
  const passwordInput = $<HTMLInputElement>("#delete-account-password");
  const errorBox = $<HTMLParagraphElement>("#delete-account-error");

  const closeModal = (): void => {
    if (modalOverlay) modalOverlay.hidden = true;
    if (form) form.reset();
    if (errorBox) {
      errorBox.textContent = "";
      errorBox.hidden = true;
    }
  };

  if (openModalBtn && modalOverlay) {
    openModalBtn.addEventListener("click", () => {
      modalOverlay.hidden = false;
      setTimeout(() => passwordInput?.focus(), 100);
    });
  }

  if (cancelBtn && modalOverlay) {
    cancelBtn.addEventListener("click", () => {
      closeModal();
    });
  }

  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) closeModal();
    });
  }

  if (form && confirmBtn) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const password = passwordInput?.value ?? "";
      if (!password) return;
      if (errorBox) errorBox.hidden = true;
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Eliminando...";

      void authService.deleteAccount(password).then(() => {
        clearActiveUser();
        window.location.href = "/login.html?accountDeleted=true";
      }).catch((err: unknown) => {
        if (errorBox) {
          errorBox.textContent = err instanceof Error ? err.message : String(err);
          errorBox.hidden = false;
        }
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Sí, eliminar cuenta";
        passwordInput?.focus();
      });
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

  // Selector interactivo de rol (actualiza vista previa y se guarda con 'Guardar cambios')
  const selectRole = $<HTMLSelectElement>("#profile-role");
  if (selectRole) {
    selectRole.disabled = false;
    selectRole.addEventListener("change", () => {
      const chosenRole = selectRole.value as 'pasajero' | 'conductor';
      updateRoleVisibility(chosenRole);
    });
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
    formSecurity.addEventListener("submit", (event) => void handleSecuritySubmit(event));
  }

  // Eliminar Cuenta y Sidebar
  bindDeleteAccount();
  bindSidebarNav();

  // Documentos (solo para conductores)
  if (user.role === 'conductor') {
    void initDocuments();
  }
}

// =========================================================
// Lógica de Documentos del Conductor
// =========================================================

function formatDocType(type: string): string {
  const labels: Record<string, string> = {
    licencia: '🪪 Licencia de Conducción',
    soat: '📄 SOAT',
    cedula: '🆔 Cédula de Ciudadanía',
    foto_vehiculo: '🚗 Foto del Vehículo',
  };
  return labels[type] || type;
}

function formatDocDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function renderDocList(docs: ConductorDocument[]): void {
  const container = $<HTMLDivElement>('#docs-list');
  const loading = $<HTMLDivElement>('#docs-loading');
  const uploadArea = $<HTMLDivElement>('#doc-upload-area');
  if (!container) return;

  if (loading) loading.hidden = true;
  if (uploadArea) uploadArea.hidden = false;
  container.hidden = false;

  if (docs.length === 0) {
    container.innerHTML = '<p class="docs-empty">¡Aún no has subido ningún documento. Sube tus documentos para que el equipo pueda verificarte.</p>';
    return;
  }

  container.innerHTML = `<div class="docs-grid">${docs.map((doc) => `
    <div class="doc-card" data-doc-id="${doc.id}">
      <div class="doc-card-top">
        <div>
          <div class="doc-card-type">${formatDocType(doc.document_type)}</div>
          <div class="doc-card-date">Enviado: ${formatDocDate(doc.submitted_at)}</div>
        </div>
        <span class="doc-status-badge ${doc.status}">
          ${doc.status === 'pendiente' ? '⏳' : doc.status === 'aprobado' ? '✅' : '❌'}
          ${doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
        </span>
      </div>
      ${doc.rejection_reason
        ? `<div class="doc-rejection-note">⚠️ Motivo del rechazo: ${doc.rejection_reason}</div>`
        : ''}
      <div class="doc-card-actions">
        <a href="${doc.file_url}" target="_blank" rel="noopener noreferrer" class="btn-doc-view">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Ver documento
        </a>
        <button class="btn-doc-delete" data-delete-id="${doc.id}" title="Eliminar documento">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>
  `).join('')}</div>`;

  // Bind delete buttons
  container.querySelectorAll<HTMLButtonElement>('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteId;
      if (!id || !confirm('¿Eliminar este documento? Tendrás que volver a subirlo.')) return;
      try {
        await routesService.deleteDocument(id);
        showToast('Documento eliminado.');
        const docs = await routesService.getDocuments();
        renderDocList(docs);
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Error al eliminar el documento.');
      }
    });
  });
}

let selectedFile: File | null = null;

async function initDocuments(): Promise<void> {
  try {
    const docs = await routesService.getDocuments();
    renderDocList(docs);
  } catch {
    const loading = $<HTMLDivElement>('#docs-loading');
    if (loading) loading.textContent = 'No se pudieron cargar los documentos.';
  }

  // Dropzone interactions
  const dropzone = $<HTMLDivElement>('#doc-dropzone');
  const fileInput = $<HTMLInputElement>('#doc-file-input');
  const fileField = $<HTMLDivElement>('#doc-file-field');
  const filePreview = $<HTMLDivElement>('#doc-file-preview');
  const typeSelect = $<HTMLSelectElement>('#doc-type-select');
  const uploadBtn = $<HTMLButtonElement>('#btn-upload-doc');

  // Show file field when type is selected
  if (typeSelect && fileField) {
    typeSelect.addEventListener('change', () => {
      fileField.hidden = !typeSelect.value;
    });
  }

  // Click dropzone
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFileSelect(file, filePreview, uploadBtn, typeSelect);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) handleFileSelect(file, filePreview, uploadBtn, typeSelect);
    });
  }

  if (uploadBtn) {
    uploadBtn.addEventListener('click', async () => {
      if (!selectedFile || !typeSelect?.value) return;
      const docType = typeSelect.value as 'licencia' | 'soat' | 'cedula' | 'foto_vehiculo';
      const originalHtml = uploadBtn.innerHTML;
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Subiendo...';

      try {
        const fileData = await fileToBase64(selectedFile);
        await routesService.uploadDocument({
          documentType: docType,
          fileName: selectedFile.name,
          fileData,
        });
        showToast('✅ Documento subido exitosamente. Será revisado pronto.');
        selectedFile = null;
        if (filePreview) filePreview.hidden = true;
        if (fileInput) fileInput.value = '';
        if (typeSelect) typeSelect.value = '';
        if (fileField) fileField.hidden = true;
        uploadBtn.disabled = true;
        // Reload list
        const docs = await routesService.getDocuments();
        renderDocList(docs);
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Error al subir el documento.');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = originalHtml;
      }
    });
  }
}

function handleFileSelect(
  file: File,
  preview: HTMLDivElement | null,
  uploadBtn: HTMLButtonElement | null,
  typeSelect: HTMLSelectElement | null,
): void {
  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    showToast('El archivo supera el límite de 5 MB.');
    return;
  }
  selectedFile = file;
  if (preview) {
    preview.hidden = false;
    preview.innerHTML = `<div class="doc-file-preview-item">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span>${file.name}</span>
      <small style="color:var(--text-faint);">${(file.size / 1024).toFixed(1)} KB</small>
    </div>`;
  }
  if (uploadBtn) uploadBtn.disabled = !(typeSelect?.value);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { void initProfile(); });
} else {
  void initProfile();
}

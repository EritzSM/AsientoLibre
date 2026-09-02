// =========================================================
// Asiento Libre — Lógica de Autenticación (Login & Sign-Up)
// =========================================================

import { setActiveUser } from "../../components/header/header";
import { authService } from "../../../core/services/auth.service";

interface VehicleData {
  brand: string;
  model: string;
  color: string;
  plate: string;
  documents: File[];
}

interface UserSignUp {
  firstName: string;
  lastName: string;
  nationalId: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: 'pasajero' | 'conductor';
  skipVehicle: boolean;
  vehicle?: VehicleData;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let uploadedDocuments: File[] = [];

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

// ---- Control de Tabs (Login vs Sign-up) ----
export function switchTab(mode: 'login' | 'signup'): void {
  hideError();
  const tabLogin = $<HTMLButtonElement>("#tab-login");
  const tabSignup = $<HTMLButtonElement>("#tab-signup");
  const formLogin = $<HTMLFormElement>("#form-login");
  const formSignup = $<HTMLFormElement>("#form-signup");
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
    if (formLogin) formLogin.hidden = false;
    if (formSignup) formSignup.hidden = true;
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
    if (formLogin) formLogin.hidden = true;
    if (formSignup) formSignup.hidden = false;
    if (title) title.innerHTML = 'Crea tu cuenta en <span>Asiento Libre</span>';
    if (subtitle) subtitle.textContent = 'Únete a nuestra comunidad de viajes compartidos';
  }
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

      // Actualizar icono SVG
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

      // Si es conductor, desplegamos la sección del vehículo; si es pasajero, la ocultamos
      if (vehicleSection) {
        if (role === 'conductor') {
          vehicleSection.hidden = false;
        } else {
          vehicleSection.hidden = true;
        }
      }
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

    // Evitar duplicados por nombre y tamaño
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

// ---- Manejo del Login ----
async function handleLoginSubmit(event: Event): Promise<void> {
  event.preventDefault();
  hideError();

  const form = $<HTMLFormElement>("#form-login");
  if (!form) return;

  const submitBtn = form.querySelector<HTMLButtonElement>(".btn-submit");
  const originalBtnHtml = submitBtn ? submitBtn.innerHTML : "";

  const data = new FormData(form);
  const email = String(data.get("email") ?? "").trim();
  const password = String(data.get("password") ?? "");

  if (!email || !password) {
    showError("Por favor ingresa tu correo y contraseña.");
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showError("Por favor ingresa un correo electrónico válido.");
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
    setActiveUser(response.user);

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

// ---- Manejo del Sign-Up ----
async function handleSignUpSubmit(event: Event): Promise<void> {
  event.preventDefault();
  hideError();

  const form = $<HTMLFormElement>("#form-signup");
  if (!form) return;

  const submitBtn = form.querySelector<HTMLButtonElement>(".btn-submit");
  const originalBtnHtml = submitBtn ? submitBtn.innerHTML : "";

  const data = new FormData(form);
  const role = (String(data.get("role") ?? "pasajero")) as 'pasajero' | 'conductor';
  const skipVehicle = Boolean(data.get("skipVehicle"));

  const payload: UserSignUp = {
    firstName: String(data.get("firstName") ?? "").trim(),
    lastName: String(data.get("lastName") ?? "").trim(),
    nationalId: String(data.get("nationalId") ?? "").trim(),
    email: String(data.get("email") ?? "").trim(),
    password: String(data.get("password") ?? ""),
    confirmPassword: String(data.get("confirmPassword") ?? ""),
    role,
    skipVehicle,
  };

  // Validaciones del usuario
  if (!payload.firstName || !payload.lastName || !payload.nationalId || !payload.email || !payload.password) {
    showError("Por favor completa todos los campos obligatorios del usuario.");
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(payload.email)) {
    showError("Por favor ingresa un correo electrónico válido.");
    return;
  }

  if (payload.password.length < 6) {
    showError("La contraseña debe tener al menos 6 caracteres.");
    return;
  }

  if (payload.password !== payload.confirmPassword) {
    showError("Las contraseñas no coinciden. Por favor verifícalas.");
    return;
  }

  let vehicleData: VehicleData | undefined = undefined;

  // Si es conductor y NO seleccionó omitir vehículo:
  if (role === 'conductor' && !skipVehicle) {
    const brand = String(data.get("vehicleBrand") ?? "").trim();
    const model = String(data.get("vehicleModel") ?? "").trim();
    const color = String(data.get("vehicleColor") ?? "").trim();
    const plate = String(data.get("vehiclePlate") ?? "").trim().toUpperCase();

    // Si llenó al menos un campo del vehículo pero le faltan los otros:
    if (brand || model || color || plate) {
      if (!brand || !model || !color || !plate) {
        showError("Por favor completa los datos de tu vehículo (Marca, Modelo, Color y Placa) o marca 'Agregar después'.");
        return;
      }
    }

    if (brand && model && color && plate) {
      vehicleData = {
        brand,
        model,
        color,
        plate,
        documents: uploadedDocuments,
      };
      payload.vehicle = vehicleData;
    }
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
      email: payload.email,
      password: payload.password,
      role: payload.role,
      skipVehicle: payload.skipVehicle,
      vehicle: vehicleData ? {
        brand: vehicleData.brand,
        model: vehicleData.model,
        color: vehicleData.color,
        plate: vehicleData.plate,
      } : undefined,
    });

    setActiveUser(response.user);

    const roleMsg = role === 'conductor' 
      ? (skipVehicle ? " (Conductor - Vehículo pendiente)" : " (Conductor verificado)") 
      : " (Pasajero)";

    showToast(`¡Cuenta creada con éxito! Bienvenido ${response.user.firstName}${roleMsg}...`);
    setTimeout(() => {
      window.location.href = "/index.html";
    }, 1200);
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

// ---- Inicialización ----
function initAuth(): void {
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
  }
  if (formSignup) {
    formSignup.addEventListener("submit", handleSignUpSubmit);
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
  }
}

// Ejecutar inmediatamente si el DOM ya cargó, o esperar al evento
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuth);
} else {
  initAuth();
}

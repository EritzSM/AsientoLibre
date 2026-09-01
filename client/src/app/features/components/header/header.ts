// =========================================================
// Header Component Logic (Gestión de Sesión y Perfil)
// =========================================================

export interface AuthUser {
  id: string;
  firstName: string;
  lastName: string;
  nationalId?: string;
  email: string;
  role: 'pasajero' | 'conductor';
  skipVehicle?: boolean;
  vehicle?: {
    brand: string;
    model: string;
    color: string;
    plate: string;
  };
}

const STORAGE_KEY = "asiento_libre_user";

export function getActiveUser(): AuthUser | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function setActiveUser(user: AuthUser): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function logoutUser(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function initHeader(): void {
  const loginBtn = document.querySelector<HTMLAnchorElement>("#btn-login");
  const profileMenu = document.querySelector<HTMLDivElement>("#user-profile-menu");
  const profileBtn = document.querySelector<HTMLButtonElement>("#user-profile-btn");
  const profileDropdown = document.querySelector<HTMLDivElement>("#profile-dropdown");
  const headerAvatar = document.querySelector<HTMLSpanElement>("#header-user-avatar");
  const headerName = document.querySelector<HTMLSpanElement>("#header-user-name");
  const dropdownName = document.querySelector<HTMLParagraphElement>("#dropdown-user-name");
  const dropdownRole = document.querySelector<HTMLSpanElement>("#dropdown-user-role");
  const logoutBtn = document.querySelector<HTMLButtonElement>("#btn-logout");
  const viewProfileBtn = document.querySelector<HTMLAnchorElement>("#btn-view-profile");

  const user = getActiveUser();

  if (user && profileMenu && loginBtn) {
    // Usuario autenticado: Ocultar botón de login y mostrar perfil
    loginBtn.style.display = "none";
    profileMenu.style.display = "inline-block";

    const fullName = `${user.firstName} ${user.lastName}`.trim();
    const initials = getInitials(fullName || user.email);

    if (headerAvatar) headerAvatar.textContent = initials;
    if (headerName) headerName.textContent = user.firstName || "Mi Perfil";
    if (dropdownName) dropdownName.textContent = fullName || user.email;
    if (dropdownRole) {
      dropdownRole.textContent = user.role === 'conductor' ? '🚗 Conductor' : '👤 Pasajero';
    }

    // Toggle dropdown
    if (profileBtn && profileDropdown) {
      profileBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isHidden = profileDropdown.hidden;
        profileDropdown.hidden = !isHidden;
        profileBtn.setAttribute("aria-expanded", String(!isHidden));
      });

      // Cerrar dropdown al hacer clic fuera
      document.addEventListener("click", (e) => {
        if (!profileMenu.contains(e.target as Node)) {
          profileDropdown.hidden = true;
          profileBtn.setAttribute("aria-expanded", "false");
        }
      });
    }

    // Cerrar sesión
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        logoutUser();
      });
    }

    // Navegar a la página de Perfil
    if (viewProfileBtn) {
      viewProfileBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.location.href = "/profile.html";
      });
    }

    // Si está en el formulario de publicar ruta en Home, podemos sugerir el nombre del conductor
    const driverInput = document.querySelector<HTMLInputElement>("#driver-name");
    if (driverInput && !driverInput.value) {
      driverInput.value = fullName;
    }

  } else if (loginBtn && profileMenu) {
    // Usuario no autenticado: Mostrar botón de login y ocultar perfil
    loginBtn.style.display = "inline-flex";
    profileMenu.style.display = "none";
  }
}

// Modal interactivo de información del perfil
function showProfileModal(user: AuthUser): void {
  const existingModal = document.querySelector("#user-profile-modal-view");
  if (existingModal) existingModal.remove();

  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const initials = getInitials(fullName || user.email);
  const vehicleInfo = user.vehicle 
    ? `${user.vehicle.brand} ${user.vehicle.model} (${user.vehicle.plate})`
    : (user.role === 'conductor' ? 'Pendiente por registrar' : 'No aplica (Pasajero)');

  const modal = document.createElement("div");
  modal.id = "user-profile-modal-view";
  modal.className = "profile-modal";
  modal.innerHTML = `
    <div class="profile-modal-card">
      <button class="modal-close" id="profile-modal-close" type="button" aria-label="Cerrar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
      </button>

      <div class="profile-modal-header">
        <div class="profile-modal-avatar">${initials}</div>
        <div>
          <h3 class="profile-modal-title">${fullName}</h3>
          <span class="dropdown-user-role" style="margin-top:2px;">${user.role === 'conductor' ? '🚗 Conductor' : '👤 Pasajero'}</span>
        </div>
      </div>

      <div class="profile-info-list">
        <div class="profile-info-item">
          <span class="profile-info-label">Correo electrónico:</span>
          <span class="profile-info-value">${user.email}</span>
        </div>
        ${user.nationalId ? `
          <div class="profile-info-item">
            <span class="profile-info-label">Documento de identidad:</span>
            <span class="profile-info-value">${user.nationalId}</span>
          </div>
        ` : ''}
        <div class="profile-info-item">
          <span class="profile-info-label">Vehículo:</span>
          <span class="profile-info-value">${vehicleInfo}</span>
        </div>
      </div>

      <button class="btn btn-primary btn-block" id="profile-modal-ok" type="button">Entendido</button>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector("#profile-modal-close")?.addEventListener("click", closeModal);
  modal.querySelector("#profile-modal-ok")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
}

import { authService } from "../../../core/services/auth.service";
import type { AuthUser } from "../../../core/services/auth.service";
export type { AuthUser } from "../../../core/services/auth.service";

let activeUser: AuthUser | null = null;

/** Cached presentation data only. Authorization always comes from /auth/me. */
export function getActiveUser(): AuthUser | null {
  return activeUser;
}
export function setActiveUser(user: AuthUser): void {
  activeUser = user;
}

export function logoutUser(): void {
  activeUser = null;
  localStorage.removeItem("asiento_libre_token");
  window.location.href = "/index.html";
}

export async function initHeader(
  verifiedUser?: AuthUser | null,
): Promise<AuthUser | null> {
  const user =
    verifiedUser === undefined
      ? authService.getToken()
        ? await authService.getMe()
        : null
      : verifiedUser;
  if (user) setActiveUser(user);
  const login = document.querySelector<HTMLElement>("#btn-login");
  const menu = document.querySelector<HTMLElement>("#user-profile-menu");
  if (login) login.style.display = user ? "none" : "inline-flex";
  if (menu) menu.style.display = user ? "inline-block" : "none";
  if (!user) return null;

  const name = [user.firstName, user.lastName].join(" ").trim() || user.email;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const values: Record<string, string> = {
    "header-user-avatar": initials,
    "header-user-name": user.firstName || "Mi perfil",
    "dropdown-user-name": name,
    "dropdown-user-role": user.role === "conductor" ? "Conductor" : "Pasajero",
  };
  Object.entries(values).forEach(([id, value]) => {
    const target = document.getElementById(id);
    if (target) target.textContent = value;
  });
  const button = document.querySelector<HTMLButtonElement>("#user-profile-btn");
  const dropdown = document.querySelector<HTMLElement>("#profile-dropdown");
  if (button && dropdown) {
    button.onclick = () => {
      dropdown.hidden = !dropdown.hidden;
      button.setAttribute("aria-expanded", String(!dropdown.hidden));
    };
    document.addEventListener("click", (event) => {
      if (!menu?.contains(event.target as Node)) {
        dropdown.hidden = true;
        button.setAttribute("aria-expanded", "false");
      }
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        dropdown.hidden = true;
        button.setAttribute("aria-expanded", "false");
      }
    });
  }
  const logout = document.querySelector<HTMLButtonElement>("#btn-logout");
  if (logout) logout.onclick = logoutUser;
  return user;
}

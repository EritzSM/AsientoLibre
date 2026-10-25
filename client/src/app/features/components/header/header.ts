import { authService } from "../../../core/services/auth.service";
import type { AuthUser } from "../../../core/services/auth.service";
import type { Notification } from "../../../core/services/routes.service";
import { routesService } from "../../../core/services/routes.service";
import { escapeHtml } from "../../../core/dom";
export type { AuthUser } from "../../../core/services/auth.service";

let activeUser: AuthUser | null = null;
let notifPanelOpen = false;
let allNotifications: Notification[] = [];
let bellInitialized = false;

/** Cached presentation data only. Authorization always comes from /auth/me. */
export function getActiveUser(): AuthUser | null {
  return activeUser;
}
export function setActiveUser(user: AuthUser): void {
  activeUser = user;
}

export function clearActiveUser(): void {
  activeUser = null;
}

export function logoutUser(): void {
  clearActiveUser();
  localStorage.removeItem("asiento_libre_token");
  window.location.href = "/index.html";
}

// ─── Helpers de iconos por tipo ───────────────────────────────────────────────
function notifIcon(type: string): string {
  if (type.includes("reject") || type.includes("cancel")) return "🚫";
  if (type.includes("accept") || type.includes("confirm")) return "✅";
  if (type.includes("time_changed")) return "⏰";
  if (type.includes("booking_requested") || type.includes("new_booking")) return "🔔";
  return "📢";
}

function notifItemClass(type: string): string {
  if (type.includes("reject") || type.includes("cancel")) return "notif-item--cancelled";
  if (type.includes("accept") || type.includes("confirm")) return "notif-item--accepted";
  return "";
}

function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days} día${days > 1 ? "s" : ""}`;
}

// ─── Renderizar el panel de notificaciones ────────────────────────────────────
export function renderNotifPanel(notifications: Notification[]): void {
  allNotifications = notifications;
  const panel = document.getElementById("notif-panel-body");
  const empty = document.getElementById("notif-panel-empty");
  const badge = document.getElementById("notif-badge");
  const bellBtn = document.getElementById("notif-bell-btn");

  if (!panel) return;

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  // Badge
  if (badge) {
    if (unreadCount > 0) {
      badge.removeAttribute("hidden");
      badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    } else {
      badge.setAttribute("hidden", "");
    }
  }

  // Animación campana cuando hay no leídas
  if (bellBtn) {
    if (unreadCount > 0) {
      bellBtn.classList.add("notif-has-unread");
    } else {
      bellBtn.classList.remove("notif-has-unread");
    }
  }

  if (!notifications.length) {
    if (empty) empty.removeAttribute("hidden");
    panel.innerHTML = "";
    return;
  }
  if (empty) empty.setAttribute("hidden", "");

  // Ordenar: no leídas primero, luego por fecha
  const sorted = [...notifications].sort((a, b) => {
    if (!!a.readAt !== !!b.readAt) return a.readAt ? 1 : -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  panel.innerHTML = sorted.map((notif) => {
    const unread = !notif.readAt;
    const icon = notifIcon(notif.type);
    const itemClass = notifItemClass(notif.type);
    const time = relativeTime(notif.createdAt);
    return `<div class="notif-item ${unread ? "notif-item--unread" : ""} ${itemClass}" data-notif-id="${escapeHtml(notif.id)}" data-notif-unread="${unread ? "true" : "false"}">
      <div class="notif-item-icon" aria-hidden="true">${icon}</div>
      <div class="notif-item-body">
        <div class="notif-item-title">${escapeHtml(notif.title)}</div>
        <div class="notif-item-msg">${escapeHtml(notif.message)}</div>
        <time class="notif-item-time" datetime="${escapeHtml(notif.createdAt)}">${escapeHtml(time)}</time>
      </div>
      <div class="notif-item-actions">
        ${unread ? `<button class="notif-action-btn notif-read-btn" data-notif-read="${escapeHtml(notif.id)}" title="Marcar como leída" aria-label="Marcar como leída">✓</button>` : ""}
        <button class="notif-action-btn notif-delete-btn" data-notif-delete="${escapeHtml(notif.id)}" title="Eliminar notificación" aria-label="Eliminar notificación">✕</button>
      </div>
    </div>`;
  }).join("");
}

// ─── Inicializar la campana ───────────────────────────────────────────────────
function initBell(): void {
  if (bellInitialized) return;
  bellInitialized = true;

  const wrapper = document.getElementById("notif-bell-wrapper");
  const bellBtn = document.getElementById("notif-bell-btn");
  const panel = document.getElementById("notif-panel");
  const markAllBtn = document.getElementById("notif-mark-all-btn");
  const body = document.getElementById("notif-panel-body");

  if (!wrapper || !bellBtn || !panel) return;

  // Abrir / cerrar panel
  bellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    notifPanelOpen = !notifPanelOpen;
    panel.hidden = !notifPanelOpen;
    bellBtn.setAttribute("aria-expanded", String(notifPanelOpen));
  });

  // Cerrar al hacer click fuera
  document.addEventListener("click", (e) => {
    if (notifPanelOpen && !wrapper.contains(e.target as Node)) {
      notifPanelOpen = false;
      panel.hidden = true;
      bellBtn.setAttribute("aria-expanded", "false");
    }
  });

  // Cerrar con Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && notifPanelOpen) {
      notifPanelOpen = false;
      panel.hidden = true;
      bellBtn.setAttribute("aria-expanded", "false");
      bellBtn.focus();
    }
  });

  // Marcar todas como leídas
  if (markAllBtn) {
    markAllBtn.addEventListener("click", async () => {
      const unread = allNotifications.filter((n) => !n.readAt);
      if (!unread.length) return;
      await Promise.allSettled(unread.map((n) => routesService.markRead(n.id)));
      const fresh = await routesService.notifications();
      renderNotifPanel(fresh);
    });
  }

  // Delegación de clicks en items (marcar leída / eliminar)
  if (body) {
    body.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;

      // Botón Eliminar
      const deleteBtn = target.closest<HTMLButtonElement>("[data-notif-delete]");
      if (deleteBtn?.dataset.notifDelete) {
        e.stopPropagation();
        const id = deleteBtn.dataset.notifDelete;
        deleteBtn.disabled = true;
        try {
          await routesService.deleteNotification(id);
          allNotifications = allNotifications.filter((n) => n.id !== id);
          renderNotifPanel(allNotifications);
        } catch {
          deleteBtn.disabled = false;
        }
        return;
      }

      // Botón Marcar leída
      const readBtn = target.closest<HTMLButtonElement>("[data-notif-read]");
      if (readBtn?.dataset.notifRead) {
        e.stopPropagation();
        const id = readBtn.dataset.notifRead;
        readBtn.disabled = true;
        try {
          await routesService.markRead(id);
          const fresh = await routesService.notifications();
          renderNotifPanel(fresh);
        } catch {
          readBtn.disabled = false;
        }
        return;
      }

      // Clic en el cuerpo del item para marcar como leída
      const item = target.closest<HTMLElement>(".notif-item");
      if (item?.dataset.notifId && item.dataset.notifUnread === "true") {
        const id = item.dataset.notifId;
        try {
          await routesService.markRead(id);
          const fresh = await routesService.notifications();
          renderNotifPanel(fresh);
        } catch {}
      }
    });
  }
}

// ─── initHeader ───────────────────────────────────────────────────────────────
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
  const bellWrapper = document.querySelector<HTMLElement>("#notif-bell-wrapper");

  if (login) login.style.display = user ? "none" : "inline-flex";
  if (menu) menu.style.display = user ? "inline-block" : "none";
  if (bellWrapper) bellWrapper.style.display = user ? "flex" : "none";

  if (!user) return null;

  const favoritesLink = document.querySelector<HTMLElement>('#nav-rutas-favoritas-header');
  if (favoritesLink) favoritesLink.hidden = user.role !== 'pasajero';

  // Cargar notificaciones para la campana de inmediato si hay usuario autenticado
  routesService.notifications()
    .then((notifs) => renderNotifPanel(notifs))
    .catch((err) => console.warn('[Header Notif]', err));

  const name = [user.firstName, user.lastName].join(" ").trim() || user.email;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const values: Record<string, string> = {
    "header-user-name": user.firstName || "Mi perfil",
    "dropdown-user-name": name,
    "dropdown-user-role": user.role === "conductor" ? "Conductor" : "Pasajero",
  };
  Object.entries(values).forEach(([id, value]) => {
    const target = document.getElementById(id);
    if (target) target.textContent = value;
  });
  const avatar = document.querySelector<HTMLElement>("#header-user-avatar");
  if (avatar) {
    avatar.replaceChildren(document.createTextNode(initials));
    if (user.photoUrl) {
      const image = document.createElement("img");
      image.className = "avatar-photo";
      image.src = user.photoUrl;
      image.alt = "";
      image.setAttribute("aria-hidden", "true");
      image.addEventListener("error", () => image.remove(), { once: true });
      avatar.append(image);
    }
  }
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

  // Inicializar campana
  initBell();

  return user;
}

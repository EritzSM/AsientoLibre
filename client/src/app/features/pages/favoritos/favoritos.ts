import { initHeader } from '../../components/header/header';
import type { AuthUser } from '../../../core/services/auth.service';
import { authService } from '../../../core/services/auth.service';
import { routesService } from '../../../core/services/routes.service';
import type { Route, FavoriteRoute, Promotion } from '../../../core/services/routes.service';
import { element as $, escapeHtml as escape, errorMessage, statusMessage } from '../../../core/dom';

let user: AuthUser | null = null;
let favorites: FavoriteRoute[] = [];
let searchResults: Route[] = [];
let promotions: Promotion[] = [];
let activeReservation: Route | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const priceFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });

function toast(message: string): void {
  statusMessage('#toast', message);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => statusMessage('#toast', ''), 5500);
}

function dateLabel(date: string): string {
  return new Date(date + 'T12:00:00-05:00').toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function promotionDiscount(promotion: Promotion): string {
  return promotion.discountType === 'percentage'
    ? `${promotion.discountValue}%`
    : priceFormatter.format(promotion.discountValue);
}

function routeWithinFiveMinutes(route: { date: string; time: string }): boolean {
  const departureMs = new Date(`${route.date}T${route.time}:00-05:00`).getTime();
  return departureMs - Date.now() <= 5 * 60 * 1000;
}

function isRouteSaved(origin: string, destination: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return favorites.some((f) => norm(f.origin) === norm(origin) && norm(f.destination) === norm(destination));
}

function bindAvatarFallbacks(container: HTMLElement): void {
  container.querySelectorAll<HTMLImageElement>('.avatar-photo').forEach((image) => {
    image.addEventListener('error', () => image.remove(), { once: true });
  });
}

// ─── Render Rutas Favoritas Guardadas ──────────────────────────────────────────
function renderFavorites(): void {
  const list = $('#favorites-list');
  if (!favorites.length) {
    list.innerHTML = '';
    $('#favorites-empty').hidden = false;
    return;
  }
  $('#favorites-empty').hidden = true;

  list.innerHTML = favorites.map((favorite) => {
    const hasDepartures = favorite.availableRoutes && favorite.availableRoutes.length > 0;
    const departuresHtml = hasDepartures
      ? `<div class="favorite-available-routes" style="margin-top: 14px;">
          <h4 style="font-size: 0.95rem; font-weight: 700; color: var(--navy, #0B1E3B); margin: 0 0 10px;">Próximas salidas disponibles:</h4>
          ${favorite.availableRoutes.map((route) => {
            const withinFive = routeWithinFiveMinutes(route);
            const initials = escape(route.driverName.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase());
            return `<article class="route-card" style="margin-bottom: 10px; border-left: 4px solid var(--teal, #17BFAC);">
              <div class="route-card-top">
                <div class="driver">
                  <span class="avatar" aria-hidden="true">${initials}${route.driverPhotoUrl ? `<img class="avatar-photo" src="${escape(route.driverPhotoUrl)}" alt="" />` : ''}</span>
                  <div><div class="driver-name">${escape(route.driverName)}</div><div class="driver-role">Conductor</div></div>
                </div>
                <span class="price-pill">${escape(priceFormatter.format(route.price ?? 0))} / asiento</span>
              </div>
              <div class="route-meta" style="margin: 8px 0;">
                <span>📅 ${escape(dateLabel(route.date))}</span>
                <span>⏰ ${escape(route.time)} (Colombia)</span>
                <span>💺 ${escape(route.availableSeats)} cupo(s) libre(s)</span>
              </div>
              ${route.meetingPoint ? `<p class="meeting-point" style="margin: 0 0 10px;">Encuentro: ${escape(route.meetingPoint)}</p>` : ''}
              <div style="display: flex; justify-content: flex-end;">
                ${withinFive
                  ? '<span class="hint warning-text">Faltan menos de 5 min para la salida</span>'
                  : `<button type="button" class="btn btn-primary btn-sm" data-reserve="${escape(route.id)}">Solicitar cupo</button>`
                }
              </div>
            </article>`;
          }).join('')}
        </div>`
      : `<div class="favorite-no-routes" style="margin-top: 12px;">
          <strong>Sin salidas programadas por ahora</strong>
          <span>No hay conductores con cupos disponibles en este momento. Vuelve a consultar pronto o revisa otras fechas.</span>
        </div>`;

    return `<article class="favorite-journey" data-favorite-id="${escape(favorite.id)}">
      <div class="favorite-journey-heading">
        <div>
          <span class="favorite-eyebrow">Trayecto frecuente</span>
          <h3 style="font-size: 1.25rem; font-weight: 800; color: var(--navy, #0B1E3B); margin: 4px 0 6px;">
            ${escape(favorite.origin)} <span aria-hidden="true" style="color: var(--teal, #17BFAC);">→</span> ${escape(favorite.destination)}
          </h3>
          <p class="muted" style="font-size: 0.85rem;">Guardada el ${new Date(favorite.createdAt).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium' })}</p>
        </div>
        <button type="button" class="favorite-remove btn btn-secondary btn-sm" data-remove-favorite="${escape(favorite.id)}">
          ✕ Quitar de favoritos
        </button>
      </div>
      ${departuresHtml}
    </article>`;
  }).join('');

  bindAvatarFallbacks(list);
}

async function loadFavorites(silent = false): Promise<void> {
  if (user?.role !== 'pasajero') return;
  const button = $<HTMLButtonElement>('#refresh-favorites');
  if (!silent) {
    button.disabled = true;
    statusMessage('#favorites-error', '');
  }
  try {
    favorites = await routesService.favorites();
    renderFavorites();
  } catch (error) {
    if (!silent) statusMessage('#favorites-error', errorMessage(error));
  } finally {
    if (!silent) button.disabled = false;
  }
}

// ─── Render Buscador para Agregar a Favoritos ─────────────────────────────────
function renderSearchResults(): void {
  const container = $('#search-fav-results');
  if (!searchResults.length) {
    container.innerHTML = '';
    $('#search-fav-empty').hidden = false;
    return;
  }
  $('#search-fav-empty').hidden = true;

  container.innerHTML = searchResults.map((route) => {
    const alreadySaved = isRouteSaved(route.origin, route.destination);
    const initials = escape(route.driverName.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase());
    return `<article class="route-card" data-id="${escape(route.id)}">
      <div class="route-card-top">
        <div class="driver">
          <span class="avatar" aria-hidden="true">${initials}${route.driverPhotoUrl ? `<img class="avatar-photo" src="${escape(route.driverPhotoUrl)}" alt="" />` : ''}</span>
          <div><div class="driver-name">${escape(route.driverName)}</div><div class="driver-role">Conductor</div></div>
        </div>
        <span class="price-pill">${escape(priceFormatter.format(route.price ?? 0))} / asiento</span>
      </div>
      <div class="route-points">
        <div class="route-point"><div><div class="route-point-label">Desde</div><div class="route-point-value">${escape(route.origin)}</div></div></div>
        <div class="route-connector"></div>
        <div class="route-point"><div><div class="route-point-label">Hasta</div><div class="route-point-value">${escape(route.destination)}</div></div></div>
      </div>
      <div class="route-meta">
        <span>${escape(dateLabel(route.date))}</span>
        <span>${escape(route.time)} · Colombia</span>
        <span>${escape(route.availableSeats)} de ${escape(route.seats)} cupos libres</span>
      </div>
      <div style="margin-top: 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
        <button type="button" class="btn ${alreadySaved ? 'btn-secondary' : 'btn-primary'}" data-add-fav="${escape(route.id)}" ${alreadySaved ? 'disabled' : ''}>
          ${alreadySaved ? '★ Ya está en tus favoritos' : '★ Guardar trayecto en favoritos'}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" data-reserve="${escape(route.id)}">
          Solicitar cupo
        </button>
      </div>
    </article>`;
  }).join('');

  bindAvatarFallbacks(container);
}

async function searchRoutesToFavorite(event?: SubmitEvent): Promise<void> {
  if (event) event.preventDefault();
  const origin = $<HTMLInputElement>('#search-fav-origin').value.trim();
  const destination = $<HTMLInputElement>('#search-fav-destination').value.trim();
  const submitBtn = $<HTMLButtonElement>('#search-fav-submit');
  submitBtn.disabled = true;
  $('#search-fav-loading').hidden = false;
  statusMessage('#search-fav-error', '');

  try {
    searchResults = await routesService.search({ origin, destination });
    renderSearchResults();
  } catch (error) {
    statusMessage('#search-fav-error', errorMessage(error));
  } finally {
    submitBtn.disabled = false;
    $('#search-fav-loading').hidden = true;
  }
}

// ─── Modal de Reserva ─────────────────────────────────────────────────────────
function renderReservationTotal(): void {
  if (!activeReservation) return;
  const seats = Number($<HTMLInputElement>('#reserve-seats').value);
  if (!Number.isInteger(seats) || seats < 1 || seats > activeReservation.availableSeats) {
    $('#reserve-subtotal').textContent = '—';
    $('#reserve-discount').textContent = '—';
    $('#reserve-discount-row').hidden = true;
    $('#reserve-total').textContent = '—';
    return;
  }
  const subtotal = Math.round(activeReservation.price * seats * 100) / 100;
  const selectedId = $<HTMLSelectElement>('#reserve-promotion').value;
  const promotion = promotions.find((item) => item.id === selectedId);
  const discount = promotion
    ? Math.min(subtotal, promotion.discountType === 'percentage'
      ? Math.round(subtotal * promotion.discountValue) / 100
      : promotion.discountValue)
    : 0;
  $('#reserve-subtotal').textContent = priceFormatter.format(subtotal);
  $('#reserve-discount').textContent = `−${priceFormatter.format(discount)}`;
  $('#reserve-discount-row').hidden = discount <= 0;
  $('#reserve-total').textContent = priceFormatter.format(Math.max(0, subtotal - discount));
}

function openReservation(id: string): void {
  const allAvailable = [
    ...searchResults,
    ...favorites.flatMap((f) => f.availableRoutes || []),
  ];
  const route = allAvailable.find((r) => r.id === id);
  if (!route) return;

  if (routeWithinFiveMinutes(route)) {
    toast('No se pueden solicitar cupos si faltan menos de 5 minutos para la salida.');
    return;
  }

  activeReservation = route;
  $('#reserve-route').textContent = `${route.origin} → ${route.destination}`;
  $('#reserve-hint').textContent = `${route.availableSeats} cupos disponibles. Solicitud a nombre de ${user?.firstName} ${user?.lastName}.`;
  const seats = $<HTMLInputElement>('#reserve-seats');
  seats.value = '1';
  seats.max = String(route.availableSeats);
  const promotionField = $<HTMLElement>('#reserve-promotion-field');
  const promotionSelect = $<HTMLSelectElement>('#reserve-promotion');
  promotionField.hidden = promotions.length === 0;
  promotionSelect.innerHTML = '<option value="">Sin promoción</option>' + promotions.map((promotion) =>
    `<option value="${escape(promotion.id)}">${escape(promotion.title)} · ${escape(promotionDiscount(promotion))}${promotion.code ? ` · ${escape(promotion.code)}` : ''}</option>`,
  ).join('');
  promotionSelect.value = '';
  renderReservationTotal();
  statusMessage('#reserve-error', '');
  $<HTMLDialogElement>('#reserve-dialog').showModal();
  seats.focus();
}

async function reserve(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const button = $<HTMLButtonElement>('#reserve-submit');
  if (!activeReservation || button.disabled) return;
  const seats = Number($<HTMLInputElement>('#reserve-seats').value);
  if (!Number.isInteger(seats) || seats < 1 || seats > activeReservation.availableSeats) {
    statusMessage('#reserve-error', `Elige entre 1 y ${activeReservation.availableSeats} asientos.`);
    return;
  }
  button.disabled = true;
  $<HTMLButtonElement>('#reserve-close').disabled = true;
  try {
    const promotionId = $<HTMLSelectElement>('#reserve-promotion').value || null;
    await routesService.reserve(activeReservation.id, seats, promotionId);
    $<HTMLDialogElement>('#reserve-dialog').close();
    toast('Solicitud enviada. El conductor recibirá la notificación.');
    activeReservation = null;
    await loadFavorites(true);
  } catch (error) {
    statusMessage('#reserve-error', errorMessage(error));
  } finally {
    button.disabled = false;
    $<HTMLButtonElement>('#reserve-close').disabled = false;
  }
}

// ─── Inicialización ───────────────────────────────────────────────────────────
async function init(): Promise<void> {
  const token = authService.getToken();
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  try {
    user = await authService.getMe();
    await initHeader(user);
  } catch {
    window.location.href = '/login.html';
    return;
  }

  if (user.role !== 'pasajero') {
    statusMessage('#favorites-error', 'La sección de rutas favoritas está disponible para cuentas de pasajero.');
    return;
  }

  // Cargar promociones activas para el modal de reserva
  try {
    promotions = await routesService.activePromotions();
  } catch {}

  $('#search-favorite-form').addEventListener('submit', (event) => {
    void searchRoutesToFavorite(event as SubmitEvent);
  });

  $('#refresh-favorites').addEventListener('click', () => { void loadFavorites(); });

  $('#reserve-form').addEventListener('submit', (event) => { void reserve(event as SubmitEvent); });
  $('#reserve-seats').addEventListener('input', renderReservationTotal);
  $('#reserve-promotion').addEventListener('change', renderReservationTotal);
  $('#reserve-close').addEventListener('click', () => $<HTMLDialogElement>('#reserve-dialog').close());

  // Delegación de clicks en resultados de búsqueda (guardar / reservar)
  $('#search-fav-results').addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const addBtn = target.closest<HTMLButtonElement>('[data-add-fav]');
    const reserveBtn = target.closest<HTMLButtonElement>('[data-reserve]');

    if (addBtn?.dataset.addFav) {
      const routeId = addBtn.dataset.addFav;
      addBtn.disabled = true;
      try {
        await routesService.saveFavorite(routeId);
        toast('Trayecto guardado en tus favoritos.');
        await loadFavorites(true);
        renderSearchResults();
      } catch (error) {
        toast(errorMessage(error));
        addBtn.disabled = false;
      }
      return;
    }

    if (reserveBtn?.dataset.reserve) {
      openReservation(reserveBtn.dataset.reserve);
    }
  });

  // Delegación de clicks en favoritos guardados (quitar / reservar)
  $('#favorites-list').addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const removeBtn = target.closest<HTMLButtonElement>('[data-remove-favorite]');
    const reserveBtn = target.closest<HTMLButtonElement>('[data-reserve]');

    if (removeBtn?.dataset.removeFavorite) {
      const favoriteId = removeBtn.dataset.removeFavorite;
      removeBtn.disabled = true;
      try {
        await routesService.removeFavorite(favoriteId);
        toast('Ruta eliminada de tus favoritos.');
        await loadFavorites(true);
        renderSearchResults();
      } catch (error) {
        toast(errorMessage(error));
        removeBtn.disabled = false;
      }
      return;
    }

    if (reserveBtn?.dataset.reserve) {
      openReservation(reserveBtn.dataset.reserve);
    }
  });

  // Carga inicial
  await Promise.allSettled([
    loadFavorites(),
    searchRoutesToFavorite(),
  ]);
}

void init();

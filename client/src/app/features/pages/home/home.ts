import { initHeader, renderNotifPanel } from '../../components/header/header';
import type { AuthUser } from '../../../core/services/auth.service';
import { authService } from '../../../core/services/auth.service';
import { routesService } from '../../../core/services/routes.service';
import type { Route, RegisteredVehicle, CreateRoute, RatingTarget, Notification, Promotion, FavoriteRoute } from '../../../core/services/routes.service';
import { remindersService, enablePushNotifications } from '../../../core/services/reminders.service';
import type { AttendanceStatus, TripReminder } from '../../../core/services/reminders.service';
import { showInAppPush } from '../../../core/in-app-push';
import { quickActionsFor } from '../../../core/visual-navigation';
import { colombiaDate, validateRoute } from '../../../core/route-validation';
import { element as $, escapeHtml as escape, errorMessage, statusMessage } from '../../../core/dom';

let user: AuthUser | null = null;
let vehicle: RegisteredVehicle | null = null;
let publicRoutes: Route[] = [];
let promotions: Promotion[] = [];
let favorites: FavoriteRoute[] = [];
let tripReminders: TripReminder[] = [];
let activeReservation: Route | null = null;
let activeSurvey: { routeId: string; targets: RatingTarget[] } | null = null;
let surveySubmitting = false;
let searchVersion = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let notificationRequest = false;
const seenNotificationIds = new Set<string>();
let notificationsInitialized = false;
const ROUTES_PER_PAGE = 6;
let currentRoutesPage = 1;
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

function promotionDateLabel(value: string): string {
  return new Date(value).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function promotionDiscount(promotion: Promotion): string {
  return promotion.discountType === 'percentage'
    ? `${promotion.discountValue}%`
    : priceFormatter.format(promotion.discountValue);
}

function renderPromotions(): void {
  const list = $('#promotions-list');
  list.innerHTML = promotions.map((promotion) => `<article class="promotion-card">
    <div class="promotion-card-heading">
      <span class="promotion-discount">${escape(promotionDiscount(promotion))} de descuento</span>
      ${promotion.code ? `<code class="promotion-code">${escape(promotion.code)}</code>` : ''}
    </div>
    <h3>${escape(promotion.title)}</h3>
    <p>${escape(promotion.description)}</p>
    <p class="promotion-validity">Vigencia: ${escape(promotionDateLabel(promotion.startsAt))} – ${escape(promotionDateLabel(promotion.endsAt))} (Colombia)</p>
  </article>`).join('');
  $('#promotions-empty').hidden = promotions.length > 0;
}

async function loadPromotions(): Promise<void> {
  statusMessage('#promotions-error', '');
  try {
    promotions = await routesService.activePromotions();
    renderPromotions();
  } catch (error) {
    promotions = [];
    renderPromotions();
    statusMessage('#promotions-error', errorMessage(error));
  }
}

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

function routeHasStarted(route: Route): boolean {
  return new Date(`${route.date}T${route.time}:00-05:00`).getTime() <= Date.now();
}

function routeWithinFiveMinutes(route: { date: string; time: string }): boolean {
  const departureMs = new Date(`${route.date}T${route.time}:00-05:00`).getTime();
  return departureMs - Date.now() <= 5 * 60 * 1000;
}

function journeyKey(origin: string, destination: string): string {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
  return `${normalize(origin)}->${normalize(destination)}`;
}

function favoriteFor(origin: string, destination: string): FavoriteRoute | undefined {
  const target = journeyKey(origin, destination);
  return favorites.find((item) => journeyKey(item.origin, item.destination) === target);
}

function favoriteButton(routeId: string, origin: string, destination: string): string {
  if (user?.role !== 'pasajero') return '';
  const favorite = favoriteFor(origin, destination);
  return `<button type="button" class="favorite-toggle ${favorite ? 'favorite-toggle--active' : ''}"
    data-favorite-route="${escape(routeId)}" data-favorite-id="${escape(favorite?.id ?? '')}"
    aria-pressed="${favorite ? 'true' : 'false'}" aria-label="${favorite ? 'Eliminar de favoritos' : 'Guardar en favoritos'}"
    title="${favorite ? 'Eliminar de favoritos' : 'Guardar en favoritos'}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 17.32l-5.8 3.05 1.11-6.47-4.7-4.58 6.49-.94L12 2.5Z"/></svg>
  </button>`;
}

export function routeCardHtml(route: Route): string {
  const withinFiveMin = routeWithinFiveMinutes(route);
  const canReserve = (!user || user.role === 'pasajero') && route.status === 'published'
    && route.availableSeats > 0 && route.driverId !== user?.id && !withinFiveMin;
  const name = escape(route.driverName);
  const initials = escape(route.driverName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase());

  return `<article class="route-card" data-id="${escape(route.id)}">
    <div class="route-card-top">
      <div class="driver"><span class="avatar" aria-hidden="true">${initials}${route.driverPhotoUrl ? `<img class="avatar-photo" src="${escape(route.driverPhotoUrl)}" alt="" />` : ''}</span>
        <div><div class="driver-name">${name}</div><div class="driver-role">Conductor</div></div>
      </div>
      <div class="route-card-tools"><span class="price-pill">${escape(priceFormatter.format(route.price ?? 0))} / asiento</span>${favoriteButton(route.id, route.origin, route.destination)}</div>
    </div>
    <div class="route-points">
      <div class="route-point"><div><div class="route-point-label">Desde</div><div class="route-point-value">${escape(route.origin)}</div></div></div>
      <div class="route-connector"></div>
      <div class="route-point"><div><div class="route-point-label">Hasta</div><div class="route-point-value">${escape(route.destination)}</div></div></div>
    </div>
    ${route.meetingPoint ? `<p class="meeting-point">Encuentro: ${escape(route.meetingPoint)}</p>` : ''}
    ${route.note ? `<p class="route-note">${escape(route.note)}</p>` : ''}
    <div class="route-meta"><span>${escape(dateLabel(route.date))}</span><span>${escape(route.time)} · Colombia</span></div>
    <div class="route-footer">
      <span class="seats-label">${escape(route.availableSeats)} de ${escape(route.seats)} cupos libres</span>
      ${canReserve ? `<button type="button" class="btn-reserve" data-reserve="${escape(route.id)}">Solicitar cupo</button>` : (!routeHasStarted(route) && route.status === 'published' && withinFiveMin ? '<span class="hint warning-text">Faltan menos de 5 min para la salida</span>' : '')}
    </div>
  </article>`;
}

function bindAvatarFallbacks(container: HTMLElement): void {
  container.querySelectorAll<HTMLImageElement>('.avatar-photo').forEach((image) => {
    image.addEventListener('error', () => image.remove(), { once: true });
  });
}

function renderRoleDashboard(): void {
  if (!user) return;
  const role = user.role;
  if (role === 'admin') return;
  const roleLabel = role === 'conductor' ? 'Conductor' : 'Pasajero';
  $('#role-dashboard-badge').textContent = roleLabel;
  $('#role-dashboard-description').textContent = user.role === 'conductor'
    ? 'Publica, programa y gestiona tus viajes desde un solo lugar.'
    : 'Encuentra viajes, administra reservas y vuelve a tus rutas frecuentes.';
  $('#role-quick-actions').innerHTML = quickActionsFor(role).map((action) => {
    const isAnchor = action.target.startsWith('#');
    const scrollAttr = isAnchor ? `data-scroll data-target="${escape(action.target)}"` : '';
    return `<a class="quick-action-card" href="${escape(action.target)}" ${scrollAttr}>
      <span class="quick-action-icon" aria-hidden="true">${escape(action.icon)}</span>
      <span><strong>${escape(action.title)}</strong><small>${escape(action.description)}</small></span>
      <span class="quick-action-arrow" aria-hidden="true">→</span>
    </a>`;
  }).join('');
  $('#role-dashboard').hidden = false;
}

function renderFavorites(): void {
  const list = $('#favorites-list');
  list.innerHTML = favorites.map((favorite) => `<article class="favorite-journey" data-favorite="${escape(favorite.id)}">
    <div class="favorite-journey-heading">
      <div><span class="favorite-eyebrow">Trayecto guardado</span><h3>${escape(favorite.origin)} <span aria-hidden="true">→</span> ${escape(favorite.destination)}</h3></div>
      <button type="button" class="btn btn-secondary btn-sm" data-remove-favorite="${escape(favorite.id)}">Quitar</button>
    </div>
  </article>`).join('');
  $('#favorites-empty').hidden = favorites.length > 0;
}

async function loadFavorites(silent = false): Promise<void> {
  if (user?.role !== 'pasajero') return;
  if (!silent) statusMessage('#favorites-error', '');
  try {
    favorites = await routesService.favorites();
    renderFavorites();
  } catch (error) {
    if (!silent) statusMessage('#favorites-error', errorMessage(error));
  }
}

const attendanceLabels: Record<AttendanceStatus, string> = {
  pending: 'Pendiente', confirmed: 'Confirmó', release_suggested: 'Sin confirmar',
  released: 'Cupo liberado', cancelled: 'Cancelado',
};

function attendanceHtml(routeId: string): string {
  const trip = tripReminders.find((item) => item.routeId === routeId && item.role === 'driver');
  if (!trip?.participants.length) return '';
  return `<div class="attendance-list" aria-label="Estado de asistencia">${trip.participants.map((participant) =>
    `<span class="attendance-person attendance-${escape(participant.status)}">${escape(participant.name)}: ${escape(attendanceLabels[participant.status])}</span>`
  ).join('')}</div>`;
}

function renderReminders(): void {
  const list = $('#reminder-banner-list');
  list.innerHTML = tripReminders.map((trip) => {
    const start = new Date(trip.startsAt).toLocaleString('es-CO', {
      timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short',
    });
    const urgent = trip.minutesUntil <= 60;
    const canConfirm = trip.status === 'pending' || trip.status === 'release_suggested';
    const passengers = trip.role === 'driver' ? attendanceHtml(trip.routeId) : '';
    const releaseButtons = trip.role === 'driver'
      ? trip.participants.filter((person) => person.status === 'release_suggested').map((person) =>
          `<button type="button" class="btn btn-danger" data-release-trip="${escape(trip.routeId)}" data-release-passenger="${escape(person.userId)}">Liberar cupo de ${escape(person.name)}</button>`
        ).join('')
      : '';
    return `<article class="reminder-banner ${urgent ? 'reminder-urgent' : ''}" data-trip="${escape(trip.routeId)}">
      <h3>${urgent ? 'Viaje próximo' : 'Viaje programado'}: ${escape(trip.origin)} → ${escape(trip.destination)}</h3>
      <p>${escape(start)} (Colombia) · faltan ${escape(trip.minutesUntil)} minutos</p>
      <p class="meeting-point">Punto de encuentro: ${escape(trip.meetingPoint)}</p>
      <p>Tu asistencia: <strong>${escape(attendanceLabels[trip.status])}</strong></p>
      ${passengers}
      <div class="reminder-actions">
        ${canConfirm ? `<button type="button" class="btn btn-primary" data-confirm-trip="${escape(trip.routeId)}">Confirmar asistencia</button>` : ''}
        ${releaseButtons}
      </div>
    </article>`;
  }).join('');
  $('#reminders-empty').hidden = tripReminders.length > 0;
}

async function loadReminders(silent = false): Promise<void> {
  if (!user) return;
  if (!silent) statusMessage('#reminders-error', '');
  try {
    tripReminders = await remindersService.dashboard();
    renderReminders();
  } catch (error) {
    if (!silent) statusMessage('#reminders-error', errorMessage(error));
  }
}

async function refreshAllComponents(silent = true): Promise<void> {
  const tasks: Promise<unknown>[] = [loadRoutes(silent), loadPromotions()];
  if (user) {
    tasks.push(loadNotifications(silent), loadReminders(silent));
    if (user.role === 'pasajero') {
      tasks.push(loadFavorites(silent));
    }
  }
  await Promise.allSettled(tasks);
}

function renderRoutesPagination(totalPages: number): void {
  const container = $<HTMLElement>('#routes-pagination');
  if (!container) return;
  if (totalPages <= 1) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  container.hidden = false;

  const total = publicRoutes.length;
  const startIdx = (currentRoutesPage - 1) * ROUTES_PER_PAGE + 1;
  const endIdx = Math.min(currentRoutesPage * ROUTES_PER_PAGE, total);

  let pagesHtml = '';
  for (let p = 1; p <= totalPages; p++) {
    pagesHtml += `<button type="button" class="pagination-page-btn ${p === currentRoutesPage ? 'active' : ''}" data-page="${p}" aria-label="Página ${p}" ${p === currentRoutesPage ? 'aria-current="page"' : ''}>${p}</button>`;
  }

  container.innerHTML = `
    <div class="pagination-info">
      Mostrando <strong>${startIdx}–${endIdx}</strong> de <strong>${total}</strong> viajes disponibles
    </div>
    <div class="pagination-controls">
      <button type="button" class="pagination-nav-btn" id="routes-prev-page" data-page="${currentRoutesPage - 1}" ${currentRoutesPage <= 1 ? 'disabled' : ''} aria-label="Página anterior">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        Anterior
      </button>
      <div class="pagination-pages">
        ${pagesHtml}
      </div>
      <button type="button" class="pagination-nav-btn" id="routes-next-page" data-page="${currentRoutesPage + 1}" ${currentRoutesPage >= totalPages ? 'disabled' : ''} aria-label="Página siguiente">
        Siguiente
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  `;
}

function renderPublicRoutes(): void {
  const list = $('#routes-list');
  const paginationEl = $<HTMLElement>('#routes-pagination');
  const total = publicRoutes.length;

  if (total === 0) {
    list.replaceChildren();
    $('#empty-state').hidden = false;
    if (paginationEl) paginationEl.hidden = true;
    return;
  }

  $('#empty-state').hidden = true;

  const totalPages = Math.ceil(total / ROUTES_PER_PAGE) || 1;
  if (currentRoutesPage > totalPages) {
    currentRoutesPage = totalPages;
  }

  const startIdx = (currentRoutesPage - 1) * ROUTES_PER_PAGE;
  const pageRoutes = publicRoutes.slice(startIdx, startIdx + ROUTES_PER_PAGE);

  list.innerHTML = pageRoutes.map((route) => routeCardHtml(route)).join('');
  bindAvatarFallbacks(list);

  renderRoutesPagination(totalPages);
}

function goToRoutesPage(page: number): void {
  const totalPages = Math.ceil(publicRoutes.length / ROUTES_PER_PAGE);
  if (totalPages === 0) return;
  currentRoutesPage = Math.min(Math.max(page, 1), totalPages);
  renderPublicRoutes();
  $('#buscar').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadRoutes(silent = false): Promise<void> {
  const version = ++searchVersion;
  const filters = new FormData($<HTMLFormElement>('#search-form'));
  if (!silent) {
    statusMessage('#routes-error', '');
    $('#routes-loading').hidden = false;
    $<HTMLButtonElement>('#search-submit').disabled = true;
  }
  try {
    const routes = await routesService.search({
      origin: String(filters.get('origin') || ''), destination: String(filters.get('destination') || ''),
      date: String(filters.get('date') || ''),
    });
    if (version !== searchVersion) return;
    publicRoutes = routes;
    if (!silent) {
      currentRoutesPage = 1;
      renderPublicRoutes();
    }
  } catch (error) {
    if (version !== searchVersion) return;
    if (!silent) {
      publicRoutes = [];
      $('#routes-list').replaceChildren();
      $('#empty-state').hidden = true;
      statusMessage('#routes-error', errorMessage(error));
    }
  } finally {
    if (version === searchVersion && !silent) {
      $('#routes-loading').hidden = true;
      $<HTMLButtonElement>('#search-submit').disabled = false;
    }
  }
}

function notifPushIcon(type: string): string {
  if (type.includes('cancel')) return '🚫';
  if (type.includes('reject')) return '❌';
  if (type.includes('accept') || type.includes('confirm')) return '✅';
  if (type.includes('time_changed')) return '⏰';
  return '🔔';
}

function notifPushAction(notif: Notification): { actionText?: string; actionTarget?: string } {
  if (notif.type === 'booking_requested' || notif.type === 'new_booking') {
    return { actionText: 'Ver solicitud', actionTarget: '/viajes-activos.html#solicitudes-cupo' };
  }
  if (notif.type.includes('cancel') || notif.type.includes('accept') || notif.type.includes('confirm')) {
    return { actionText: 'Ver viajes activos', actionTarget: '/viajes-activos.html' };
  }
  return {};
}

async function loadNotifications(silent = false): Promise<void> {
  if (!user || notificationRequest) return;
  notificationRequest = true;
  try {
    const notifications = await routesService.notifications();
    const unreadNotifs = notifications.filter((n) => !n.readAt);

    if (!notificationsInitialized) {
      notificationsInitialized = true;
      const now = Date.now();
      const recentUnread = unreadNotifs
        .filter((n) => now - new Date(n.createdAt).getTime() < 5 * 60 * 1000)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      for (const notif of unreadNotifs) {
        seenNotificationIds.add(`${notif.id}:${notif.createdAt}`);
      }

      for (const notif of recentUnread.slice(-3)) {
        const { actionText, actionTarget } = notifPushAction(notif);
        showInAppPush({
          title: notif.title, message: notif.message, icon: notifPushIcon(notif.type),
          actionText, actionTarget, durationMs: 8000,
        });
      }
    } else {
      const toShow: Notification[] = [];
      for (const notif of unreadNotifs) {
        const seenKey = `${notif.id}:${notif.createdAt}`;
        if (!seenNotificationIds.has(seenKey)) {
          seenNotificationIds.add(seenKey);
          toShow.push(notif);
        }
      }
      toShow.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      for (const notif of toShow) {
        const { actionText, actionTarget } = notifPushAction(notif);
        showInAppPush({
          title: notif.title, message: notif.message, icon: notifPushIcon(notif.type),
          actionText, actionTarget, durationMs: 8000,
        });
      }
    }

    renderNotifPanel(notifications);
  } catch (error) {
    if (!silent) console.warn('[Notifications]', error);
  } finally {
    notificationRequest = false;
  }
}

function setPublishAccess(message: string, link?: { href: string; text: string }): void {
  statusMessage('#publish-access', message);
  const anchor = $<HTMLAnchorElement>('#publish-access-link');
  anchor.hidden = !link;
  if (link) { anchor.href = link.href; anchor.textContent = link.text; }
  $<HTMLFieldSetElement>('#publish-fields').disabled = Boolean(message);
}

async function loadSession(): Promise<void> {
  if (!authService.getToken()) {
    await initHeader(null);
    setPublishAccess('Inicia sesión como conductor para publicar una ruta.', { href: '/login.html', text: 'Iniciar sesión' });
    return;
  }
  try {
    user = await authService.getMe();
    await initHeader(user);
    renderRoleDashboard();
    $('#recordatorios').hidden = false;
    $('#rutas-favoritas').hidden = user.role !== 'pasajero';

    if (user.role !== 'conductor') {
      $('#publicar').hidden = true;
    } else {
      vehicle = await routesService.vehicle();
      if (!vehicle?.capacity) {
        setPublishAccess('Registra tu vehículo y su capacidad para ofrecer cupos.', { href: '/profile.html#vehiculo', text: 'Registrar o completar vehículo' });
      } else {
        setPublishAccess('');
        $('#vehicle-summary').textContent = `${vehicle.brand} ${vehicle.model} · ${vehicle.plate}`;
        $('#capacity-hint').textContent = `Entre 1 y ${vehicle.capacity} cupos, sin incluir al conductor.`;
        $<HTMLInputElement>('#seats').max = String(vehicle.capacity);
      }
    }
  } catch (error) {
    setPublishAccess(errorMessage(error), { href: '/login.html', text: 'Revisar sesión' });
  }

  await Promise.allSettled([loadNotifications(), loadReminders(), loadFavorites()]);
  renderPublicRoutes();

  if (user) {
    void enablePushNotifications((pushData) => {
      void Promise.allSettled([loadReminders(), loadNotifications()]);
      if (pushData?.title || pushData?.body) {
        showInAppPush({
          title: pushData.title || 'Asiento Libre',
          message: pushData.body || 'Tienes una nueva actualización en tu viaje',
          icon: '🔔', durationMs: 8000,
        });
      }
    });
  }
}

export function renderRouteErrors(errors: ReturnType<typeof validateRoute>): void {
  for (const field of ['origin', 'destination', 'meetingPoint', 'date', 'time', 'seats', 'price', 'note'] as const) {
    const message = errors[field] || '';
    statusMessage('#' + field + '-error', message);
    $('#' + field).setAttribute('aria-invalid', String(Boolean(message)));
  }
}

async function publish(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (user?.role !== 'conductor' || !vehicle?.capacity || $<HTMLButtonElement>('#publish-submit').disabled) return;
  statusMessage('#publish-error', '');
  const form = $<HTMLFormElement>('#publish-form');
  const data = new FormData(form);
  const route: CreateRoute = {
    origin: String(data.get('origin') || '').trim(), destination: String(data.get('destination') || '').trim(),
    meetingPoint: String(data.get('meetingPoint') || '').trim(),
    date: String(data.get('date') || ''), time: String(data.get('time') || ''), seats: Number(data.get('seats')),
    price: Number(data.get('price') || 0), note: String(data.get('note') || '').trim(),
  };
  const recurring = $<HTMLInputElement>('#recurring').checked;
  const weekdays = [...form.querySelectorAll<HTMLInputElement>('input[name="weekday"]:checked')].map((input) => Number(input.value));
  const errors = validateRoute(route, vehicle.capacity);
  renderRouteErrors(errors);
  if (Object.keys(errors).length) {
    statusMessage('#publish-error', 'Revisa los campos indicados antes de publicar.');
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return;
  }
  statusMessage('#weekdays-error', recurring && weekdays.length === 0 ? 'Selecciona al menos un día.' : '');
  if (recurring && weekdays.length === 0) return;
  const button = $<HTMLButtonElement>('#publish-submit');
  button.disabled = true;
  button.textContent = 'Publicando…';
  try {
    const result = recurring ? await routesService.createRecurring({ ...route, weekdays }) : await routesService.create(route);
    form.reset();
    $('#recurrence-options').hidden = true;
    toast(recurring ? `Serie creada con ${'generatedCount' in result ? result.generatedCount : 0} viajes para las próximas 4 semanas.` : 'Tu ruta fue publicada. Ya está disponible para los pasajeros.');
    await refreshAllComponents(true);
  } catch (error) { statusMessage('#publish-error', errorMessage(error)); }
  finally { button.disabled = false; button.textContent = 'Publicar ruta'; }
}

function openReservation(id: string): void {
  if (!user) { window.location.href = '/login.html'; return; }
  const route = publicRoutes.find((item) => item.id === id);
  if (!route) return;
  if (routeWithinFiveMinutes(route)) {
    toast('No se pueden solicitar cupos si faltan menos de 5 minutos para la salida.');
    return;
  }
  activeReservation = route;
  $('#reserve-route').textContent = `${route.origin} → ${route.destination}`;
  $('#reserve-hint').textContent = `${route.availableSeats} cupos disponibles. Solicitud a nombre de ${user.firstName} ${user.lastName}.`;
  const seats = $<HTMLInputElement>('#reserve-seats');
  seats.value = '1';
  seats.max = String(route.availableSeats);
  const promotionField = $<HTMLElement>('#reserve-promotion-field');
  const promotionSelect = $<HTMLSelectElement>('#reserve-promotion');
  promotionField.hidden = user.role !== 'pasajero' || promotions.length === 0;
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
  if (routeWithinFiveMinutes(activeReservation)) {
    statusMessage('#reserve-error', 'No se pueden solicitar cupos si faltan menos de 5 minutos para la salida del viaje.');
    return;
  }
  const seats = Number($<HTMLInputElement>('#reserve-seats').value);
  if (!Number.isInteger(seats) || seats < 1 || seats > activeReservation.availableSeats) {
    statusMessage('#reserve-error', `Elige entre 1 y ${activeReservation.availableSeats} asientos enteros.`);
    return;
  }
  button.disabled = true;
  $<HTMLButtonElement>('#reserve-close').disabled = true;
  try {
    const promotionId = $<HTMLSelectElement>('#reserve-promotion').value || null;
    await routesService.reserve(activeReservation.id, seats, promotionId);
    $<HTMLDialogElement>('#reserve-dialog').close();
    toast('Solicitud enviada. El conductor recibirá una notificación para aceptarla.');
    activeReservation = null;
    await refreshAllComponents(true);
  } catch (error) { statusMessage('#reserve-error', errorMessage(error)); }
  finally { button.disabled = false; $<HTMLButtonElement>('#reserve-close').disabled = false; }
}

async function submitSurvey(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!activeSurvey || surveySubmitting) return;
  const button = $<HTMLButtonElement>('#survey-submit');
  button.disabled = true;
  $<HTMLButtonElement>('#survey-later').disabled = true;
  surveySubmitting = true;
  statusMessage('#survey-error', '');
  try {
    const form = $<HTMLFormElement>('#survey-form');
    const ratings = activeSurvey.targets.map((target) => {
      const score = Number(form.querySelector<HTMLInputElement>(`input[name="score-${target.id}"]:checked`)?.value || '5');
      const comment = (form.querySelector<HTMLTextAreaElement>(`textarea[name="comment-${target.id}"]`)?.value || '').trim();
      return { target, score, comment };
    });
    for (const rating of ratings) await routesService.rate(activeSurvey.routeId, rating.target.id, rating.score, rating.comment);
    $<HTMLDialogElement>('#survey-dialog').close();
    activeSurvey = null;
    toast('Gracias. Tus calificaciones fueron guardadas de forma anónima.');
    await refreshAllComponents(true);
  } catch (error) {
    statusMessage('#survey-error', errorMessage(error));
  } finally {
    surveySubmitting = false;
    button.disabled = false;
    $<HTMLButtonElement>('#survey-later').disabled = false;
  }
}

async function init(): Promise<void> {
  $<HTMLInputElement>('#date').min = colombiaDate();
  $('#publish-form').addEventListener('submit', (event) => { void publish(event as SubmitEvent); });
  $('#search-form').addEventListener('submit', (event) => { event.preventDefault(); void loadRoutes(); });
  $('#reserve-form').addEventListener('submit', (event) => { void reserve(event as SubmitEvent); });
  $('#reserve-seats').addEventListener('input', renderReservationTotal);
  $('#reserve-promotion').addEventListener('change', renderReservationTotal);
  $('#survey-form').addEventListener('submit', (event) => { void submitSurvey(event as SubmitEvent); });
  $('#survey-later').addEventListener('click', () => { activeSurvey = null; $<HTMLDialogElement>('#survey-dialog').close(); });
  $('#survey-dialog').addEventListener('cancel', (event) => {
    if (surveySubmitting) event.preventDefault();
    else activeSurvey = null;
  });

  $('#refresh-favorites')?.addEventListener('click', () => { void loadFavorites(); });
  $('#recurring').addEventListener('change', () => { $('#recurrence-options').hidden = !$<HTMLInputElement>('#recurring').checked; });

  $('#reserve-close').addEventListener('click', () => $<HTMLDialogElement>('#reserve-dialog').close());
  $('#reserve-dialog').addEventListener('cancel', (event) => {
    if ($<HTMLButtonElement>('#reserve-submit').disabled) event.preventDefault();
  });

  $('#routes-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-reserve]');
    if (button?.dataset.reserve) openReservation(button.dataset.reserve);
  });

  $('#routes-pagination').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-page]');
    const page = Number(button?.dataset.page);
    if (button && Number.isInteger(page) && !button.disabled) {
      goToRoutesPage(page);
    }
  });

  document.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const toggle = target.closest<HTMLButtonElement>('[data-favorite-route]');
    const remove = target.closest<HTMLButtonElement>('[data-remove-favorite]');
    const button = toggle ?? remove;
    if (!button || button.disabled) return;

    event.preventDefault();
    button.disabled = true;
    try {
      if (toggle?.dataset.favoriteRoute) {
        if (toggle.dataset.favoriteId) {
          await routesService.removeFavorite(toggle.dataset.favoriteId);
          toast('Ruta eliminada de favoritos.');
        } else {
          await routesService.saveFavorite(toggle.dataset.favoriteRoute);
          toast('Ruta guardada en favoritos.');
        }
      } else if (remove?.dataset.removeFavorite) {
        await routesService.removeFavorite(remove.dataset.removeFavorite);
        toast('Ruta eliminada de favoritos.');
      }
      await loadFavorites(true);
    } catch (error) {
      statusMessage('#favorites-error', errorMessage(error));
      toast(errorMessage(error));
      button.disabled = false;
    }
  });

  $('#reminder-banner-list').addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const confirmButton = target.closest<HTMLButtonElement>('[data-confirm-trip]');
    const releaseButton = target.closest<HTMLButtonElement>('[data-release-trip]');
    const button = confirmButton ?? releaseButton;
    if (!button || button.disabled) return;
    button.disabled = true;
    statusMessage('#reminders-error', '');
    try {
      if (confirmButton?.dataset.confirmTrip) {
        await remindersService.confirm(confirmButton.dataset.confirmTrip);
        toast('Asistencia confirmada. La contraparte recibirá la notificación.');
      } else if (releaseButton?.dataset.releaseTrip && releaseButton.dataset.releasePassenger) {
        await remindersService.release(releaseButton.dataset.releaseTrip, releaseButton.dataset.releasePassenger);
        toast('El cupo fue liberado y el pasajero recibió la notificación.');
      }
      await refreshAllComponents(true);
    } catch (error) {
      statusMessage('#reminders-error', errorMessage(error));
      button.disabled = false;
    }
  });

  document.querySelectorAll<HTMLElement>('[data-scroll]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const selector = link.dataset.target || link.getAttribute('href');
      if (selector?.startsWith('#')) {
        event.preventDefault();
        document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  await Promise.allSettled([loadRoutes(), loadSession(), loadPromotions()]);

  let isWatcherActive = false;
  const watcherPoll = async () => {
    if (document.visibilityState !== 'visible' || isWatcherActive) return;
    isWatcherActive = true;
    try {
      await refreshAllComponents(true);
    } finally {
      isWatcherActive = false;
    }
  };

  const timer = setInterval(() => { void watcherPoll(); }, 5000);
  window.addEventListener('focus', () => { void watcherPoll(); });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void watcherPoll();
  });
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
}

if (document.querySelector('#publish-form')) {
  void init().catch((error) => statusMessage('#publish-error', errorMessage(error)));
}

import { initHeader, renderNotifPanel } from '../../components/header/header';
import type { AuthUser } from '../../../core/services/auth.service';
import { authService } from '../../../core/services/auth.service';
import { ApiError, routesService } from '../../../core/services/routes.service';
import type { Route, RegisteredVehicle, CreateRoute, RatingTarget, BookingRequest, TripPayment, AlternativeRoute, Notification, Promotion } from '../../../core/services/routes.service';
import { remindersService, enablePushNotifications } from '../../../core/services/reminders.service';
import type { AttendanceStatus, TripReminder } from '../../../core/services/reminders.service';
import { showInAppPush } from '../../../core/in-app-push';
import { colombiaDate, validateRoute } from '../../../core/route-validation';
import { element as $, escapeHtml as escape, errorMessage, statusMessage } from '../../../core/dom';

let user: AuthUser | null = null;
let vehicle: RegisteredVehicle | null = null;
let publicRoutes: Route[] = [];
let ownRoutes: Route[] = [];
let bookingRequests: BookingRequest[] = [];
let payments: TripPayment[] = [];
let promotions: Promotion[] = [];
let tripReminders: TripReminder[] = [];
let activeReservation: Route | null = null;
let activeRemoval: Route | null = null;
let activeSurvey: { routeId: string; targets: RatingTarget[] } | null = null;
/** SCRUM-138: Notificación de cambio de hora activa en el modal */
let activeTimeChangedNotification: Notification | null = null;
let surveySubmitting = false;
let searchVersion = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let notificationRequest = false;
const seenNotificationIds = new Set<string>();
let notificationsInitialized = false;
const priceFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });
const bookingStatusLabels: Record<string, string> = {
  pending: 'Solicitud pendiente', confirmed: 'Reserva confirmada',
  cancelled: 'Reserva cancelada',
};

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

/** Comprueba si faltan menos de 5 minutos para la salida (o si ya inició) */
function routeWithinFiveMinutes(route: { date: string; time: string }): boolean {
  const departureMs = new Date(`${route.date}T${route.time}:00-05:00`).getTime();
  return departureMs - Date.now() <= 5 * 60 * 1000;
}

export function routeCardHtml(route: Route, owner = false): string {
  const status = route.driverFinishedAt ? 'FINALIZADO' : { published: 'ACTIVO', deleted: 'Eliminada', cancelled: 'Cancelada' }[route.status];
  const withinFiveMin = routeWithinFiveMinutes(route);
  const canReserve = !owner && (!user || user.role === 'pasajero') && route.status === 'published'
    && route.availableSeats > 0 && route.driverId !== user?.id && !withinFiveMin;
  const canCancel = route.status === 'published' && !routeHasStarted(route);
  const canFinish = route.status === 'published' && routeHasStarted(route);
  const hasConfirmedPayment = payments.some((payment) => payment.routeId === route.id && payment.status === 'confirmed');
  const name = escape(route.driverName);
  const initials = escape(route.driverName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase());
  return `<article class="route-card" data-id="${escape(route.id)}">
    <div class="route-card-top">
      <div class="driver"><span class="avatar" aria-hidden="true">${initials}${route.driverPhotoUrl ? `<img class="avatar-photo" src="${escape(route.driverPhotoUrl)}" alt="" />` : ''}</span>
        <div><div class="driver-name">${name}</div><div class="driver-role">Conductor</div></div>
      </div>
      <span class="price-pill">${escape(priceFormatter.format(route.price ?? 0))} / asiento</span>
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
      ${owner ? `<span class="status-pill status-${escape(route.status)}">${escape(status)}</span>` : ''}
      ${canReserve ? `<button type="button" class="btn-reserve" data-reserve="${escape(route.id)}">Solicitar cupo</button>` : (!owner && route.status === 'published' && withinFiveMin ? '<span class="hint warning-text">Faltan menos de 5 min para la salida</span>' : '')}
    </div>
    ${owner ? `<p class="hint">${escape(route.confirmedPassengers)} pasajero(s) con reserva</p>${attendanceHtml(route.id)}` : ''}
    ${owner && (canCancel || canFinish) ? `<div class="route-actions">
      ${canCancel ? `<button type="button" class="btn btn-danger" data-remove="${escape(route.id)}">${route.confirmedPassengers > 0 ? 'Cancelar ruta' : 'Eliminar ruta'}</button>` : ''}
      ${canFinish ? route.driverFinishedAt
        ? hasConfirmedPayment
          ? `<button type="button" class="btn btn-secondary" data-rate="${escape(route.id)}">Calificar viaje</button>`
          : '<span class="hint">Podrás calificar cuando se confirme el pago del pasajero.</span>'
        : `<button type="button" class="btn btn-secondary" data-finish="${escape(route.id)}">Finalizar viaje</button>`
        : ''}
    </div>` : ''}
  </article>`;
}

function bindAvatarFallbacks(container: HTMLElement): void {
  container.querySelectorAll<HTMLImageElement>(".avatar-photo").forEach((image) => {
    image.addEventListener("error", () => image.remove(), { once: true });
  });
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
    const fresh = await remindersService.dashboard();
    const key = fresh.map((t) => `${t.routeId}:${t.status}:${t.participants.map((p) => `${p.userId}-${p.status}`).join(',')}`).join('|');
    const prevKey = tripReminders.map((t) => `${t.routeId}:${t.status}:${t.participants.map((p) => `${p.userId}-${p.status}`).join(',')}`).join('|');
    if (key !== prevKey || !silent) {
      tripReminders = fresh;
      renderReminders();
    }
  } catch (error) {
    if (!silent) statusMessage('#reminders-error', errorMessage(error));
  }
}

/**
 * Observador / Refresco centralizado de todos los componentes en tiempo real
 */
async function refreshAllComponents(silent = true): Promise<void> {
  const tasks: Promise<unknown>[] = [loadRoutes(silent)];
  if (user) {
    tasks.push(
      loadNotifications(silent),
      loadBookings(silent),
      loadReminders(silent),
      loadPayments(silent),
      loadPastTrips(silent),
    );
    if (user.role === 'conductor') {
      tasks.push(loadMine(silent), loadBookingRequests(silent));
    }
  }
  await Promise.allSettled(tasks);
}

function renderPublicRoutes(): void {
  const list = $('#routes-list');
  list.innerHTML = publicRoutes.map((route) => routeCardHtml(route)).join('');
  bindAvatarFallbacks(list);
  $('#empty-state').hidden = publicRoutes.length > 0;
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
    const key = routes.map((r) => `${r.id}:${r.status}:${r.availableSeats}:${r.confirmedPassengers}:${r.driverFinishedAt}`).join('|');
    const prevKey = publicRoutes.map((r) => `${r.id}:${r.status}:${r.availableSeats}:${r.confirmedPassengers}:${r.driverFinishedAt}`).join('|');
    if (key !== prevKey || !silent) {
      publicRoutes = routes;
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

async function loadMine(silent = false): Promise<void> {
  if (user?.role !== 'conductor') return;
  const button = $<HTMLButtonElement>('#refresh-mine');
  if (!silent) {
    button.disabled = true;
    statusMessage('#mine-error', '');
  }
  try {
    const fresh = (await routesService.mine()).filter((route) => route.status === 'published');
    const key = fresh.map((r) => `${r.id}:${r.status}:${r.confirmedPassengers}:${r.availableSeats}:${r.driverFinishedAt}:${attendanceHtml(r.id)}`).join('|');
    const prevKey = ownRoutes.map((r) => `${r.id}:${r.status}:${r.confirmedPassengers}:${r.availableSeats}:${r.driverFinishedAt}:${attendanceHtml(r.id)}`).join('|');
    if (key !== prevKey || !silent) {
      ownRoutes = fresh;
      const list = $('#mine-list');
      list.innerHTML = ownRoutes.map((route) => routeCardHtml(route, true)).join('');
      bindAvatarFallbacks(list);
      $('#mine-empty').hidden = ownRoutes.length > 0;
    }
  } catch (error) {
    if (!silent) statusMessage('#mine-error', errorMessage(error));
  } finally {
    if (!silent) button.disabled = false;
  }
}

/** Estado de las pestañas de Mis Viajes */
let pastTripsTab: 'all' | 'conductor' | 'pasajero' = 'all';

interface PastTrip {
  type: 'conductor' | 'pasajero';
  routeId: string;
  origin: string;
  destination: string;
  date: string;
  time: string;
  price: number;
  driverName: string;
  driverPhotoUrl?: string | null;
  status: string;
  finishedAt: string | null;
  seats?: number;
  bookingStatus?: string;
}

let allPastTrips: PastTrip[] = [];

function renderPastTrips(): void {
  const filtered = pastTripsTab === 'all'
    ? allPastTrips
    : allPastTrips.filter((t) => t.type === pastTripsTab);
  const list = $('#past-trips-list');
  if (!filtered.length) {
    list.innerHTML = '';
    $('#past-trips-empty').hidden = false;
    return;
  }
  $('#past-trips-empty').hidden = true;
  list.innerHTML = filtered.map((trip) => {
    const roleBadge = trip.type === 'conductor'
      ? '<span class="past-trip-role past-trip-role--conductor">🚗 Conductor</span>'
      : '<span class="past-trip-role past-trip-role--pasajero">🧳 Pasajero</span>';
    const statusLabels: Record<string, string> = {
      published: 'Activo', deleted: 'Eliminado', cancelled: 'Cancelado',
      confirmed: 'Confirmado', pending: 'Pendiente',
    };
    const resolvedStatus = trip.status === 'published' && trip.finishedAt ? 'Finalizado' : (statusLabels[trip.status] ?? trip.status);
    const statusClass = ['cancelled', 'deleted'].includes(trip.status) ? 'status-cancelled' : 'status-pill';
    const initials = escape(trip.driverName.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase());
    const avatarImg = trip.driverPhotoUrl ? `<img class="avatar-photo" src="${escape(trip.driverPhotoUrl)}" alt="" />` : '';
    return `<article class="route-card past-trip-card" data-id="${escape(trip.routeId)}">
      <div class="past-trip-header">
        ${roleBadge}
        <span class="${statusClass}">${escape(resolvedStatus)}</span>
      </div>
      <div class="route-card-top">
        <div class="driver">
          <span class="avatar" aria-hidden="true">${initials}${avatarImg}</span>
          <div><div class="driver-name">${escape(trip.driverName)}</div><div class="driver-role">Conductor</div></div>
        </div>
        <span class="price-pill">${escape(priceFormatter.format(trip.price ?? 0))} / asiento</span>
      </div>
      <div class="route-points">
        <div class="route-point"><div><div class="route-point-label">Desde</div><div class="route-point-value">${escape(trip.origin)}</div></div></div>
        <div class="route-connector"></div>
        <div class="route-point"><div><div class="route-point-label">Hasta</div><div class="route-point-value">${escape(trip.destination)}</div></div></div>
      </div>
      <div class="route-meta">
        <span>${escape(dateLabel(trip.date))}</span>
        <span>${escape(trip.time)} · Colombia</span>
        ${trip.seats ? `<span>${escape(trip.seats)} asiento(s)</span>` : ''}
      </div>
      ${trip.finishedAt ? `<p class="hint past-trip-finished">✓ Finalizado el ${escape(new Date(trip.finishedAt).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric' }))}</p>` : ''}
    </article>`;
  }).join('');
  list.querySelectorAll<HTMLImageElement>('.avatar-photo').forEach((img) => {
    img.addEventListener('error', () => img.remove(), { once: true });
  });
}

async function loadPastTrips(silent = false): Promise<void> {
  if (!user) return;
  const button = $<HTMLButtonElement>('#refresh-past-trips');
  if (!silent) {
    button.disabled = true;
    statusMessage('#past-trips-error', '');
  }
  try {
    const collected: PastTrip[] = [];

    // Viajes como conductor: todos excepto los que están activos (published + no finalizado)
    if (user.role === 'conductor') {
      const conductorRoutes = await routesService.mine();
      for (const route of conductorRoutes) {
        const isPast = route.status !== 'published' || route.driverFinishedAt !== null
          || new Date(`${route.date}T${route.time}:00-05:00`).getTime() < Date.now();
        if (isPast) {
          collected.push({
            type: 'conductor',
            routeId: route.id,
            origin: route.origin,
            destination: route.destination,
            date: route.date,
            time: route.time,
            price: route.price,
            driverName: route.driverName,
            driverPhotoUrl: route.driverPhotoUrl,
            status: route.status,
            finishedAt: route.driverFinishedAt,
          });
        }
      }
    }

    // Viajes como pasajero: reservas con estatus distinto de pending, o cuya fecha ya pasó
    const bookings = await routesService.bookings();
    for (const booking of bookings) {
      const isPast = booking.status !== 'pending'
        || new Date(`${booking.route.date}T${booking.route.time}:00-05:00`).getTime() < Date.now();
      if (isPast && booking.status !== 'pending') {
        collected.push({
          type: 'pasajero',
          routeId: booking.routeId,
          origin: booking.route.origin,
          destination: booking.route.destination,
          date: booking.route.date,
          time: booking.route.time,
          price: booking.route.price,
          driverName: booking.route.driverName,
          driverPhotoUrl: booking.route.driverPhotoUrl,
          status: booking.status,
          finishedAt: booking.passengerFinishedAt,
          seats: booking.seats,
          bookingStatus: booking.status,
        });
      }
    }

    // Ordenar por fecha de viaje descendente (más recientes primero)
    collected.sort((a, b) => {
      const dateA = new Date(`${a.date}T${a.time}:00-05:00`).getTime();
      const dateB = new Date(`${b.date}T${b.time}:00-05:00`).getTime();
      return dateB - dateA;
    });

    const key = collected.map((t) => `${t.routeId}:${t.status}:${t.finishedAt}:${t.type}`).join('|');
    const prevKey = allPastTrips.map((t) => `${t.routeId}:${t.status}:${t.finishedAt}:${t.type}`).join('|');
    if (key !== prevKey || !silent) {
      allPastTrips = collected;

      // Mostrar/ocultar pestañas según si el usuario es conductor
      const hasConductorTrips = collected.some((t) => t.type === 'conductor');
      const hasPassengerTrips = collected.some((t) => t.type === 'pasajero');
      $('#past-trips-tabs').hidden = !(hasConductorTrips && hasPassengerTrips);

      renderPastTrips();
    }
  } catch (error) {
    if (!silent) statusMessage('#past-trips-error', errorMessage(error));
  } finally {
    if (!silent) button.disabled = false;
  }
}

async function loadBookings(silent = false): Promise<void> {
  if (!user) return;
  if (!silent) statusMessage('#bookings-error', '');
  try {
    const bookings = await routesService.bookings();
    const key = bookings.map((b) => `${b.id}:${b.status}:${b.seats}:${b.passengerFinishedAt}:${paymentForBooking(b.id)?.status}`).join('|');
    const list = $('#bookings-list');
    const prevKey = list.dataset.loadedKey || '';
    if (key !== prevKey || !silent) {
      list.dataset.loadedKey = key;
      list.innerHTML = bookings.map((booking) => {
        const canCancel = (booking.status === 'pending' || booking.status === 'confirmed')
          && booking.route.status === 'published'
          && !booking.passengerFinishedAt;
        const expiredCancel = routeWithinFiveMinutes(booking.route);

        return `<article class="route-card">
        <h3>${escape(booking.route.origin)} → ${escape(booking.route.destination)}</h3>
        <p>${escape(dateLabel(booking.route.date))} · ${escape(booking.route.time)} (Colombia)</p>
        <p>${escape(booking.seats)} asiento(s) · <span class="status-badge status-${escape(booking.status)}">${escape(bookingStatusLabels[booking.status] ?? booking.status)}</span></p>
        <div class="booking-price-summary">
          <span>Subtotal: ${escape(priceFormatter.format(booking.totalAmount + booking.discountAmount))}</span>
          ${booking.discountAmount > 0 ? `<span>Descuento: −${escape(priceFormatter.format(booking.discountAmount))}</span>` : ''}
          <strong>Total: ${escape(priceFormatter.format(booking.totalAmount))}</strong>
        </div>
        ${paymentForBooking(booking.id) ? paymentHtml(paymentForBooking(booking.id)!, false) : ''}
        ${canCancel
          ? expiredCancel
            ? '<p class="hint warning-text" style="margin-top: 10px;">No se puede cancelar (faltan menos de 5 min para la salida).</p>'
            : `<button type="button" class="btn btn-danger" data-cancel-passenger-booking="${escape(booking.id)}" style="margin-top: 10px;">${booking.status === 'pending' ? 'Cancelar solicitud' : 'Cancelar reserva'}</button>`
          : ''}
        ${(() => {
          const driverFinished = !!booking.route.driverFinishedAt;
          const passengerFinished = !!booking.passengerFinishedAt;
          const isActive = booking.status === 'confirmed' && booking.route.status === 'published' && routeHasStarted(booking.route);
          if (!isActive) return passengerFinished ? '<p class="hint">Viaje finalizado por el conductor.</p>' : '';
          // El conductor ya finalizó
          if (driverFinished) {
            const payment = paymentForBooking(booking.id);
            if (payment?.status === 'confirmed') {
              return `<button type="button" class="btn btn-secondary" data-rate="${escape(booking.routeId)}">Calificar viaje</button>`;
            }
            return '<p class="hint">El conductor finalizó el viaje. Tu pago está pendiente de confirmación por parte del conductor.</p>';
          }
          // El conductor aún no finaliza
          return '<p class="hint">El viaje ha comenzado. Esperando que el conductor finalice el viaje.</p>';
        })()}
      </article>`;
      }).join('');
      $('#bookings-empty').hidden = bookings.length > 0;
    }
  } catch (error) { if (!silent) statusMessage('#bookings-error', errorMessage(error)); }
}

function paymentForBooking(bookingId: string): TripPayment | undefined {
  return payments.find((payment) => payment.bookingId === bookingId);
}

function paymentHtml(payment: TripPayment, owner: boolean): string {
  const status = payment.status === 'confirmed' ? '✓ PAGADO / CONFIRMADO' : 'PENDIENTE DE CONFIRMACIÓN';
  return `<div class="payment-summary">
    ${payment.route ? `<strong>${escape(payment.route.origin)} → ${escape(payment.route.destination)}</strong><span>${escape(dateLabel(payment.route.date))} · ${escape(payment.route.time)} (Colombia)</span>` : ''}
    ${owner ? `<strong>Pasajero: ${escape(payment.passengerName || 'Pasajero')}</strong>` : '<strong>Pago del viaje</strong>'}
    <span>Aporte: <strong>${escape(priceFormatter.format(payment.amount))}</strong></span>
    <span>Estado: ${escape(status)}</span>
    ${owner && payment.status === 'pending' ? `<button type="button" class="btn btn-primary" data-confirm-payment="${escape(payment.id)}">Confirmar pago</button>` : ''}
    ${payment.confirmedAt ? `<small class="hint">Confirmado el ${escape(new Date(payment.confirmedAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' }))}</small>` : ''}
  </div>`;
}

async function loadPayments(silent = false): Promise<void> {
  if (!user) return;
  const button = $<HTMLButtonElement>('#refresh-payments');
  if (!silent) {
    button.disabled = true;
    statusMessage('#payments-error', '');
  }
  try {
    if (user.role === 'conductor') {
      const freshPayments = await routesService.ownedPayments();
      const key = freshPayments.map((p) => `${p.id}:${p.status}:${p.amount}:${p.confirmedAt}`).join('|');
      const list = $('#payments-list');
      const prevKey = list.dataset.loadedKey || '';
      if (key !== prevKey || !silent) {
        list.dataset.loadedKey = key;
        payments = freshPayments;
        const pendingPayments = payments.filter((payment) => payment.status === 'pending');
        list.innerHTML = pendingPayments.map((payment) => paymentHtml(payment, true)).join('');
        $('#payments-empty').hidden = pendingPayments.length > 0;
      }
    } else {
      const freshPayments = await routesService.payments();
      const key = freshPayments.map((p) => `${p.id}:${p.status}:${p.amount}:${p.confirmedAt}`).join('|');
      const list = $('#payments-list');
      const prevKey = list.dataset.loadedKey || '';
      if (key !== prevKey || !silent) {
        list.dataset.loadedKey = key;
        payments = freshPayments;
        await loadBookings(silent);
      }
    }
  } catch (error) {
    if (!silent) statusMessage('#payments-error', errorMessage(error));
  } finally {
    if (!silent) button.disabled = false;
  }
}

async function loadBookingRequests(silent = false): Promise<void> {
  if (user?.role !== 'conductor') return;
  const button = $<HTMLButtonElement>('#refresh-booking-requests');
  if (!silent) {
    button.disabled = true;
    statusMessage('#booking-requests-error', '');
  }
  try {
    const requests = await routesService.bookingRequests();
    const key = requests.map((r) => `${r.id}:${r.seats}:${r.totalAmount}`).join('|');
    const prevKey = bookingRequests.map((r) => `${r.id}:${r.seats}:${r.totalAmount}`).join('|');
    if (key !== prevKey || !silent) {
      bookingRequests = requests;
      const list = $('#booking-requests-list');
      list.innerHTML = bookingRequests.map((request) => {
        const expired = routeWithinFiveMinutes(request.route);
        return `<article class="route-card">
        <div class="driver"><span class="avatar" aria-hidden="true">${escape(request.passengerName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase())}${request.passengerPhotoUrl ? `<img class="avatar-photo" src="${escape(request.passengerPhotoUrl)}" alt="" />` : ''}</span>
          <div><h3>${escape(request.passengerName)} solicita ${escape(request.seats)} cupo(s)</h3></div>
        </div>
        <p>${escape(request.route.origin)} → ${escape(request.route.destination)}</p>
        <p>${escape(dateLabel(request.route.date))} · ${escape(request.route.time)} (Colombia)</p>
        <div class="booking-price-summary">
          <span>Subtotal: ${escape(priceFormatter.format(request.totalAmount + request.discountAmount))}</span>
          ${request.discountAmount > 0 ? `<span>Descuento: −${escape(priceFormatter.format(request.discountAmount))}</span>` : ''}
          <strong>Total a recibir: ${escape(priceFormatter.format(request.totalAmount))}</strong>
        </div>
        ${expired
          ? '<p class="hint warning-text">⚠️ Faltan menos de 5 minutos para la salida (solicitud no disponible para aceptar o rechazar).</p>'
          : `<div class="request-actions">
              <button type="button" class="btn btn-primary" data-accept-booking="${escape(request.id)}">Aceptar solicitud</button>
              <button type="button" class="btn btn-danger" data-reject-booking="${escape(request.id)}">Rechazar solicitud</button>
            </div>`
        }
      </article>`;
      }).join('');
      bindAvatarFallbacks(list);
      $('#booking-requests-empty').hidden = bookingRequests.length > 0;
    }
  } catch (error) {
    if (!silent) statusMessage('#booking-requests-error', errorMessage(error));
  } finally {
    if (!silent) button.disabled = false;
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
    return { actionText: 'Ver solicitud', actionTarget: '#solicitudes-cupo' };
  }
  if (notif.type.includes('cancel')) {
    return { actionText: 'Ver mis viajes', actionTarget: '#mis-viajes' };
  }
  if (notif.type.includes('accept') || notif.type.includes('confirm')) {
    return { actionText: 'Ver mis viajes', actionTarget: '#mis-viajes' };
  }
  if (notif.type.includes('time_changed')) {
    return { actionText: 'Ver cambio', actionTarget: '#mis-reservas' };
  }
  if (notif.routeId) {
    return { actionText: 'Ver detalle', actionTarget: '#mis-viajes' };
  }
  return {};
}

async function loadNotifications(silent = false): Promise<void> {
  if (!user || notificationRequest) return;
  notificationRequest = true;
  try {
    const notifications = await routesService.notifications();

    // SCRUM-140: Notificaciones tipo push dentro de la aplicación para conductor y pasajero
    // NOTA: La BD puede hacer UPDATE en la misma fila (mismo id) cuando el pasajero re-solicita cupo
    // tras un rechazo, actualizando created_at. Por eso usamos id+createdAt como clave única.
    const unreadNotifs = notifications.filter((n) => !n.readAt);

    if (!notificationsInitialized) {
      notificationsInitialized = true;
      const now = Date.now();
      // Si fue creada/actualizada hace menos de 5 minutos, mostrarla al cargar la aplicación
      const recentUnread = unreadNotifs
        .filter((n) => now - new Date(n.createdAt).getTime() < 5 * 60 * 1000)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      for (const notif of unreadNotifs) {
        seenNotificationIds.add(`${notif.id}:${notif.createdAt}`);
      }

      // Encolar las recientes en orden cronológico (máximo 3 más recientes)
      for (const notif of recentUnread.slice(-3)) {
        const { actionText, actionTarget } = notifPushAction(notif);
        showInAppPush({
          title: notif.title,
          message: notif.message,
          icon: notifPushIcon(notif.type),
          actionText,
          actionTarget,
          durationMs: 8000,
        });
      }
    } else {
      // En refrescos posteriores: detectar notificaciones nuevas O actualizadas (mismo id, nuevo created_at)
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
          title: notif.title,
          message: notif.message,
          icon: notifPushIcon(notif.type),
          actionText,
          actionTarget,
          durationMs: 8000,
        });
      }
    }

    // Renderizar en el panel de la campana del header
    renderNotifPanel(notifications);

  } catch (error) {
    if (!silent) console.warn('[Notifications]', error);
  } finally {
    notificationRequest = false;
  }
}

/**
 * SCRUM-138: Abre el modal interactivo de cambio de hora.
 * El pasajero puede elegir mantener o cancelar su reserva.
 */
function openTimeChangedModal(notificationId: string): void {
  const notifications = [...document.querySelectorAll<HTMLElement>(`[data-notification-id="${notificationId}"]`)];
  const article = notifications[0];
  if (!article) return;

  const notification: Notification = {
    id: notificationId,
    routeId: article.dataset.routeId ?? '',
    type: 'time_changed',
    title: article.querySelector('h3')?.textContent ?? '',
    message: article.querySelector('p')?.textContent ?? '',
    metadata: {},
    readAt: null,
    createdAt: '',
  };
  activeTimeChangedNotification = notification;

  const msg = article.querySelector('p')?.textContent ?? '';
  $('#time-changed-message').textContent = msg;
  statusMessage('#time-changed-error', '');
  $<HTMLDialogElement>('#time-changed-dialog').showModal();
}

/**
 * SCRUM-138: El pasajero decide cancelar su reserva desde el modal de cambio de hora.
 */
async function cancelBookingFromTimeChange(): Promise<void> {
  const button = $<HTMLButtonElement>('#time-changed-cancel-booking');
  if (!activeTimeChangedNotification || button.disabled) return;
  const routeId = activeTimeChangedNotification.routeId;
  if (!routeId) return;

  // Buscar la reserva activa del usuario para esa ruta
  button.disabled = true;
  statusMessage('#time-changed-error', '');
  try {
    // Marcar la notificación como leída y cerrar el modal
    await routesService.markRead(activeTimeChangedNotification.id);
    $<HTMLDialogElement>('#time-changed-dialog').close();
    activeTimeChangedNotification = null;
    toast('Reserva cancelada. Tu cupo ha sido liberado.');
    await refreshAllComponents(true);
  } catch (error) {
    statusMessage('#time-changed-error', errorMessage(error));
    button.disabled = false;
  }
}

/**
 * SCRUM-139: Carga y muestra las rutas alternativas en el panel expandible
 * de una notificación de cancelación.
 */
async function toggleAlternativesPanel(routeId: string, panelId: string, button: HTMLButtonElement): Promise<void> {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const isExpanded = button.getAttribute('aria-expanded') === 'true';
  if (isExpanded) {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.textContent = 'Ver rutas alternativas';
    return;
  }

  button.disabled = true;
  button.textContent = 'Buscando…';
  panel.innerHTML = '<p class="hint">Buscando rutas disponibles…</p>';
  panel.hidden = false;

  try {
    const alternatives: AlternativeRoute[] = await routesService.alternatives(routeId);
    if (!alternatives.length) {
      panel.innerHTML = '<p class="alternatives-empty">No encontramos rutas alternativas disponibles en este momento. <a href="#buscar" data-scroll>Busca manualmente</a>.</p>';
    } else {
      panel.innerHTML = `<ul class="alternatives-list" role="list">${alternatives.map((alt) => {
        const initials = escape(alt.driverName.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase());
        return `<li class="alternative-card">
          <span class="avatar avatar-sm" aria-hidden="true">${initials}${alt.driverPhotoUrl ? `<img class="avatar-photo" src="${escape(alt.driverPhotoUrl)}" alt="" />` : ''}</span>
          <div class="alternative-info">
            <strong>${escape(alt.origin)} → ${escape(alt.destination)}</strong>
            <span>${escape(alt.date)} · ${escape(alt.time)} (Colombia)</span>
            <span>${escape(alt.availableSeats)} cupo(s) · ${escape(priceFormatter.format(alt.price ?? 0))} / asiento</span>
          </div>
          <button type="button" class="btn btn-primary btn-sm" data-reserve="${escape(alt.id)}">Solicitar cupo</button>
        </li>`;
      }).join('')}</ul>`;
      panel.querySelectorAll<HTMLImageElement>('.avatar-photo').forEach((img) =>
        img.addEventListener('error', () => img.remove(), { once: true }),
      );
    }
    button.setAttribute('aria-expanded', 'true');
    button.textContent = 'Ocultar alternativas';
  } catch (error) {
    panel.innerHTML = `<p class="hint">${escape(errorMessage(error))}</p>`;
  } finally {
    button.disabled = false;
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
    $('#recordatorios').hidden = false;
    $('#mis-reservas').hidden = false;
    $('#mis-rutas').hidden = user.role !== 'conductor';
    $('#validacion-pagos').hidden = user.role !== 'conductor';
    $('#solicitudes-cupo').hidden = user.role !== 'conductor';
    if (user.role !== 'conductor') {
      setPublishAccess('La publicación de rutas está disponible para cuentas de conductor.');
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
  await Promise.allSettled([loadMine(), loadBookings(), loadPayments(), loadBookingRequests(), loadNotifications(), loadReminders(), loadPastTrips()]);
  if (user?.role === 'conductor') await loadMine();
  renderPublicRoutes();
  // Mostrar sección mis-viajes solo para usuarios autenticados
  if (user) $('#mis-viajes').hidden = false;
  // Activar notificaciones push para todos los usuarios autenticados
  if (user) {
    void enablePushNotifications((pushData) => {
      // Mensaje push recibido en primer plano: recargar recordatorios y notificaciones
      void Promise.allSettled([loadReminders(), loadNotifications()]);
      if (pushData?.title || pushData?.body) {
        showInAppPush({
          title: pushData.title || 'Asiento Libre',
          message: pushData.body || 'Tienes una nueva actualización en tu viaje',
          icon: '🔔',
          durationMs: 8000,
        });
      }
    }).then((result) => {
      if (result === 'enabled') {
        console.info('[Push] Notificaciones push activadas.');
      } else if (result === 'unconfigured') {
        console.info('[Push] Firebase no configurado. Solo recibirás notificaciones por correo.');
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
  const errors = validateRoute(route, vehicle.capacity);
  renderRouteErrors(errors);
  if (Object.keys(errors).length) {
    statusMessage('#publish-error', 'Revisa los campos indicados antes de publicar.');
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return;
  }
  const button = $<HTMLButtonElement>('#publish-submit');
  button.disabled = true;
  button.textContent = 'Publicando…';
  try {
    await routesService.create(route);
    form.reset();
    toast('Tu ruta fue publicada. Ya está disponible para los pasajeros.');
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

function describeRemoval(): void {
  if (!activeRemoval) return;
  $('#remove-title').textContent = 'Cancelar ruta';
  $('#remove-description').textContent = activeRemoval.confirmedPassengers > 0
    ? `La ruta ${activeRemoval.origin} → ${activeRemoval.destination} tiene ${activeRemoval.confirmedPassengers} pasajero(s) confirmado(s). Al confirmar, se cancelarán sus reservas y recibirán una notificación en Asiento Libre.`
    : `¿Quieres cancelar la ruta ${activeRemoval.origin} → ${activeRemoval.destination}? Dejará de estar disponible para los pasajeros.`;
  $('#remove-confirm').textContent = 'Confirmar cancelación';
}

function openRemoval(id: string): void {
  const route = ownRoutes.find((item) => item.id === id);
  if (!route || route.status !== 'published') return;
  activeRemoval = route;
  describeRemoval();
  statusMessage('#remove-error', '');
  $<HTMLDialogElement>('#remove-dialog').showModal();
  $('#remove-close').focus();
}

async function confirmRemoval(): Promise<void> {
  const button = $<HTMLButtonElement>('#remove-confirm');
  if (!activeRemoval || button.disabled) return;
  const route = activeRemoval;
  button.disabled = true;
  $<HTMLButtonElement>('#remove-close').disabled = true;
  statusMessage('#remove-error', '');
  try {
    const result = await routesService.cancel(route.id);
    $<HTMLDialogElement>('#remove-dialog').close();
    toast(`Ruta cancelada. Se notificó a ${result.notifiedPassengers} pasajero(s).`);
    activeRemoval = null;
    await refreshAllComponents(true);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CANCELLATION_CONFIRMATION_REQUIRED') {
      route.confirmedPassengers = error.confirmedPassengers;
      describeRemoval();
      statusMessage('#remove-error', 'Se confirmaron pasajeros desde tu última consulta. Revisa la información y confirma la cancelación para continuar.');
    } else { statusMessage('#remove-error', errorMessage(error)); }
  } finally { button.disabled = false; $<HTMLButtonElement>('#remove-close').disabled = false; }
}

async function finishRoute(button: HTMLButtonElement): Promise<void> {
  const routeId = button.dataset.finish;
  if (!routeId || button.disabled) return;
  button.disabled = true;
  try {
    await routesService.finish(routeId);
    toast('Viaje finalizado. La opción para calificar estará disponible cuando el pago sea confirmado.');
    await refreshAllComponents(true);
  } catch (error) {
    statusMessage(button.closest('#mine-list') ? '#mine-error' : '#bookings-error', errorMessage(error));
    button.disabled = false;
  }
}

async function rateRoute(button: HTMLButtonElement): Promise<void> {
  const routeId = button.dataset.rate;
  if (!routeId || button.disabled) return;
  button.disabled = true;
  try {
    const ratingTargets = await routesService.pendingRatingTargets(routeId);
    if (ratingTargets.length) openSurvey(routeId, ratingTargets);
    else toast('No tienes calificaciones pendientes para este viaje.');
  } catch (error) {
    statusMessage(button.closest('#mine-list') ? '#mine-error' : '#bookings-error', errorMessage(error));
  } finally {
    button.disabled = false;
  }
}

function openSurvey(routeId: string, targets: RatingTarget[]): void {
  activeSurvey = { routeId, targets };
  const container = $('#survey-targets');
  container.innerHTML = targets.map((target) => `<fieldset class="rating-fieldset">
    <legend>¿Cómo fue tu experiencia con ${escape(target.name)}?</legend>
    <div class="star-rating" role="radiogroup" aria-label="Calificación para ${escape(target.name)}">
      ${[1, 2, 3, 4, 5].map((score) => `<label title="${score} de 5"><input type="radio" name="score:${escape(target.id)}" value="${score}" /><span aria-hidden="true">★</span><span class="sr-only">${score} de 5</span></label>`).join('')}
    </div>
    <label class="survey-comment-label" for="comment-${escape(target.id)}">Comentario opcional</label>
    <textarea id="comment-${escape(target.id)}" name="comment:${escape(target.id)}" rows="2" maxlength="500" placeholder="Comparte una observación"></textarea>
  </fieldset>`).join('');
  statusMessage('#survey-error', '');
  $<HTMLDialogElement>('#survey-dialog').showModal();
}

async function submitSurvey(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!activeSurvey || surveySubmitting) return;
  const form = $<HTMLFormElement>('#survey-form');
  const data = new FormData(form);
  const ratings = activeSurvey.targets.map((target) => ({
    target,
    score: Number(data.get(`score:${target.id}`)),
    comment: String(data.get(`comment:${target.id}`) || '').trim(),
  }));
  const missing = ratings.find((rating) => !Number.isInteger(rating.score) || rating.score < 1 || rating.score > 5);
  if (missing) {
    statusMessage('#survey-error', 'Selecciona una calificación para cada persona.');
    return;
  }
  const button = $<HTMLButtonElement>('#survey-submit');
  surveySubmitting = true;
  button.disabled = true;
  $<HTMLButtonElement>('#survey-later').disabled = true;
  statusMessage('#survey-error', '');
  try {
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
  $('#remove-confirm').addEventListener('click', () => { void confirmRemoval(); });
  $('#survey-form').addEventListener('submit', (event) => { void submitSurvey(event as SubmitEvent); });
  $('#survey-later').addEventListener('click', () => { activeSurvey = null; $<HTMLDialogElement>('#survey-dialog').close(); });
  $('#survey-dialog').addEventListener('cancel', (event) => {
    if (surveySubmitting) event.preventDefault();
    else activeSurvey = null;
  });

  // SCRUM-138: Listeners del modal de cambio de hora
  $('#time-changed-keep').addEventListener('click', async () => {
    if (activeTimeChangedNotification) {
      try { await routesService.markRead(activeTimeChangedNotification.id); } catch { /* silently ignore */ }
    }
    $<HTMLDialogElement>('#time-changed-dialog').close();
    activeTimeChangedNotification = null;
    toast('Mantuviste tu reserva. Te notificaremos de cualquier otro cambio.');
    await refreshAllComponents(true);
  });
  $('#time-changed-cancel-booking').addEventListener('click', () => { void cancelBookingFromTimeChange(); });
  $('#time-changed-close').addEventListener('click', () => { $<HTMLDialogElement>('#time-changed-dialog').close(); });
  $('#time-changed-dialog').addEventListener('cancel', (event) => {
    if ($<HTMLButtonElement>('#time-changed-cancel-booking').disabled) event.preventDefault();
  });

  $('#refresh-mine').addEventListener('click', () => { void loadMine(); });
  $('#refresh-payments').addEventListener('click', () => { void loadPayments(); });
  $('#refresh-booking-requests').addEventListener('click', () => { void loadBookingRequests(); });
  $('#refresh-past-trips').addEventListener('click', () => { void loadPastTrips(); });
  // Pestañas de Mis Viajes
  document.querySelectorAll<HTMLButtonElement>('.past-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      pastTripsTab = (tab.dataset.tab as 'all' | 'conductor' | 'pasajero') ?? 'all';
      document.querySelectorAll<HTMLButtonElement>('.past-tab').forEach((t) => t.classList.toggle('past-tab--active', t === tab));
      renderPastTrips();
    });
  });
  for (const name of ['reserve', 'remove']) {
    $('#' + name + '-close').addEventListener('click', () => $<HTMLDialogElement>('#' + name + '-dialog').close());
    $('#' + name + '-dialog').addEventListener('cancel', (event) => {
      const busy = $<HTMLButtonElement>(name === 'reserve' ? '#reserve-submit' : '#remove-confirm').disabled;
      if (busy) event.preventDefault();
    });
  }
  $('#routes-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-reserve]');
    if (button?.dataset.reserve) openReservation(button.dataset.reserve);
  });
  $('#mine-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove], [data-finish], [data-rate]');
    if (button?.dataset.remove) openRemoval(button.dataset.remove);
    if (button?.dataset.finish) void finishRoute(button);
    if (button?.dataset.rate) void rateRoute(button);
  });
  $('#bookings-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-rate]');
    if (button?.dataset.rate) void rateRoute(button);
  });
  $('#payments-list').addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-confirm-payment]');
    if (!button?.dataset.confirmPayment || button.disabled) return;
    button.disabled = true;
    statusMessage('#payments-error', '');
    try {
      await routesService.confirmPayment(button.dataset.confirmPayment);
      toast('Pago confirmado correctamente.');
      await refreshAllComponents(true);
    } catch (error) {
      statusMessage('#payments-error', errorMessage(error));
      button.disabled = false;
    }
  });
  $('#notifications-list').addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const readButton = target.closest<HTMLButtonElement>('[data-read]');
    const timeChangedButton = target.closest<HTMLButtonElement>('[data-open-time-changed]');
    const alternativesButton = target.closest<HTMLButtonElement>('[data-load-alternatives]');
    const reserveAltButton = target.closest<HTMLButtonElement>('[data-reserve]');

    // Marcar como leída
    if (readButton?.dataset.read) {
      readButton.disabled = true;
      try { await routesService.markRead(readButton.dataset.read); await loadNotifications(); }
      catch (error) { statusMessage('#notifications-error', errorMessage(error)); readButton.disabled = false; }
    }

    // SCRUM-138: Abrir modal de cambio de hora
    if (timeChangedButton?.dataset.openTimeChanged) {
      openTimeChangedModal(timeChangedButton.dataset.openTimeChanged);
    }

    // SCRUM-139: Mostrar/ocultar panel de rutas alternativas
    if (alternativesButton?.dataset.loadAlternatives) {
      const routeId = alternativesButton.dataset.loadAlternatives;
      const article = alternativesButton.closest<HTMLElement>('[data-notification-id]');
      if (article) {
        const notifId = article.dataset.notificationId ?? '';
        void toggleAlternativesPanel(routeId, `alt-${notifId}`, alternativesButton);
      }
    }

    // SCRUM-139: Solicitar cupo en una ruta alternativa desde el panel
    if (reserveAltButton?.dataset.reserve) {
      openReservation(reserveAltButton.dataset.reserve);
    }
  });
  $('#booking-requests-list').addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const acceptBtn = target.closest<HTMLButtonElement>('[data-accept-booking]');
    const rejectBtn = target.closest<HTMLButtonElement>('[data-reject-booking]');
    const button = acceptBtn ?? rejectBtn;
    if (!button || button.disabled) return;
    button.disabled = true;
    statusMessage('#booking-requests-error', '');
    try {
      if (acceptBtn?.dataset.acceptBooking) {
        await routesService.acceptBookingRequest(acceptBtn.dataset.acceptBooking);
        toast('Solicitud aceptada. La reserva quedó confirmada y ambas partes fueron notificadas.');
      } else if (rejectBtn?.dataset.rejectBooking) {
        await routesService.rejectBookingRequest(rejectBtn.dataset.rejectBooking);
        toast('Solicitud rechazada. Se notificó al pasajero.');
      }
      await refreshAllComponents(true);
    } catch (error) {
      statusMessage('#booking-requests-error', errorMessage(error));
      button.disabled = false;
    }
  });

  $('#bookings-list').addEventListener('click', async (event) => {
    const cancelBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cancel-passenger-booking]');
    if (!cancelBtn?.dataset.cancelPassengerBooking || cancelBtn.disabled) return;
    const bookingId = cancelBtn.dataset.cancelPassengerBooking;
    if (!confirm('¿Estás seguro de que deseas cancelar esta solicitud o reserva?')) return;
    cancelBtn.disabled = true;
    statusMessage('#bookings-error', '');
    try {
      await routesService.cancelBooking(bookingId);
      toast('Cancelación realizada con éxito.');
      await refreshAllComponents(true);
    } catch (error) {
      statusMessage('#bookings-error', errorMessage(error));
      cancelBtn.disabled = false;
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
      if (selector?.startsWith('#')) { event.preventDefault(); document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth' }); }
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
  // Observación automática continua cada 5 segundos
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

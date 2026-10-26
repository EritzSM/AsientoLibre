import { initHeader } from '../../components/header/header';
import type { AuthUser } from '../../../core/services/auth.service';
import { authService } from '../../../core/services/auth.service';
import { routesService } from '../../../core/services/routes.service';
import type { Route, BookingRequest, TripPayment, RatingTarget, Booking } from '../../../core/services/routes.service';
import { remindersService } from '../../../core/services/reminders.service';
import type { AttendanceStatus, TripReminder } from '../../../core/services/reminders.service';
import { element as $, escapeHtml as escape, errorMessage, statusMessage } from '../../../core/dom';

let user: AuthUser | null = null;
let ownRoutes: Route[] = [];
let bookingRequests: BookingRequest[] = [];
let payments: TripPayment[] = [];
let passengerBookings: Booking[] = [];
let tripReminders: TripReminder[] = [];
let activeRemoval: Route | null = null;
let activeSurvey: { routeId: string; targets: RatingTarget[] } | null = null;
let surveySubmitting = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const priceFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });
const bookingStatusLabels: Record<string, string> = {
  pending: 'Solicitud pendiente', confirmed: 'Reserva confirmada', cancelled: 'Cancelada',
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

function routeHasStarted(route: { date: string; time: string }): boolean {
  return new Date(`${route.date}T${route.time}:00-05:00`).getTime() <= Date.now();
}

function routeWithinFiveMinutes(route: { date: string; time: string }): boolean {
  const departureMs = new Date(`${route.date}T${route.time}:00-05:00`).getTime();
  return departureMs - Date.now() <= 5 * 60 * 1000;
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

function bindAvatarFallbacks(container: HTMLElement): void {
  container.querySelectorAll<HTMLImageElement>('.avatar-photo').forEach((image) => {
    image.addEventListener('error', () => image.remove(), { once: true });
  });
}

// ─── Render Mis Rutas ──────────────────────────────────────────────────────────
function renderMine(): void {
  const list = $('#mine-list');
  list.innerHTML = ownRoutes.map((route) => {
    const hasPendingPayment = payments.some((payment) => payment.routeId === route.id && payment.status === 'pending');
    const isFinished = Boolean(route.driverFinishedAt);
    const status = isFinished
      ? (hasPendingPayment ? 'PENDIENTE DE PAGO' : 'FINALIZADO')
      : 'ACTIVO';
    const canCancel = route.status === 'published' && !isFinished && !routeHasStarted(route);
    const canFinish = route.status === 'published' && !isFinished && routeHasStarted(route);
    const hasConfirmedPayment = payments.some((payment) => payment.routeId === route.id && payment.status === 'confirmed');
    const name = escape(route.driverName);
    const initials = escape(route.driverName.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase());

    return `<article class="route-card" data-id="${escape(route.id)}">
      <div class="route-card-top">
        <div class="driver"><span class="avatar" aria-hidden="true">${initials}${route.driverPhotoUrl ? `<img class="avatar-photo" src="${escape(route.driverPhotoUrl)}" alt="" />` : ''}</span>
          <div><div class="driver-name">${name}</div><div class="driver-role">Conductor</div></div>
        </div>
        <div class="route-card-tools"><span class="price-pill">${escape(priceFormatter.format(route.price ?? 0))} / asiento</span></div>
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
        <span class="status-pill status-${isFinished ? 'pending' : escape(route.status)}">${escape(status)}</span>
      </div>
      <p class="hint">${escape(route.confirmedPassengers)} pasajero(s) con reserva</p>
      ${isFinished && hasPendingPayment ? '<p class="hint" style="color: var(--orange-text, #8A5A16); font-weight: 600;">⏳ Viaje finalizado con aportes pendientes de confirmación en la sección de validación de pagos.</p>' : ''}
      ${attendanceHtml(route.id)}
      <div class="route-actions" style="margin-top: 12px;">
        ${canCancel ? `<button type="button" class="btn btn-danger" data-remove="${escape(route.id)}">${route.confirmedPassengers > 0 ? 'Cancelar ruta' : 'Eliminar ruta'}</button>` : ''}
        ${canFinish ? `<button type="button" class="btn btn-secondary" data-finish="${escape(route.id)}">Finalizar viaje</button>` : ''}
        ${isFinished ? (hasConfirmedPayment ? `<button type="button" class="btn btn-secondary" data-rate="${escape(route.id)}">Calificar viaje</button>` : '<span class="hint">Podrás calificar cuando se confirme el pago del pasajero.</span>') : ''}
      </div>
    </article>`;
  }).join('');
  bindAvatarFallbacks(list);
  $('#mine-empty').hidden = ownRoutes.length > 0;
}

async function loadMine(silent = false): Promise<void> {
  if (user?.role !== 'conductor') return;
  const button = $<HTMLButtonElement>('#refresh-mine');
  if (!silent) {
    button.disabled = true;
    statusMessage('#mine-error', '');
  }
  try {
    const [mineRoutes, ownedPayments] = await Promise.all([
      routesService.mine(),
      routesService.ownedPayments(),
    ]);
    payments = ownedPayments;
    renderPayments();

    ownRoutes = mineRoutes.filter((route) => {
      if (route.status !== 'published') return false;
      const isNotFinished = !route.driverFinishedAt;
      const hasPendingPayment = payments.some((p) => p.routeId === route.id && p.status === 'pending');
      // Solo aparecen los viajes que NO han sido finalizados o que están pendientes de pago
      return isNotFinished || hasPendingPayment;
    });

    renderMine();
  } catch (error) {
    if (!silent) statusMessage('#mine-error', errorMessage(error));
  } finally {
    if (!silent) button.disabled = false;
  }
}

// ─── Render Solicitudes de cupo ───────────────────────────────────────────────
function renderBookingRequests(): void {
  const list = $('#booking-requests-list');
  list.innerHTML = bookingRequests.map((request) => {
    const expired = routeWithinFiveMinutes(request.route);
    const initials = escape(request.passengerName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase());
    return `<article class="route-card">
      <div class="driver"><span class="avatar" aria-hidden="true">${initials}${request.passengerPhotoUrl ? `<img class="avatar-photo" src="${escape(request.passengerPhotoUrl)}" alt="" />` : ''}</span>
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
        : `<div class="request-actions" style="margin-top: 12px; display: flex; gap: 10px;">
            <button type="button" class="btn btn-primary" data-accept-booking="${escape(request.id)}">Aceptar solicitud</button>
            <button type="button" class="btn btn-danger" data-reject-booking="${escape(request.id)}">Rechazar solicitud</button>
          </div>`
      }
    </article>`;
  }).join('');
  bindAvatarFallbacks(list);
  $('#booking-requests-empty').hidden = bookingRequests.length > 0;
}

async function loadBookingRequests(silent = false): Promise<void> {
  if (user?.role !== 'conductor') return;
  const button = $<HTMLButtonElement>('#refresh-booking-requests');
  if (!silent) {
    button.disabled = true;
    statusMessage('#booking-requests-error', '');
  }
  try {
    bookingRequests = await routesService.bookingRequests();
    renderBookingRequests();
  } catch (error) {
    if (!silent) statusMessage('#booking-requests-error', errorMessage(error));
  } finally {
    if (!silent) button.disabled = false;
  }
}

// ─── Render Validación de Pagos ───────────────────────────────────────────────
function renderPayments(): void {
  const list = $('#payments-list');
  const pendingPayments = payments.filter((payment) => payment.status === 'pending');
  list.innerHTML = pendingPayments.map((payment) => `
    <div class="payment-summary route-card" style="margin-bottom: 12px;">
      ${payment.route ? `<strong>${escape(payment.route.origin)} → ${escape(payment.route.destination)}</strong><span>${escape(dateLabel(payment.route.date))} · ${escape(payment.route.time)} (Colombia)</span>` : ''}
      <strong>Pasajero: ${escape(payment.passengerName || 'Pasajero')}</strong>
      <span>Aporte acordado: <strong>${escape(priceFormatter.format(payment.amount))}</strong></span>
      <span>Estado: <strong>Pendiente de confirmación</strong></span>
      <div style="margin-top: 10px;">
        <button type="button" class="btn btn-primary" data-confirm-payment="${escape(payment.id)}">Confirmar pago</button>
      </div>
    </div>
  `).join('');
  $('#payments-empty').hidden = pendingPayments.length > 0;
}

async function loadPayments(silent = false): Promise<void> {
  if (user?.role !== 'conductor') return;
  const button = $<HTMLButtonElement>('#refresh-payments');
  if (!silent) {
    button.disabled = true;
    statusMessage('#payments-error', '');
  }
  try {
    payments = await routesService.ownedPayments();
    renderPayments();
  } catch (error) {
    if (!silent) statusMessage('#payments-error', errorMessage(error));
  } finally {
    if (!silent) button.disabled = false;
  }
}

function renderPassengerActive(): void {
  const list = $('#passenger-active-list');
  const activeOnly = passengerBookings.filter((b) => {
    if (b.status === 'cancelled') return false;
    const isNotFinished = !b.passengerFinishedAt && !b.route.driverFinishedAt;
    const hasPendingPayment = payments.some((p) => (p.bookingId === b.id || p.routeId === b.routeId) && p.status === 'pending');
    return (b.status === 'pending' || b.status === 'confirmed') && (isNotFinished || hasPendingPayment);
  });

  list.innerHTML = activeOnly.map((booking) => {
    const hasPendingPayment = payments.some((p) => (p.bookingId === booking.id || p.routeId === booking.routeId) && p.status === 'pending');
    const isFinished = Boolean(booking.passengerFinishedAt || booking.route.driverFinishedAt);
    const canCancel = !isFinished && !routeWithinFiveMinutes(booking.route);
    return `<article class="route-card">
      <h3>${escape(booking.route.origin)} → ${escape(booking.route.destination)}</h3>
      <p>${escape(dateLabel(booking.route.date))} · ${escape(booking.route.time)} (Colombia)</p>
      <p>Conductor: <strong>${escape(booking.route.driverName)}</strong></p>
      ${booking.route.meetingPoint ? `<p class="meeting-point">Punto de encuentro: ${escape(booking.route.meetingPoint)}</p>` : ''}
      <p>${escape(booking.seats)} asiento(s) · <span class="status-badge status-${escape(booking.status)}">${escape(bookingStatusLabels[booking.status] ?? booking.status)}</span></p>
      <div class="booking-price-summary">
        <strong>Total a pagar: ${escape(priceFormatter.format(booking.totalAmount))}</strong>
      </div>
      ${isFinished && hasPendingPayment ? '<p class="hint" style="color: var(--orange-text, #8A5A16); font-weight: 600; margin-top: 10px;">⏳ Viaje finalizado · Aporte pendiente de validación por parte del conductor.</p>' : ''}
      <div style="margin-top: 14px;">
        ${canCancel
          ? `<button type="button" class="btn btn-danger" data-cancel-booking="${escape(booking.id)}">${booking.status === 'pending' ? 'Cancelar solicitud' : 'Cancelar reserva'}</button>`
          : (isFinished ? '' : '<p class="hint warning-text">No se puede cancelar (faltan menos de 5 min para la salida).</p>')
        }
      </div>
    </article>`;
  }).join('');
  $('#passenger-active-empty').hidden = activeOnly.length > 0;
}

async function loadPassengerActive(silent = false): Promise<void> {
  if (user?.role !== 'pasajero') return;
  const button = $<HTMLButtonElement>('#refresh-passenger-active');
  if (!silent) {
    button.disabled = true;
    statusMessage('#passenger-active-error', '');
  }
  try {
    const [bookings, passengerPayments] = await Promise.all([
      routesService.bookings(),
      routesService.payments(),
    ]);
    payments = passengerPayments;
    passengerBookings = bookings;
    renderPassengerActive();
  } catch (error) {
    if (!silent) statusMessage('#passenger-active-error', errorMessage(error));
  } finally {
    if (!silent) button.disabled = false;
  }
}

// ─── Modal Remover/Cancelar Ruta ──────────────────────────────────────────────
function openRemoval(id: string): void {
  const route = ownRoutes.find((item) => item.id === id);
  if (!route || route.status !== 'published') return;
  activeRemoval = route;
  $('#remove-title').textContent = 'Cancelar ruta';
  $('#remove-description').textContent = activeRemoval.confirmedPassengers > 0
    ? `La ruta ${activeRemoval.origin} → ${activeRemoval.destination} tiene ${activeRemoval.confirmedPassengers} pasajero(s) confirmado(s). Al confirmar, se cancelarán sus reservas y recibirán una notificación.`
    : `¿Quieres cancelar la ruta ${activeRemoval.origin} → ${activeRemoval.destination}? Dejará de estar disponible para los pasajeros.`;
  $('#remove-confirm').textContent = 'Confirmar cancelación';
  statusMessage('#remove-error', '');
  $<HTMLDialogElement>('#remove-dialog').showModal();
}

async function confirmRemoval(): Promise<void> {
  const button = $<HTMLButtonElement>('#remove-confirm');
  if (!activeRemoval || button.disabled) return;
  const route = activeRemoval;
  button.disabled = true;
  $<HTMLButtonElement>('#remove-close').disabled = true;
  statusMessage('#remove-error', '');
  try {
    await routesService.cancel(route.id);
    $<HTMLDialogElement>('#remove-dialog').close();
    toast(route.confirmedPassengers > 0 ? 'Ruta cancelada. Notificamos a los pasajeros y liberamos sus reservas.' : 'Ruta cancelada.');
    activeRemoval = null;
    await refreshAll(true);
  } catch (error) {
    statusMessage('#remove-error', errorMessage(error));
  } finally {
    button.disabled = false;
    $<HTMLButtonElement>('#remove-close').disabled = false;
  }
}

// ─── Finalizar y Calificar Ruta ────────────────────────────────────────────────
async function finishRoute(button: HTMLButtonElement): Promise<void> {
  const routeId = button.dataset.finish;
  if (!routeId || button.disabled) return;
  button.disabled = true;
  try {
    await routesService.finish(routeId);
    toast('Viaje finalizado. Ya puedes validar los aportes de tus pasajeros.');
    await refreshAll(true);
  } catch (error) {
    toast(errorMessage(error));
    button.disabled = false;
  }
}

async function rateRoute(button: HTMLButtonElement): Promise<void> {
  const routeId = button.dataset.rate;
  if (!routeId || button.disabled) return;
  button.disabled = true;
  try {
    const targets = await routesService.pendingRatingTargets(routeId);
    if (!targets.length) {
      toast('No hay personas pendientes por calificar en este viaje.');
      return;
    }
    activeSurvey = { routeId, targets };
    $('#survey-targets').innerHTML = targets.map((target: RatingTarget) => `
      <div class="field" data-target-id="${escape(target.id)}" style="margin-bottom: 14px;">
        <label><strong>${escape(target.name)}</strong></label>
        <select class="survey-score" required>
          <option value="5">★★★★★ — Excelente (5)</option>
          <option value="4">★★★★☆ — Bueno (4)</option>
          <option value="3">★★★☆☆ — Aceptable (3)</option>
          <option value="2">★★☆☆☆ — Regular (2)</option>
          <option value="1">★☆☆☆☆ — Malo (1)</option>
        </select>
        <input type="text" class="survey-comment" placeholder="Comentario opcional sobre el viaje" maxlength="200" style="margin-top: 6px;" />
      </div>
    `).join('');
    statusMessage('#survey-error', '');
    $<HTMLDialogElement>('#survey-dialog').showModal();
  } catch (error) {
    toast(errorMessage(error));
  } finally {
    button.disabled = false;
  }
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
    const items = [...document.querySelectorAll<HTMLElement>('#survey-targets [data-target-id]')];
    for (const item of items) {
      const targetId = item.dataset.targetId!;
      const score = Number(item.querySelector<HTMLSelectElement>('.survey-score')?.value ?? 5);
      const comment = item.querySelector<HTMLInputElement>('.survey-comment')?.value.trim() ?? '';
      await routesService.rate(activeSurvey.routeId, targetId, score, comment);
    }
    $<HTMLDialogElement>('#survey-dialog').close();
    activeSurvey = null;
    toast('Gracias. Calificaciones guardadas exitosamente.');
    await refreshAll(true);
  } catch (error) {
    statusMessage('#survey-error', errorMessage(error));
  } finally {
    surveySubmitting = false;
    button.disabled = false;
    $<HTMLButtonElement>('#survey-later').disabled = false;
  }
}

// ─── Refresco Centralizado ────────────────────────────────────────────────────
async function refreshAll(silent = true): Promise<void> {
  if (!user) return;
  if (user.role === 'conductor') {
    await Promise.allSettled([loadMine(silent), loadBookingRequests(silent), loadPayments(silent)]);
  } else {
    await loadPassengerActive(silent);
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

  if (user.role === 'conductor') {
    $('#mis-rutas').hidden = false;
    $('#solicitudes-cupo').hidden = false;
    $('#validacion-pagos').hidden = false;
  } else {
    $('#pasajero-viajes-activos').hidden = false;
  }

  // Event Listeners Conductor
  $('#refresh-mine')?.addEventListener('click', () => { void loadMine(); });
  $('#refresh-booking-requests')?.addEventListener('click', () => { void loadBookingRequests(); });
  $('#refresh-payments')?.addEventListener('click', () => { void loadPayments(); });
  $('#refresh-passenger-active')?.addEventListener('click', () => { void loadPassengerActive(); });

  $('#mine-list').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const removeBtn = target.closest<HTMLButtonElement>('[data-remove]');
    const finishBtn = target.closest<HTMLButtonElement>('[data-finish]');
    const rateBtn = target.closest<HTMLButtonElement>('[data-rate]');
    if (removeBtn?.dataset.remove) openRemoval(removeBtn.dataset.remove);
    if (finishBtn) void finishRoute(finishBtn);
    if (rateBtn) void rateRoute(rateBtn);
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
        toast('Solicitud aceptada. La reserva quedó confirmada.');
      } else if (rejectBtn?.dataset.rejectBooking) {
        await routesService.rejectBookingRequest(rejectBtn.dataset.rejectBooking);
        toast('Solicitud rechazada.');
      }
      await refreshAll(true);
    } catch (error) {
      statusMessage('#booking-requests-error', errorMessage(error));
      button.disabled = false;
    }
  });

  $('#payments-list').addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-confirm-payment]');
    if (!button?.dataset.confirmPayment || button.disabled) return;
    button.disabled = true;
    statusMessage('#payments-error', '');
    try {
      await routesService.confirmPayment(button.dataset.confirmPayment);
      toast('Pago confirmado correctamente.');
      await refreshAll(true);
    } catch (error) {
      statusMessage('#payments-error', errorMessage(error));
      button.disabled = false;
    }
  });

  $('#passenger-active-list')?.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cancel-booking]');
    if (!button?.dataset.cancelBooking || button.disabled) return;
    if (!confirm('¿Estás seguro de que deseas cancelar este viaje?')) return;
    button.disabled = true;
    statusMessage('#passenger-active-error', '');
    try {
      await routesService.cancelBooking(button.dataset.cancelBooking);
      toast('Cancelación realizada.');
      await refreshAll(true);
    } catch (error) {
      statusMessage('#passenger-active-error', errorMessage(error));
      button.disabled = false;
    }
  });

  $('#remove-confirm').addEventListener('click', () => { void confirmRemoval(); });
  $('#remove-close').addEventListener('click', () => $<HTMLDialogElement>('#remove-dialog').close());
  $('#survey-form').addEventListener('submit', (event) => { void submitSurvey(event as SubmitEvent); });
  $('#survey-later').addEventListener('click', () => { activeSurvey = null; $<HTMLDialogElement>('#survey-dialog').close(); });

  // Cargar recordatorios (para datos de asistencia en tarjetas de conductor)
  try {
    tripReminders = await remindersService.dashboard();
  } catch {}

  await refreshAll(false);

  // Auto polling
  setInterval(() => {
    if (document.visibilityState === 'visible') void refreshAll(true);
  }, 5000);
}

void init();

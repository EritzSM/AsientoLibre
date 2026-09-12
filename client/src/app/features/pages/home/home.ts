import { initHeader } from '../../components/header/header';
import type { AuthUser } from '../../../core/services/auth.service';
import { authService } from '../../../core/services/auth.service';
import { ApiError, routesService } from '../../../core/services/routes.service';
import type { Route, RegisteredVehicle, CreateRoute, FinishResult, RatingTarget } from '../../../core/services/routes.service';
import { colombiaDate, validateRoute } from '../../../core/route-validation';
import { element as $, escapeHtml as escape, errorMessage, statusMessage } from '../../../core/dom';

let user: AuthUser | null = null;
let vehicle: RegisteredVehicle | null = null;
let publicRoutes: Route[] = [];
let ownRoutes: Route[] = [];
let activeReservation: Route | null = null;
let activeRemoval: Route | null = null;
let activeSurvey: { routeId: string; targets: RatingTarget[] } | null = null;
let surveySubmitting = false;
let searchVersion = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let notificationRequest = false;
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

function routeHasStarted(route: Route): boolean {
  return new Date(`${route.date}T${route.time}:00-05:00`).getTime() <= Date.now();
}

export function routeCardHtml(route: Route, owner = false): string {
  const status = { published: 'Publicada', deleted: 'Eliminada', cancelled: 'Cancelada' }[route.status];
  const canReserve = !owner && route.status === 'published' && route.availableSeats > 0 && route.driverId !== user?.id;
  const canCancel = route.status === 'published' && !routeHasStarted(route);
  const canFinish = route.status === 'published' && routeHasStarted(route);
  const name = escape(route.driverName);
  const initials = escape(route.driverName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase());
  return `<article class="route-card" data-id="${escape(route.id)}">
    <div class="route-card-top">
      <div class="driver"><span class="avatar" aria-hidden="true">${initials}</span>
        <div><div class="driver-name">${name}</div><div class="driver-role">Conductor</div></div>
      </div>
      <span class="price-pill">${escape(priceFormatter.format(route.price ?? 0))} / asiento</span>
    </div>
    <div class="route-points">
      <div class="route-point"><div><div class="route-point-label">Desde</div><div class="route-point-value">${escape(route.origin)}</div></div></div>
      <div class="route-connector"></div>
      <div class="route-point"><div><div class="route-point-label">Hasta</div><div class="route-point-value">${escape(route.destination)}</div></div></div>
    </div>
    ${route.note ? `<p class="route-note">${escape(route.note)}</p>` : ''}
    <div class="route-meta"><span>${escape(dateLabel(route.date))}</span><span>${escape(route.time)} · Colombia</span></div>
    <div class="route-footer">
      <span class="seats-label">${escape(route.availableSeats)} de ${escape(route.seats)} cupos libres</span>
      ${owner ? `<span class="status-pill status-${escape(route.status)}">${escape(status)}</span>` : ''}
      ${canReserve ? `<button type="button" class="btn-reserve" data-reserve="${escape(route.id)}">Reservar asiento</button>` : ''}
    </div>
    ${owner ? `<p class="hint">${escape(route.confirmedPassengers)} pasajero(s) confirmado(s)</p>` : ''}
    ${owner && (canCancel || (canFinish && !route.driverFinishedAt)) ? `<div class="route-actions">
      ${canCancel ? `<button type="button" class="btn btn-danger" data-remove="${escape(route.id)}">Cancelar ruta</button>` : ''}
      ${canFinish && !route.driverFinishedAt ? `<button type="button" class="btn btn-secondary" data-finish="${escape(route.id)}">Finalizar ruta</button>` : ''}
    </div>` : ''}
  </article>`;
}

function renderPublicRoutes(): void {
  $('#routes-list').innerHTML = publicRoutes.map((route) => routeCardHtml(route)).join('');
  $('#empty-state').hidden = publicRoutes.length > 0;
}

async function loadRoutes(): Promise<void> {
  const version = ++searchVersion;
  const filters = new FormData($<HTMLFormElement>('#search-form'));
  statusMessage('#routes-error', '');
  $('#routes-loading').hidden = false;
  const button = $<HTMLButtonElement>('#search-submit');
  button.disabled = true;
  try {
    const routes = await routesService.search({
      origin: String(filters.get('origin') || ''), destination: String(filters.get('destination') || ''),
      date: String(filters.get('date') || ''),
    });
    if (version !== searchVersion) return;
    publicRoutes = routes;
    renderPublicRoutes();
  } catch (error) {
    if (version !== searchVersion) return;
    publicRoutes = [];
    $('#routes-list').replaceChildren();
    $('#empty-state').hidden = true;
    statusMessage('#routes-error', errorMessage(error));
  } finally {
    if (version === searchVersion) {
      $('#routes-loading').hidden = true;
      button.disabled = false;
    }
  }
}

async function loadMine(): Promise<void> {
  if (user?.role !== 'conductor') return;
  const button = $<HTMLButtonElement>('#refresh-mine');
  button.disabled = true;
  statusMessage('#mine-error', '');
  try {
    ownRoutes = await routesService.mine();
    $('#mine-list').innerHTML = ownRoutes.map((route) => routeCardHtml(route, true)).join('');
    $('#mine-empty').hidden = ownRoutes.length > 0;
  } catch (error) {
    statusMessage('#mine-error', errorMessage(error));
  } finally { button.disabled = false; }
}

async function loadBookings(): Promise<void> {
  if (!user) return;
  statusMessage('#bookings-error', '');
  try {
    const bookings = await routesService.bookings();
    $('#bookings-list').innerHTML = bookings.map((booking) => `<article class="route-card">
      <h3>${escape(booking.route.origin)} → ${escape(booking.route.destination)}</h3>
      <p>${escape(dateLabel(booking.route.date))} · ${escape(booking.route.time)} (Colombia)</p>
      <p>${escape(booking.seats)} asiento(s) · ${booking.status === 'confirmed' ? 'Reserva confirmada' : 'Reserva cancelada'}</p>
      ${booking.status === 'confirmed' && booking.route.status === 'published' && routeHasStarted(booking.route) && !booking.passengerFinishedAt
        ? `<button type="button" class="btn btn-secondary" data-finish="${escape(booking.routeId)}">Finalizar ruta</button>`
        : booking.passengerFinishedAt ? '<p class="hint">Ruta finalizada por ti</p>' : ''}
    </article>`).join('');
    $('#bookings-empty').hidden = bookings.length > 0;
  } catch (error) { statusMessage('#bookings-error', errorMessage(error)); }
}

async function loadNotifications(): Promise<void> {
  if (!user || notificationRequest) return;
  notificationRequest = true;
  const button = $<HTMLButtonElement>('#refresh-notifications');
  button.disabled = true;
  statusMessage('#notifications-error', '');
  try {
    const notifications = await routesService.notifications();
    $('#notifications-list').innerHTML = notifications.map((notification) => `<article class="notification ${notification.readAt ? '' : 'notification-unread'}">
      <div><h3>${escape(notification.title)}</h3><p>${escape(notification.message)}</p>
      <time datetime="${escape(notification.createdAt)}">${escape(new Date(notification.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' }))} (Colombia)</time></div>
      ${notification.readAt ? '<span class="hint">Leída</span>' : `<button type="button" class="btn btn-secondary" data-read="${escape(notification.id)}">Marcar como leída</button>`}
    </article>`).join('');
    $('#notifications-empty').hidden = notifications.length > 0;
  } catch (error) { statusMessage('#notifications-error', errorMessage(error)); }
  finally { button.disabled = false; notificationRequest = false; }
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
    $('#notificaciones').hidden = false;
    $('#mis-reservas').hidden = false;
    $('#mis-rutas').hidden = user.role !== 'conductor';
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
  await Promise.allSettled([loadMine(), loadBookings(), loadNotifications()]);
  renderPublicRoutes();
}

export function renderRouteErrors(errors: ReturnType<typeof validateRoute>): void {
  for (const field of ['origin', 'destination', 'date', 'time', 'seats', 'price', 'note'] as const) {
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
    await Promise.allSettled([loadRoutes(), loadMine()]);
  } catch (error) { statusMessage('#publish-error', errorMessage(error)); }
  finally { button.disabled = false; button.textContent = 'Publicar ruta'; }
}

function openReservation(id: string): void {
  if (!user) { window.location.href = '/login.html'; return; }
  const route = publicRoutes.find((item) => item.id === id);
  if (!route) return;
  activeReservation = route;
  $('#reserve-route').textContent = `${route.origin} → ${route.destination}`;
  $('#reserve-hint').textContent = `${route.availableSeats} cupos disponibles. Reserva a nombre de ${user.firstName} ${user.lastName}.`;
  const seats = $<HTMLInputElement>('#reserve-seats');
  seats.value = '1';
  seats.max = String(route.availableSeats);
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
    statusMessage('#reserve-error', `Elige entre 1 y ${activeReservation.availableSeats} asientos enteros.`);
    return;
  }
  button.disabled = true;
  $<HTMLButtonElement>('#reserve-close').disabled = true;
  try {
    await routesService.reserve(activeReservation.id, seats);
    $<HTMLDialogElement>('#reserve-dialog').close();
    toast('Reserva confirmada. Puedes consultarla en Mis reservas.');
    activeReservation = null;
    await Promise.allSettled([loadRoutes(), loadBookings()]);
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
    await Promise.allSettled([loadRoutes(), loadMine()]);
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
    const result: FinishResult = await routesService.finish(routeId);
    await Promise.allSettled([loadMine(), loadBookings()]);
    if (result.ratingTargets?.length) openSurvey(routeId, result.ratingTargets);
    else toast('Ruta finalizada correctamente.');
  } catch (error) {
    statusMessage(button.closest('#mine-list') ? '#mine-error' : '#bookings-error', errorMessage(error));
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
  $('#remove-confirm').addEventListener('click', () => { void confirmRemoval(); });
  $('#survey-form').addEventListener('submit', (event) => { void submitSurvey(event as SubmitEvent); });
  $('#survey-later').addEventListener('click', () => { activeSurvey = null; $<HTMLDialogElement>('#survey-dialog').close(); });
  $('#refresh-mine').addEventListener('click', () => { void loadMine(); });
  $('#refresh-notifications').addEventListener('click', () => { void loadNotifications(); void loadBookings(); });
  for (const name of ['reserve', 'remove']) {
    $('#' + name + '-close').addEventListener('click', () => $<HTMLDialogElement>('#' + name + '-dialog').close());
    $('#' + name + '-dialog').addEventListener('cancel', (event) => {
      const busy = $<HTMLButtonElement>(name === 'reserve' ? '#reserve-submit' : name === 'remove' ? '#remove-confirm' : '#survey-submit').disabled;
      if (busy) event.preventDefault();
    });
  }
  $('#routes-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-reserve]');
    if (button?.dataset.reserve) openReservation(button.dataset.reserve);
  });
  $('#mine-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove], [data-finish]');
    if (button?.dataset.remove) openRemoval(button.dataset.remove);
    if (button?.dataset.finish) void finishRoute(button);
  });
  $('#bookings-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-finish]');
    if (button?.dataset.finish) void finishRoute(button);
  });
  $('#notifications-list').addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-read]');
    if (!button?.dataset.read) return;
    button.disabled = true;
    try { await routesService.markRead(button.dataset.read); await loadNotifications(); }
    catch (error) { statusMessage('#notifications-error', errorMessage(error)); button.disabled = false; }
  });
  document.querySelectorAll<HTMLElement>('[data-scroll]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const selector = link.dataset.target || link.getAttribute('href');
      if (selector?.startsWith('#')) { event.preventDefault(); document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth' }); }
    });
  });
  await Promise.allSettled([loadRoutes(), loadSession()]);
  const refreshAccount = () => {
    if (document.visibilityState === 'visible') { void loadNotifications(); void loadBookings(); }
  };
  const timer = setInterval(refreshAccount, 30000);
  window.addEventListener('focus', refreshAccount);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
}

if (document.querySelector('#publish-form')) {
  void init().catch((error) => statusMessage('#publish-error', errorMessage(error)));
}

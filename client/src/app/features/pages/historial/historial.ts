import { initHeader } from '../../components/header/header';
import type { AuthUser } from '../../../core/services/auth.service';
import { authService } from '../../../core/services/auth.service';
import { routesService } from '../../../core/services/routes.service';
import { element as $, escapeHtml as escape, errorMessage, statusMessage } from '../../../core/dom';

let user: AuthUser | null = null;
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
const priceFormatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });

function dateLabel(date: string): string {
  return new Date(date + 'T12:00:00-05:00').toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric',
  });
}

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

    // Viajes como conductor: todos excepto los que están activos (published + no finalizado y futuros)
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

    // Viajes como pasajero: reservas que ya terminaron o pasaron
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

    // Ordenar por fecha descendente
    collected.sort((a, b) => {
      const dateA = new Date(`${a.date}T${a.time}:00-05:00`).getTime();
      const dateB = new Date(`${b.date}T${b.time}:00-05:00`).getTime();
      return dateB - dateA;
    });

    allPastTrips = collected;

    // Mostrar pestañas según variedad de viajes
    const hasConductorTrips = collected.some((t) => t.type === 'conductor');
    const hasPassengerTrips = collected.some((t) => t.type === 'pasajero');
    $('#past-trips-tabs').hidden = !(hasConductorTrips && hasPassengerTrips);

    renderPastTrips();
  } catch (error) {
    if (!silent) statusMessage('#past-trips-error', errorMessage(error));
  } finally {
    if (!silent) button.disabled = false;
  }
}

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

  $('#refresh-past-trips').addEventListener('click', () => { void loadPastTrips(); });

  document.querySelectorAll<HTMLButtonElement>('.past-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      pastTripsTab = (tab.dataset.tab as 'all' | 'conductor' | 'pasajero') ?? 'all';
      document.querySelectorAll<HTMLButtonElement>('.past-tab').forEach((t) => t.classList.toggle('past-tab--active', t === tab));
      renderPastTrips();
    });
  });

  await loadPastTrips();
}

void init();

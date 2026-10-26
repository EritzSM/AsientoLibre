import { initHeader } from '../../components/header/header';
import type { AuthUser } from '../../../core/services/auth.service';
import { authService } from '../../../core/services/auth.service';
import { routesService } from '../../../core/services/routes.service';
import type { CalendarRoute } from '../../../core/services/routes.service';
import { element as $, escapeHtml as escape, errorMessage, statusMessage } from '../../../core/dom';

let user: AuthUser | null = null;
let calendarRoutes: CalendarRoute[] = [];
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let activeCalendarRoute: CalendarRoute | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

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

function calendarRange(): { from: string; to: string } {
  const y = calendarMonth.getFullYear(), m = calendarMonth.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(new Date(y, m + 1, 0).getDate()).padStart(2, '0')}`;
  return { from, to };
}

function renderCalendar(): void {
  const y = calendarMonth.getFullYear(), m = calendarMonth.getMonth();
  $('#calendar-month').textContent = calendarMonth.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const headers = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => `<div class="calendar-weekday">${d}</div>`).join('');
  const blanks = Array.from({ length: offset }, () => '<div class="calendar-day calendar-day--empty"></div>').join('');
  const cells = Array.from({ length: new Date(y, m + 1, 0).getDate() }, (_, i) => {
    const day = i + 1, date = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const events = calendarRoutes.filter((route) => route.date === date);
    return `<div class="calendar-day${events.length ? ' calendar-day--busy' : ''}">
      <span class="calendar-number">${day}</span>
      ${events.map((route) =>
        `<button type="button" class="calendar-event status-${escape(route.status)}" data-calendar-route="${escape(route.id)}" data-series-id="${escape(route.seriesId ?? '')}">
          <strong>${escape(route.time)}</strong>
          <span>${escape(route.origin)} → ${escape(route.destination)}</span>
        </button>`
      ).join('')}
    </div>`;
  }).join('');
  $('#route-calendar').innerHTML = `<div class="calendar-grid">${headers}${blanks}${cells}</div>`;
}

async function loadCalendar(): Promise<void> {
  if (user?.role !== 'conductor') return;
  statusMessage('#calendar-error', '');
  try {
    const range = calendarRange();
    calendarRoutes = await routesService.calendar(range.from, range.to);
    renderCalendar();
  } catch (error) {
    statusMessage('#calendar-error', errorMessage(error));
  }
}

function openSeriesManager(routeId: string): void {
  const route = calendarRoutes.find((item) => item.id === routeId);
  if (!route) return;
  activeCalendarRoute = route;
  $('#series-route').textContent = `${route.origin} → ${route.destination} · ${dateLabel(route.date)} ${route.time}`;
  $<HTMLInputElement>('#series-time').value = route.time;
  $('#series-edit-fields').hidden = !route.seriesId;
  $<HTMLButtonElement>('#series-save').hidden = !route.seriesId;
  statusMessage('#series-error', '');
  $<HTMLDialogElement>('#series-dialog').showModal();
}

async function updateSeries(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!activeCalendarRoute?.seriesId) return;
  const time = $<HTMLInputElement>('#series-time').value;
  const button = $<HTMLButtonElement>('#series-save');
  button.disabled = true;
  try {
    const result = await routesService.updateRecurring(activeCalendarRoute.seriesId, time);
    $<HTMLDialogElement>('#series-dialog').close();
    toast(`${result.updatedCount ?? 0} viaje(s) actualizado(s). ${result.skippedReservedCount ?? 0} con reserva conservaron su horario.`);
    await loadCalendar();
  } catch (error) {
    statusMessage('#series-error', errorMessage(error));
  } finally {
    button.disabled = false;
  }
}

async function cancelCalendarInstance(): Promise<void> {
  if (!activeCalendarRoute) return;
  const button = $<HTMLButtonElement>('#series-cancel-instance');
  button.disabled = true;
  try {
    await routesService.cancel(activeCalendarRoute.id);
    $<HTMLDialogElement>('#series-dialog').close();
    toast('Se canceló únicamente esta instancia; las demás continúan activas.');
    await loadCalendar();
  } catch (error) {
    statusMessage('#series-error', errorMessage(error));
  } finally {
    button.disabled = false;
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

  if (user.role !== 'conductor') {
    statusMessage('#calendar-error', 'El calendario está disponible únicamente para usuarios con perfil de conductor.');
    return;
  }

  $('#calendar-prev').addEventListener('click', () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    void loadCalendar();
  });
  $('#calendar-next').addEventListener('click', () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    void loadCalendar();
  });

  $('#route-calendar').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-calendar-route]');
    if (button?.dataset.calendarRoute) {
      openSeriesManager(button.dataset.calendarRoute);
    }
  });

  $('#series-form').addEventListener('submit', (event) => { void updateSeries(event as SubmitEvent); });
  $('#series-close').addEventListener('click', () => $<HTMLDialogElement>('#series-dialog').close());
  $('#series-cancel-instance').addEventListener('click', () => { void cancelCalendarInstance(); });

  await loadCalendar();
}

void init();

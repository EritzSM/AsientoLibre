// =========================================================
// Asiento Libre — lógica del home
// =========================================================

import { initHeader } from "../../components/header/header";

interface Ride {
  id: string;
  driverName: string;
  origin: string;
  destination: string;
  date: string;   // yyyy-mm-dd
  time: string;   // HH:mm
  price: number;
  note: string;
  totalSeats: number;
  availableSeats: number;
}

const TOTAL_SEATS = 4;

// ---- Estado inicial ----
let rides: Ride[] = [
  {
    id: crypto.randomUUID(),
    driverName: "María González",
    origin: "Centro",
    destination: "Universidad de Medellín",
    date: "2026-08-01",
    time: "07:30",
    price: 5000,
    note: "Salgo puntual desde el parque de las luces.",
    totalSeats: TOTAL_SEATS,
    availableSeats: 2,
  },
  {
    id: crypto.randomUUID(),
    driverName: "Juan Yepes",
    origin: "Laureles",
    destination: "Ciudad del Río",
    date: "2026-08-01",
    time: "07:30",
    price: 5000,
    note: "Ruta directa por la 33.",
    totalSeats: TOTAL_SEATS,
    availableSeats: 2,
  },
];

let activeRideId: string | null = null;
let selectedSeats = 1;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

// ---- Utilidades ----
function $<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`No se encontró el elemento: ${selector}`);
  return el;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatPrice(value: number): string {
  return `$${value.toLocaleString("es-CO")} / asiento`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).replace(".", "");
}

function showToast(message: string): void {
  const toast = $<HTMLDivElement>("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

// ---- Render de asientos ----
function seatBoxesHtml(ride: Ride): string {
  const boxes: string[] = [];
  for (let i = 0; i < ride.totalSeats; i++) {
    const isFree = i < ride.availableSeats;
    boxes.push(
      `<span class="seat-box ${isFree ? "free" : ""}">${
        isFree
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="m5 13 4 4 10-10" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : ""
      }</span>`
    );
  }
  return boxes.join("");
}

// ---- Render de tarjetas de ruta ----
function rideCardHtml(ride: Ride): string {
  const soldOut = ride.availableSeats <= 0;
  return `
    <article class="route-card" data-id="${ride.id}">
      <div class="route-card-top">
        <div class="driver">
          <span class="avatar">${initials(ride.driverName)}</span>
          <div>
            <div class="driver-name">${ride.driverName}</div>
            <div class="driver-role">Conductor${ride.driverName.endsWith("a") ? "a" : ""}</div>
          </div>
        </div>
        <span class="price-pill">${formatPrice(ride.price)}</span>
      </div>

      <div class="route-points">
        <div class="route-point">
          <svg class="dot" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="5" fill="currentColor"/>
          </svg>
          <div>
            <div class="route-point-label">Desde</div>
            <div class="route-point-value">${ride.origin}</div>
          </div>
        </div>
        <div class="route-connector"></div>
        <div class="route-point">
          <svg class="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div>
            <div class="route-point-label">Hasta</div>
            <div class="route-point-value">${ride.destination}</div>
          </div>
        </div>
      </div>

      ${ride.note ? `<p class="route-note">${ride.note}</p>` : ""}

      <div class="route-meta">
        <span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/>
            <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="1.8"/>
          </svg>
          ${formatDate(ride.date)}
        </span>
        <span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/>
            <path d="M12 7v5l3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          ${ride.time}
        </span>
      </div>

      <div class="route-footer">
        <div class="seat-indicator">
          <div class="seat-boxes">${seatBoxesHtml(ride)}</div>
          <span class="seats-label">${ride.availableSeats} de ${ride.totalSeats} asientos libres</span>
        </div>
        <button class="btn-reserve" type="button" data-reserve="${ride.id}" ${soldOut ? "disabled" : ""}>
          ${soldOut ? "Sin asientos" : "Reservar asiento"}
        </button>
      </div>
    </article>
  `;
}

// ---- Renderizar lista de rutas ----
function renderRides(filter = ""): void {
  const list = $<HTMLDivElement>("#routes-list");
  const emptyState = $<HTMLParagraphElement>("#empty-state");
  const query = filter.trim().toLowerCase();

  const filtered = rides.filter((ride) =>
    [ride.driverName, ride.origin, ride.destination].some((field) =>
      field.toLowerCase().includes(query)
    )
  );

  list.innerHTML = filtered.map(rideCardHtml).join("");
  emptyState.hidden = filtered.length > 0;

  list.querySelectorAll<HTMLButtonElement>("[data-reserve]").forEach((btn) => {
    btn.addEventListener("click", () => openModal(btn.dataset.reserve!));
  });
}

// ---- Publicar ruta ----
function handlePublish(event: SubmitEvent): void {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);

  const newRide: Ride = {
    id: crypto.randomUUID(),
    driverName: String(data.get("driverName") ?? "").trim(),
    origin: String(data.get("origin") ?? "").trim(),
    destination: String(data.get("destination") ?? "").trim(),
    date: String(data.get("date") ?? ""),
    time: String(data.get("time") ?? ""),
    price: Number(data.get("price") ?? 0),
    note: String(data.get("note") ?? "").trim(),
    totalSeats: TOTAL_SEATS,
    availableSeats: TOTAL_SEATS,
  };

  if (!newRide.driverName || !newRide.origin || !newRide.destination) return;

  rides = [newRide, ...rides];
  renderRides(($<HTMLInputElement>("#search-input")).value);
  form.reset();
  showToast("¡Tu ruta fue publicada!");
  document.querySelector("#buscar")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---- Modal de reserva ----
function openModal(rideId: string): void {
  const ride = rides.find((r) => r.id === rideId);
  if (!ride) return;

  activeRideId = rideId;
  selectedSeats = 1;

  $<HTMLParagraphElement>("#modal-subtitle").textContent = `Viaje con ${ride.driverName}`;
  $<HTMLParagraphElement>("#modal-route-chip").innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="color:var(--teal)">
      <circle cx="12" cy="12" r="5" fill="currentColor"/>
    </svg>
    ${ride.origin}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    ${ride.destination}
  `;
  $<HTMLParagraphElement>("#seats-hint").textContent =
    `${ride.availableSeats} asiento${ride.availableSeats === 1 ? "" : "s"} disponible${ride.availableSeats === 1 ? "" : "s"} en este viaje.`;

  const twoSeatsBtn = document.querySelector<HTMLButtonElement>('[data-seats="2"]')!;
  twoSeatsBtn.disabled = ride.availableSeats < 2;
  setSelectedSeats(1);

  ($<HTMLInputElement>("#passenger-name")).value = "";
  $<HTMLDivElement>("#modal-overlay").hidden = false;
  $<HTMLInputElement>("#passenger-name").focus();
}

function closeModal(): void {
  $<HTMLDivElement>("#modal-overlay").hidden = true;
  activeRideId = null;
}

function setSelectedSeats(seats: number): void {
  selectedSeats = seats;
  document.querySelectorAll<HTMLButtonElement>(".seat-option").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.seats) === seats);
  });
}

function handleReserve(event: SubmitEvent): void {
  event.preventDefault();
  if (!activeRideId) return;

  const ride = rides.find((r) => r.id === activeRideId);
  if (!ride) return;

  const name = ($<HTMLInputElement>("#passenger-name")).value.trim();
  if (!name || selectedSeats > ride.availableSeats) return;

  ride.availableSeats -= selectedSeats;
  renderRides(($<HTMLInputElement>("#search-input")).value);
  closeModal();
  showToast(`¡Reserva confirmada para ${name}!`);
}

// ---- Scroll suave ----
function bindScrollLinks(): void {
  document.querySelectorAll<HTMLElement>("[data-scroll]").forEach((el) => {
    el.addEventListener("click", (event) => {
      const targetSelector = el.dataset.target ?? el.getAttribute("href");
      if (!targetSelector) return;
      event.preventDefault();
      document.querySelector(targetSelector)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// ---- Inicialización ----
function init(): void {
  initHeader();
  renderRides();
  bindScrollLinks();

  $<HTMLFormElement>("#publish-form").addEventListener("submit", handlePublish);
  $<HTMLFormElement>("#reserve-form").addEventListener("submit", handleReserve);

  $<HTMLInputElement>("#search-input").addEventListener("input", (event) => {
    renderRides((event.target as HTMLInputElement).value);
  });

  document.querySelectorAll<HTMLButtonElement>(".seat-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      setSelectedSeats(Number(btn.dataset.seats));
    });
  });

  $<HTMLButtonElement>("#modal-close").addEventListener("click", closeModal);
  $<HTMLDivElement>("#modal-overlay").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// =========================================================
// Asiento Libre — Panel de Administración (Admin Dashboard Logic)
// =========================================================

import { authService } from "../../../core/services/auth.service";
import { adminService } from "../../../core/services/admin.service";
import type { ConductorDocument, AdminStats, DocumentStatus } from "../../../core/services/admin.service";
import { escapeHtml } from "../../../core/dom";

let allDocuments: ConductorDocument[] = [];
let currentFilter: 'all' | DocumentStatus = 'pendiente';
let currentSearch = '';
let targetDocIdToReject: string | null = null;
let toastTimeout: ReturnType<typeof setTimeout> | undefined;

function $<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function showToast(msg: string): void {
  const toast = $<HTMLDivElement>("#admin-toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.hidden = true;
  }, 3500);
}

// =========================================================
// Verificación de Autenticación y Rol
// =========================================================
async function checkAdminAuth(): Promise<void> {
  const token = authService.getToken();
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  try {
    const user = await authService.getMe();
    if (user.role !== 'admin') {
      alert("Acceso denegado. Se requieren permisos de administrador.");
      window.location.href = "/index.html";
      return;
    }

    // Set admin user info in header
    const emailEl = $<HTMLSpanElement>("#admin-user-email");
    const avatarEl = $<HTMLDivElement>("#admin-user-avatar");
    if (emailEl) emailEl.textContent = user.email;
    if (avatarEl) {
      avatarEl.textContent = (user.firstName?.[0] || 'A').toUpperCase();
    }
  } catch (err) {
    console.error("Error verificando sesión admin:", err);
    window.location.href = "/login.html";
  }
}

// =========================================================
// Cargar Estadísticas y Documentos
// =========================================================
async function loadDashboardData(): Promise<void> {
  const refreshBtn = $<HTMLButtonElement>("#btn-refresh");
  if (refreshBtn) refreshBtn.classList.add("loading");

  try {
    const [stats, docs] = await Promise.all([
      adminService.getStats().catch(() => null),
      adminService.getDocuments('all'),
    ]);

    if (stats) renderStats(stats);
    allDocuments = docs;
    renderDocuments();
    updateTabBadges();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Error al cargar datos.';
    showToast(errorMsg);
  } finally {
    if (refreshBtn) refreshBtn.classList.remove("loading");
  }
}

function renderStats(stats: AdminStats): void {
  const elPending = $<HTMLSpanElement>("#stat-pending");
  const elApproved = $<HTMLSpanElement>("#stat-approved");
  const elRejected = $<HTMLSpanElement>("#stat-rejected");
  const elConductors = $<HTMLSpanElement>("#stat-conductors");

  if (elPending) elPending.textContent = String(stats.pending_documents);
  if (elApproved) elApproved.textContent = String(stats.approved_documents);
  if (elRejected) elRejected.textContent = String(stats.rejected_documents);
  if (elConductors) elConductors.textContent = String(stats.total_conductors);
}

function updateTabBadges(): void {
  const pendingCount = allDocuments.filter(d => d.status === 'pendiente').length;
  const approvedCount = allDocuments.filter(d => d.status === 'aprobado').length;
  const rejectedCount = allDocuments.filter(d => d.status === 'rechazado').length;
  const allCount = allDocuments.length;

  const bPending = $<HTMLSpanElement>("#badge-tab-pendiente");
  const bApproved = $<HTMLSpanElement>("#badge-tab-aprobado");
  const bRejected = $<HTMLSpanElement>("#badge-tab-rechazado");
  const bAll = $<HTMLSpanElement>("#badge-tab-all");

  if (bPending) bPending.textContent = String(pendingCount);
  if (bApproved) bApproved.textContent = String(approvedCount);
  if (bRejected) bRejected.textContent = String(rejectedCount);
  if (bAll) bAll.textContent = String(allCount);
}

// =========================================================
// Renderizar Tabla de Documentos
// =========================================================
function formatDocType(type: string): string {
  switch (type) {
    case 'licencia':
      return '🪪 Licencia de Conducción';
    case 'soat':
      return '📄 SOAT';
    case 'cedula':
      return '🆔 Cédula de Ciudadanía';
    case 'foto_vehiculo':
      return '🚗 Foto del Vehículo';
    default:
      return type;
  }
}

function formatDate(isoString: string): string {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderDocuments(): void {
  const tbody = $<HTMLTableSectionElement>("#documents-table-body");
  const emptyState = $<HTMLDivElement>("#documents-empty-state");
  const tableWrapper = $<HTMLDivElement>("#documents-table-wrapper");

  if (!tbody || !emptyState || !tableWrapper) return;

  const filtered = allDocuments.filter((doc) => {
    const matchesFilter = currentFilter === 'all' || doc.status === currentFilter;
    if (!matchesFilter) return false;

    if (!currentSearch) return true;
    const term = currentSearch.toLowerCase();
    const conductorName = `${doc.conductor?.first_name || ''} ${doc.conductor?.last_name || ''}`.toLowerCase();
    const email = (doc.conductor?.email || '').toLowerCase();
    const nationalId = (doc.conductor?.national_id || '').toLowerCase();
    const docType = doc.document_type.toLowerCase();

    return (
      conductorName.includes(term) ||
      email.includes(term) ||
      nationalId.includes(term) ||
      docType.includes(term)
    );
  });

  if (filtered.length === 0) {
    tableWrapper.hidden = true;
    emptyState.hidden = false;
    return;
  }

  tableWrapper.hidden = false;
  emptyState.hidden = true;

  tbody.innerHTML = filtered
    .map((doc) => {
      const conductor = doc.conductor;
      const fullName = conductor ? `${conductor.first_name} ${conductor.last_name}`.trim() : 'Conductor';
      const initials = fullName.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() || 'C';

      return `
        <tr data-doc-id="${escapeHtml(doc.id)}">
          <td>
            <div class="conductor-info">
              <div class="conductor-avatar-circle">${escapeHtml(initials)}</div>
              <div class="conductor-names">
                <span class="conductor-name">${escapeHtml(fullName)}</span>
                <span class="conductor-meta">
                  ${conductor?.national_id ? `CC: ${escapeHtml(conductor.national_id)} • ` : ''}
                  ${escapeHtml(conductor?.email || 'Sin correo')}
                  ${conductor?.phone ? ` • 📞 ${escapeHtml(conductor.phone)}` : ''}
                </span>
              </div>
            </div>
          </td>
          <td>
            <span class="doc-type-badge">${escapeHtml(formatDocType(doc.document_type))}</span>
          </td>
          <td>
            <span class="status-pill ${escapeHtml(doc.status)}">
              <span class="status-dot"></span>
              ${escapeHtml(doc.status.charAt(0).toUpperCase() + doc.status.slice(1))}
            </span>
            ${doc.rejection_reason ? `<div style="font-size:0.75rem; color:#F87171; margin-top:4px;">Motivo: ${escapeHtml(doc.rejection_reason)}</div>` : ''}
          </td>
          <td style="font-size:0.85rem; color:var(--admin-text-muted);">
            ${escapeHtml(formatDate(doc.submitted_at))}
          </td>
          <td>
            <div class="action-buttons">
              <button class="btn-action view" data-action="view" data-url="${escapeHtml(doc.file_url)}" data-type="${escapeHtml(doc.document_type)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                Ver
              </button>
              ${
                doc.status === 'pendiente'
                  ? `
                <button class="btn-action approve" data-action="approve" data-id="${escapeHtml(doc.id)}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Aprobar
                </button>
                <button class="btn-action reject" data-action="reject" data-id="${escapeHtml(doc.id)}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                  Rechazar
                </button>
              `
                  : ''
              }
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

// =========================================================
// Acciones: Aprobar, Rechazar, Visualizar
// =========================================================
async function handleApprove(docId: string): Promise<void> {
  if (!confirm("¿Estás seguro de que deseas aprobar este documento?")) return;

  try {
    const res = await adminService.approveDocument(docId);
    showToast("✅ " + res.message);

    // Actualizar estado local
    const doc = allDocuments.find((d) => d.id === docId);
    if (doc) {
      doc.status = 'aprobado';
      doc.reviewed_at = new Date().toISOString();
    }

    renderDocuments();
    updateTabBadges();
    adminService.getStats().then(renderStats).catch(() => {});
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al aprobar el documento.';
    showToast("❌ " + msg);
  }
}

function openRejectModal(docId: string): void {
  targetDocIdToReject = docId;
  const modal = $<HTMLDivElement>("#modal-reject");
  const textarea = $<HTMLTextAreaElement>("#reject-reason-input");
  if (textarea) textarea.value = "";
  if (modal) modal.hidden = false;
}

function closeRejectModal(): void {
  targetDocIdToReject = null;
  const modal = $<HTMLDivElement>("#modal-reject");
  if (modal) modal.hidden = true;
}

async function confirmReject(): Promise<void> {
  if (!targetDocIdToReject) return;
  const textarea = $<HTMLTextAreaElement>("#reject-reason-input");
  const reason = textarea?.value.trim() || undefined;

  try {
    const res = await adminService.rejectDocument(targetDocIdToReject, reason);
    showToast("⚠️ " + res.message);

    const doc = allDocuments.find((d) => d.id === targetDocIdToReject);
    if (doc) {
      doc.status = 'rechazado';
      doc.rejection_reason = reason || null;
      doc.reviewed_at = new Date().toISOString();
    }

    closeRejectModal();
    renderDocuments();
    updateTabBadges();
    adminService.getStats().then(renderStats).catch(() => {});
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al rechazar el documento.';
    showToast("❌ " + msg);
  }
}

function openPreviewModal(url: string, type: string): void {
  const modal = $<HTMLDivElement>("#modal-preview");
  const title = $<HTMLHeadingElement>("#preview-modal-title");
  const container = $<HTMLDivElement>("#preview-container");

  if (!modal || !container) return;
  if (title) title.textContent = `Visualización: ${formatDocType(type)}`;

  const isPdf = url.toLowerCase().includes('.pdf') || url.startsWith('data:application/pdf');

  if (isPdf) {
    container.innerHTML = `
      <iframe class="modal-preview-pdf" src="${escapeHtml(url)}" title="Documento PDF" style="width:100%; height:75vh; border:none; border-radius:8px;"></iframe>
    `;
  } else {
    container.innerHTML = `
      <img class="modal-preview-img" src="${escapeHtml(url)}" alt="Documento del Conductor" />
    `;
  }

  modal.hidden = false;
}

function closePreviewModal(): void {
  const modal = $<HTMLDivElement>("#modal-preview");
  const container = $<HTMLDivElement>("#preview-container");
  if (container) container.innerHTML = "";
  if (modal) modal.hidden = true;
}

// =========================================================
// Event Listeners e Inicialización
// =========================================================
function bindEvents(): void {
  // Tabs de filtrado
  const tabs = document.querySelectorAll<HTMLButtonElement>(".filter-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = (tab.dataset.filter || 'all') as 'all' | DocumentStatus;
      renderDocuments();
    });
  });

  // Buscador
  const searchInput = $<HTMLInputElement>("#admin-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      currentSearch = (e.target as HTMLInputElement).value.trim();
      renderDocuments();
    });
  }

  // Botón refrescar
  const refreshBtn = $<HTMLButtonElement>("#btn-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadDashboardData);
  }

  // Delegación de eventos en la tabla para ver/aprobar/rechazar
  const tbody = $<HTMLTableSectionElement>("#documents-table-body");
  if (tbody) {
    tbody.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest<HTMLButtonElement>(".btn-action");
      if (!target) return;

      const action = target.dataset.action;
      const docId = target.dataset.id;

      if (action === 'approve' && docId) {
        handleApprove(docId);
      } else if (action === 'reject' && docId) {
        openRejectModal(docId);
      } else if (action === 'view') {
        const url = target.dataset.url;
        const type = target.dataset.type || '';
        if (url) openPreviewModal(url, type);
      }
    });
  }

  // Modal de Rechazo
  const btnCancelReject = $<HTMLButtonElement>("#btn-cancel-reject");
  const btnCloseReject = $<HTMLButtonElement>("#btn-close-reject-modal");
  const btnConfirmReject = $<HTMLButtonElement>("#btn-confirm-reject");

  if (btnCancelReject) btnCancelReject.addEventListener("click", closeRejectModal);
  if (btnCloseReject) btnCloseReject.addEventListener("click", closeRejectModal);
  if (btnConfirmReject) btnConfirmReject.addEventListener("click", confirmReject);

  // Modal de Preview
  const btnClosePreview = $<HTMLButtonElement>("#btn-close-preview-modal");
  if (btnClosePreview) btnClosePreview.addEventListener("click", closePreviewModal);

  // Cerrar modals al hacer click fuera
  document.querySelectorAll<HTMLDivElement>(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        closeRejectModal();
        closePreviewModal();
      }
    });
  });

  // Logout
  const btnLogout = $<HTMLButtonElement>("#btn-admin-logout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      await authService.logout().catch(() => {});
      localStorage.removeItem("asiento_libre_token");
      window.location.href = "/login.html";
    });
  }
}

async function initAdmin(): Promise<void> {
  await checkAdminAuth();
  bindEvents();
  await loadDashboardData();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdmin);
} else {
  initAdmin();
}

// =========================================================
// Asiento Libre — Panel de Administracion (Admin Dashboard Logic)
// Con integracion de IA (Gemini) para validacion de documentos
// =========================================================

import { authService } from "../../../core/services/auth.service";
import { adminService } from "../../../core/services/admin.service";
import type { ConductorDocument, AdminStats, DocumentStatus, AiAnalysisResult, Promotion, PromotionPayload } from "../../../core/services/admin.service";
import { escapeHtml } from "../../../core/dom";

let allDocuments: ConductorDocument[] = [];
let currentFilter: 'all' | DocumentStatus = 'pendiente';
let currentSearch = '';
let promotions: Promotion[] = [];
let editingPromotionId: string | null = null;
let targetDocIdToReject: string | null = null;
let toastTimeout: ReturnType<typeof setTimeout> | undefined;

function $<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function showToast(msg: string, type: 'info' | 'success' | 'error' | 'warning' = 'info'): void {
  const toast = $<HTMLDivElement>("#admin-toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `admin-toast toast-${type}`;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.hidden = true;
  }, 4500);
}

// =========================================================
// Verificacion de Autenticacion y Rol
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

    const emailEl = $<HTMLSpanElement>("#admin-user-email");
    const avatarEl = $<HTMLDivElement>("#admin-user-avatar");
    if (emailEl) emailEl.textContent = user.email;
    if (avatarEl) {
      avatarEl.textContent = (user.firstName?.[0] || 'A').toUpperCase();
    }
  } catch (err) {
    console.error("Error verificando sesion admin:", err);
    window.location.href = "/login.html";
  }
}

// =========================================================
// Cargar Estadisticas y Documentos
// =========================================================
async function loadDashboardData(silent = false): Promise<void> {
  const refreshBtn = $<HTMLButtonElement>("#btn-refresh");
  if (!silent && refreshBtn) refreshBtn.classList.add("loading");

  try {
    const [stats, docs] = await Promise.all([
      adminService.getStats().catch(() => null),
      adminService.getDocuments('all'),
    ]);

    if (stats) renderStats(stats);
    const key = docs.map((d) => `${d.id}:${d.status}:${d.reviewed_at}`).join('|');
    const prevKey = allDocuments.map((d) => `${d.id}:${d.status}:${d.reviewed_at}`).join('|');
    if (key !== prevKey || !silent) {
      allDocuments = docs;
      renderDocuments();
      updateTabBadges();
    }
  } catch (err: unknown) {
    if (!silent) {
      const errorMsg = err instanceof Error ? err.message : 'Error al cargar datos.';
      showToast(errorMsg, 'error');
    }
  } finally {
    if (!silent && refreshBtn) refreshBtn.classList.remove("loading");
  }
}

function promotionDateTimeInput(value: string): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function promotionStatus(promotion: Promotion): string {
  const now = Date.now();
  if (!promotion.is_active) return 'Inactiva';
  if (new Date(promotion.starts_at).getTime() > now) return 'Programada';
  if (new Date(promotion.ends_at).getTime() <= now) return 'Vencida';
  return 'Activa';
}

function renderPromotions(): void {
  const list = $<HTMLDivElement>('#promotion-admin-list');
  if (!list) return;
  list.innerHTML = promotions.length ? promotions.map((promotion) => {
    const discount = promotion.discount_type === 'percentage'
      ? `${promotion.discount_value}%`
      : `$${new Intl.NumberFormat('es-CO').format(promotion.discount_value)} COP`;
    return `<article class="promotion-admin-card">
      <div><span class="promotion-admin-status">${escapeHtml(promotionStatus(promotion))}</span>
        <h3>${escapeHtml(promotion.title)}</h3>
        <p>${escapeHtml(promotion.description)}</p>
        ${promotion.code ? `<code>${escapeHtml(promotion.code)}</code>` : ''}
        <small>${escapeHtml(discount)} · ${escapeHtml(promotionDateTimeInput(promotion.starts_at).replace('T', ' '))} a ${escapeHtml(promotionDateTimeInput(promotion.ends_at).replace('T', ' '))} (Colombia)</small>
      </div>
      <div class="promotion-admin-card-actions">
        <button class="btn-action view" type="button" data-edit-promotion="${escapeHtml(promotion.id)}">Editar</button>
        <button class="btn-action reject" type="button" data-delete-promotion="${escapeHtml(promotion.id)}">Eliminar</button>
      </div>
    </article>`;
  }).join('') : '<p class="promotion-admin-empty">Todavía no hay promociones creadas.</p>';
}

async function loadPromotions(): Promise<void> {
  const error = $<HTMLParagraphElement>('#promotion-list-error');
  if (error) { error.hidden = true; error.textContent = ''; }
  try {
    promotions = await adminService.getPromotions();
    renderPromotions();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'No se pudieron cargar las promociones.';
    if (error) { error.textContent = message; error.hidden = false; }
  }
}

function resetPromotionForm(): void {
  const form = $<HTMLFormElement>('#promotion-form');
  if (!form) return;
  form.reset();
  editingPromotionId = null;
  const submit = $<HTMLButtonElement>('#promotion-submit');
  if (submit) submit.textContent = 'Crear promoción';
  const cancel = $<HTMLButtonElement>('#promotion-cancel-edit');
  if (cancel) cancel.hidden = true;
  const active = form.elements.namedItem('isActive') as HTMLInputElement | null;
  if (active) active.checked = true;
  const error = $<HTMLParagraphElement>('#promotion-form-error');
  if (error) error.hidden = true;
}

function editPromotion(id: string): void {
  const promotion = promotions.find((item) => item.id === id);
  const form = $<HTMLFormElement>('#promotion-form');
  if (!promotion || !form) return;
  editingPromotionId = id;
  (form.elements.namedItem('title') as HTMLInputElement).value = promotion.title;
  (form.elements.namedItem('description') as HTMLInputElement).value = promotion.description;
  (form.elements.namedItem('code') as HTMLInputElement).value = promotion.code ?? '';
  (form.elements.namedItem('discountType') as HTMLSelectElement).value = promotion.discount_type;
  (form.elements.namedItem('discountValue') as HTMLInputElement).value = String(promotion.discount_value);
  (form.elements.namedItem('startsAt') as HTMLInputElement).value = promotionDateTimeInput(promotion.starts_at);
  (form.elements.namedItem('endsAt') as HTMLInputElement).value = promotionDateTimeInput(promotion.ends_at);
  (form.elements.namedItem('isActive') as HTMLInputElement).checked = promotion.is_active;
  const submit = $<HTMLButtonElement>('#promotion-submit');
  if (submit) submit.textContent = 'Guardar cambios';
  const cancel = $<HTMLButtonElement>('#promotion-cancel-edit');
  if (cancel) cancel.hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function submitPromotion(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = $<HTMLFormElement>('#promotion-form');
  const button = $<HTMLButtonElement>('#promotion-submit');
  const error = $<HTMLParagraphElement>('#promotion-form-error');
  if (!form || !button || !error || button.disabled) return;
  const values = new FormData(form);
  const payload: PromotionPayload = {
    title: String(values.get('title') ?? '').trim(),
    description: String(values.get('description') ?? '').trim(),
    code: String(values.get('code') ?? '').trim() || null,
    discountType: String(values.get('discountType')) as PromotionPayload['discountType'],
    discountValue: Number(values.get('discountValue')),
    startsAt: new Date(`${String(values.get('startsAt'))}:00-05:00`).toISOString(),
    endsAt: new Date(`${String(values.get('endsAt'))}:00-05:00`).toISOString(),
    isActive: values.get('isActive') === 'on',
  };
  error.hidden = true;
  button.disabled = true;
  try {
    if (editingPromotionId) await adminService.updatePromotion(editingPromotionId, payload);
    else await adminService.createPromotion(payload);
    showToast(editingPromotionId ? 'Promoción actualizada.' : 'Promoción creada.', 'success');
    resetPromotionForm();
    await loadPromotions();
  } catch (err: unknown) {
    error.textContent = err instanceof Error ? err.message : 'No se pudo guardar la promoción.';
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

async function deletePromotion(id: string): Promise<void> {
  const promotion = promotions.find((item) => item.id === id);
  if (!promotion || !confirm(`¿Eliminar la promoción "${promotion.title}"? Esta acción no se puede deshacer.`)) return;
  try {
    await adminService.deletePromotion(id);
    if (editingPromotionId === id) resetPromotionForm();
    showToast('Promoción eliminada. Los descuentos de reservas anteriores se conservan.', 'success');
    await loadPromotions();
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : 'No se pudo eliminar la promoción.', 'error');
  }
}

function renderStats(stats: AdminStats): void {
  const elPending = $<HTMLSpanElement>("#stat-pending");
  const elApproved = $<HTMLSpanElement>("#stat-approved");
  const elRejected = $<HTMLSpanElement>("#stat-rejected");
  const elManual = $<HTMLSpanElement>("#stat-manual-review");
  const elConductors = $<HTMLSpanElement>("#stat-conductors");

  if (elPending) elPending.textContent = String(stats.pending_documents);
  if (elApproved) elApproved.textContent = String(stats.approved_documents);
  if (elRejected) elRejected.textContent = String(stats.rejected_documents);
  if (elManual) elManual.textContent = String(stats.manual_review_documents ?? 0);
  if (elConductors) elConductors.textContent = String(stats.total_conductors);
}

function updateTabBadges(): void {
  const pendingCount = allDocuments.filter(d => d.status === 'pendiente').length;
  const approvedCount = allDocuments.filter(d => d.status === 'aprobado').length;
  const rejectedCount = allDocuments.filter(d => d.status === 'rechazado').length;
  const manualCount = allDocuments.filter(d => d.status === 'revision_manual').length;
  const allCount = allDocuments.length;

  const bPending = $<HTMLSpanElement>("#badge-tab-pendiente");
  const bApproved = $<HTMLSpanElement>("#badge-tab-aprobado");
  const bRejected = $<HTMLSpanElement>("#badge-tab-rechazado");
  const bManual = $<HTMLSpanElement>("#badge-tab-revision_manual");
  const bAll = $<HTMLSpanElement>("#badge-tab-all");

  if (bPending) bPending.textContent = String(pendingCount);
  if (bApproved) bApproved.textContent = String(approvedCount);
  if (bRejected) bRejected.textContent = String(rejectedCount);
  if (bManual) bManual.textContent = String(manualCount);
  if (bAll) bAll.textContent = String(allCount);
}

// =========================================================
// Renderizar Tabla de Documentos
// =========================================================
function formatDocType(type: string): string {
  switch (type) {
    case 'licencia': return 'Licencia de Conduccion';
    case 'soat': return 'SOAT';
    case 'cedula': return 'Cedula de Ciudadania';
    case 'foto_vehiculo': return 'Foto del Vehiculo';
    default: return type;
  }
}

function formatDocTypeWithIcon(type: string): string {
  switch (type) {
    case 'licencia': return 'Licencia';
    case 'soat': return 'SOAT';
    case 'cedula': return 'Cedula';
    case 'foto_vehiculo': return 'Foto Vehiculo';
    default: return type;
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

function getStatusLabel(status: DocumentStatus): string {
  switch (status) {
    case 'pendiente': return 'Pendiente';
    case 'aprobado': return 'Aprobado';
    case 'rechazado': return 'Rechazado';
    case 'revision_manual': return 'Revision Manual';
    default: return status;
  }
}

function renderAiBadge(doc: ConductorDocument): string {
  if (!doc.ai_analysis) return '';
  return `<span class="ai-badge" title="Analizado por IA">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
      <path d="M12 6v6l4 2"/>
    </svg>
    IA
  </span>`;
}

function renderActionButtons(doc: ConductorDocument): string {
  const viewBtn = `
    <button class="btn-action view" data-action="view" data-url="${escapeHtml(doc.file_url)}" data-type="${escapeHtml(doc.document_type)}" title="Ver documento">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
      Ver
    </button>`;

  if (doc.status === 'pendiente' || doc.status === 'revision_manual') {
    return `
      ${viewBtn}
      <button class="btn-action approve" data-action="approve" data-id="${escapeHtml(doc.id)}" title="Aprobar">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Aprobar
      </button>
      <button class="btn-action reject" data-action="reject" data-id="${escapeHtml(doc.id)}" title="Rechazar">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        Rechazar
      </button>`;
  }

  return viewBtn;
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
                  ${conductor?.national_id ? `CC: ${escapeHtml(conductor.national_id)} &bull; ` : ''}
                  ${escapeHtml(conductor?.email || 'Sin correo')}
                  ${conductor?.phone ? ` &bull; ${escapeHtml(conductor.phone)}` : ''}
                </span>
              </div>
            </div>
          </td>
          <td>
            <span class="doc-type-badge">${escapeHtml(formatDocTypeWithIcon(doc.document_type))}</span>
          </td>
          <td>
            <div class="status-cell">
              <span class="status-pill ${escapeHtml(doc.status)}">
                <span class="status-dot"></span>
                ${escapeHtml(getStatusLabel(doc.status))}
              </span>
              ${renderAiBadge(doc)}
            </div>
            ${doc.rejection_reason ? `<div class="rejection-reason-text">Motivo: ${escapeHtml(doc.rejection_reason)}</div>` : ''}
            ${doc.ai_analysis?.scheduled_activation ? `<div class="schedule-text">Activa desde: ${escapeHtml(doc.ai_analysis.scheduled_activation)}</div>` : ''}
          </td>
          <td style="font-size:0.85rem; color:var(--admin-text-muted);">
            ${escapeHtml(formatDate(doc.submitted_at))}
          </td>
          <td>
            <div class="action-buttons">
              ${renderActionButtons(doc)}
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

// =========================================================
// Acciones: Aprobar, Rechazar, IA, Visualizar
// =========================================================
async function handleApprove(docId: string): Promise<void> {
  if (!confirm("Esta seguro de que desea aprobar este documento?")) return;

  try {
    await adminService.approveDocument(docId);
    showToast("Documento aprobado exitosamente.", 'success');

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
    showToast(msg, 'error');
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
    await adminService.rejectDocument(targetDocIdToReject, reason);
    showToast("Documento rechazado.", 'warning');

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
    showToast(msg, 'error');
  }
}

// =========================================================
// Analisis con IA
// =========================================================
async function handleAiAnalyze(docId: string): Promise<void> {
  const doc = allDocuments.find(d => d.id === docId);
  if (!doc) return;

  // Show loading state on the row
  const row = document.querySelector<HTMLTableRowElement>(`tr[data-doc-id="${docId}"]`);
  const aiBtn = row?.querySelector<HTMLButtonElement>('[data-action="ai-analyze"]');
  if (aiBtn) {
    aiBtn.disabled = true;
    aiBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      Analizando...`;
  }

  try {
    const result = await adminService.analyzeWithAi(docId);
    const analysis = result.analysis;

    // Update local state
    const localDoc = allDocuments.find(d => d.id === docId);
    if (localDoc) {
      localDoc.status = analysis.verdict === 'aprobado' ? 'aprobado'
        : analysis.verdict === 'rechazado' ? 'rechazado'
        : 'revision_manual';
      localDoc.ai_analysis = analysis;
      localDoc.rejection_reason = analysis.verdict === 'rechazado' ? analysis.reason : null;
      localDoc.reviewed_at = new Date().toISOString();
    }

    renderDocuments();
    updateTabBadges();
    adminService.getStats().then(renderStats).catch(() => {});

    // Show AI result modal
    openAiResultModal(analysis);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al analizar con IA.';
    showToast(msg, 'error');
    // Restore button
    if (aiBtn) {
      aiBtn.disabled = false;
      aiBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4l3 3"/>
        </svg>
        IA`;
    }
  }
}

function openAiResultModal(analysis: AiAnalysisResult): void {
  const modal = $<HTMLDivElement>("#modal-ai-result");
  if (!modal) return;

  const verdictEl = $<HTMLDivElement>("#ai-verdict-display");
  const reasonEl = $<HTMLParagraphElement>("#ai-reason-text");
  const rulesEl = $<HTMLDivElement>("#ai-rules-list");
  const scheduleEl = $<HTMLDivElement>("#ai-schedule-info");

  const verdictConfig: Record<string, { label: string; cls: string; icon: string }> = {
    aprobado: { label: 'Aprobado', cls: 'verdict-approved', icon: '✅' },
    rechazado: { label: 'Rechazado', cls: 'verdict-rejected', icon: '❌' },
    revision_manual: { label: 'Revision Manual', cls: 'verdict-manual', icon: '🔍' },
  };

  const vConf = verdictConfig[analysis.verdict] ?? verdictConfig['revision_manual'];

  if (verdictEl) {
    verdictEl.className = `ai-verdict-badge ${vConf.cls}`;
    verdictEl.innerHTML = `${vConf.icon} ${vConf.label}`;
  }

  if (reasonEl) reasonEl.textContent = analysis.reason;

  if (rulesEl) {
    if (analysis.rules_triggered.length > 0) {
      rulesEl.innerHTML = analysis.rules_triggered.map(rule => {
        const pct = Math.round(rule.confidence * 100);
        const ruleVerdictCls = rule.verdict === 'aprobado' ? 'rule-approved'
          : rule.verdict === 'rechazado' ? 'rule-rejected' : 'rule-manual';
        return `
          <div class="ai-rule-item">
            <div class="rule-header">
              <span class="rule-id">${escapeHtml(rule.ruleId)}</span>
              <span class="rule-verdict ${ruleVerdictCls}">${escapeHtml(rule.verdict)}</span>
              <span class="rule-confidence">${pct}% confianza</span>
            </div>
            <div class="rule-desc">${escapeHtml(rule.description)}</div>
          </div>`;
      }).join('');
    } else {
      rulesEl.innerHTML = '<p class="no-rules-text">Sin reglas especificas activadas.</p>';
    }
  }

  if (scheduleEl) {
    if (analysis.scheduled_activation) {
      scheduleEl.hidden = false;
      scheduleEl.innerHTML = `
        <div class="schedule-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          SOAT-02: El documento se activara automaticamente el <strong>${escapeHtml(analysis.scheduled_activation)}</strong>
        </div>`;
    } else {
      scheduleEl.hidden = true;
    }
  }

  modal.hidden = false;
}

function closeAiResultModal(): void {
  const modal = $<HTMLDivElement>("#modal-ai-result");
  if (modal) modal.hidden = true;
}

function openPreviewModal(url: string, type: string): void {
  const modal = $<HTMLDivElement>("#modal-preview");
  const title = $<HTMLHeadingElement>("#preview-modal-title");
  const container = $<HTMLDivElement>("#preview-container");

  if (!modal || !container) return;
  if (title) title.textContent = `Visualizacion: ${formatDocType(type)}`;

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
// Event Listeners e Inicializacion
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

  // Boton refrescar
  const refreshBtn = $<HTMLButtonElement>("#btn-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => { void loadDashboardData(); void loadPromotions(); });
  }

  $<HTMLFormElement>('#promotion-form')?.addEventListener('submit', (event) => { void submitPromotion(event); });
  $<HTMLButtonElement>('#promotion-cancel-edit')?.addEventListener('click', resetPromotionForm);
  $<HTMLDivElement>('#promotion-admin-list')?.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-edit-promotion], [data-delete-promotion]');
    if (target?.dataset.editPromotion) editPromotion(target.dataset.editPromotion);
    if (target?.dataset.deletePromotion) void deletePromotion(target.dataset.deletePromotion);
  });

  // Delegacion de eventos en la tabla para ver/aprobar/rechazar/IA
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
      } else if (action === 'ai-analyze' && docId) {
        handleAiAnalyze(docId);
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

  // Modal de AI Result
  const btnCloseAi = $<HTMLButtonElement>("#btn-close-ai-modal");
  if (btnCloseAi) btnCloseAi.addEventListener("click", closeAiResultModal);

  // Modal de Preview
  const btnClosePreview = $<HTMLButtonElement>("#btn-close-preview-modal");
  if (btnClosePreview) btnClosePreview.addEventListener("click", closePreviewModal);

  // Cerrar modals al hacer click fuera
  document.querySelectorAll<HTMLDivElement>(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        closeRejectModal();
        closePreviewModal();
        closeAiResultModal();
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
  await Promise.all([loadDashboardData(), loadPromotions()]);

  let isWatching = false;
  const pollAdmin = async () => {
    if (document.visibilityState !== 'visible' || isWatching) return;
    isWatching = true;
    try {
      await loadDashboardData(true);
    } finally {
      isWatching = false;
    }
  };
  setInterval(() => { void pollAdmin(); }, 4000);
  window.addEventListener('focus', () => { void pollAdmin(); });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pollAdmin();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdmin);
} else {
  initAdmin();
}

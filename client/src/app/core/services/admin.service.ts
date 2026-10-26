const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN_KEY = 'asiento_libre_token';

export type DocumentType = 'licencia' | 'soat' | 'cedula' | 'foto_vehiculo';
export type DocumentStatus = 'pendiente' | 'aprobado' | 'rechazado' | 'revision_manual';

export interface AiRuleResult {
	ruleId: string;
	description: string;
	verdict: string;
	confidence: number;
}

export interface AiAnalysisResult {
	verdict: DocumentStatus;
	reason: string;
	rules_triggered: AiRuleResult[];
	scheduled_activation?: string | null;
}

export interface ConductorDocument {
	id: string;
	conductor_id: string;
	document_type: DocumentType;
	file_url: string;
	file_name: string | null;
	status: DocumentStatus;
	rejection_reason: string | null;
	ai_analysis?: AiAnalysisResult | null;
	submitted_at: string;
	reviewed_at: string | null;
	reviewed_by: string | null;
	conductor?: {
		first_name: string;
		last_name: string;
		national_id: string;
		phone: string;
		email: string;
	};
}

export interface AdminStats {
	total_conductors: number;
	total_users?: number;
	total_blocked?: number;
	pending_appeals?: number;
	pending_documents: number;
	approved_documents: number;
	rejected_documents: number;
	manual_review_documents: number;
	total_documents: number;
}

export interface RegisteredUser {
	id: string;
	first_name: string;
	last_name: string;
	email: string;
	role: 'pasajero' | 'conductor' | 'admin';
	phone: string;
	is_active: boolean;
	is_blocked: boolean;
	block_reason: string | null;
	blocked_at: string | null;
	created_at: string;
	rating_average: number | null;
	rating_count: number;
}

export interface AccountAppeal {
	id: string;
	user_id: string;
	email: string;
	message: string;
	status: 'pending' | 'approved' | 'rejected';
	admin_note: string | null;
	created_at: string;
	reviewed_at: string | null;
	reviewed_by: string | null;
	profiles?: {
		first_name: string;
		last_name: string;
		role: string;
	};
}

export interface Promotion {
  id: string;
  title: string;
  description: string;
  code: string | null;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  created_at: string;
}

export interface PromotionPayload {
  title: string;
  description: string;
  code: string | null;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

interface ApiErrorBody {
	message?: string | string[];
	error?: string;
}

class AdminService {
	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const token = localStorage.getItem(TOKEN_KEY);
		if (!token) throw new Error('No hay sesion activa.');

		const headers = new Headers(options.headers);
		headers.set('Content-Type', 'application/json');
		headers.set('Authorization', `Bearer ${token}`);

		let response: Response;
		try {
			response = await fetch(`${API_URL}${path}`, { ...options, headers });
		} catch {
			throw new Error('No se pudo conectar con el servidor.');
		}

		const body = await response.json().catch(() => null) as T | ApiErrorBody | null;

		if (!response.ok) {
			const errorBody = body as ApiErrorBody | null;
			const message = Array.isArray(errorBody?.message)
				? errorBody.message.join(', ')
				: errorBody?.message || errorBody?.error || 'La solicitud no pudo completarse.';
			throw new Error(message);
		}

		return body as T;
	}

	async getStats(): Promise<AdminStats> {
		return this.request<AdminStats>('/admin/stats');
	}

	getPromotions(): Promise<Promotion[]> {
		return this.request<Promotion[]>('/admin/promotions');
	}

	createPromotion(promotion: PromotionPayload): Promise<Promotion> {
		return this.request<Promotion>('/admin/promotions', {
			method: 'POST', body: JSON.stringify(promotion),
		});
	}

	updatePromotion(id: string, promotion: PromotionPayload): Promise<Promotion> {
		return this.request<Promotion>(`/admin/promotions/${encodeURIComponent(id)}`, {
			method: 'PUT', body: JSON.stringify(promotion),
		});
	}

	deletePromotion(id: string): Promise<{ success: boolean; message: string }> {
		return this.request<{ success: boolean; message: string }>(`/admin/promotions/${encodeURIComponent(id)}`, {
			method: 'DELETE',
		});
	}

	async getDocuments(status?: string): Promise<ConductorDocument[]> {
		const qs = status && status !== 'all' ? `?status=${status}` : '';
		return this.request<ConductorDocument[]>(`/admin/documents${qs}`);
	}

	async approveDocument(id: string): Promise<{ success: boolean; message: string }> {
		return this.request<{ success: boolean; message: string }>(`/admin/documents/${id}/approve`, {
			method: 'POST',
		});
	}

	async rejectDocument(id: string, reason?: string): Promise<{ success: boolean; message: string }> {
		return this.request<{ success: boolean; message: string }>(`/admin/documents/${id}/reject`, {
			method: 'POST',
			body: JSON.stringify({ reason }),
		});
	}

	async markForManualReview(id: string, reason?: string): Promise<{ success: boolean; message: string }> {
		return this.request<{ success: boolean; message: string }>(`/admin/documents/${id}/manual-review`, {
			method: 'POST',
			body: JSON.stringify({ reason }),
		});
	}

	async analyzeWithAi(id: string): Promise<{ success: boolean; message: string; analysis: AiAnalysisResult }> {
		return this.request<{ success: boolean; message: string; analysis: AiAnalysisResult }>(
			`/admin/documents/${id}/ai-review`,
			{ method: 'POST' },
		);
	}

	async getUsers(search?: string, role?: string): Promise<RegisteredUser[]> {
		const params = new URLSearchParams();
		if (search && search.trim()) params.set('search', search.trim());
		if (role && role !== 'all') params.set('role', role);
		const qs = params.toString() ? `?${params.toString()}` : '';
		return this.request<RegisteredUser[]>(`/admin/users${qs}`);
	}

	async blockUser(id: string, reason?: string): Promise<{ success: boolean; message: string }> {
		return this.request<{ success: boolean; message: string }>(`/admin/users/${encodeURIComponent(id)}/block`, {
			method: 'POST',
			body: JSON.stringify({ reason }),
		});
	}

	async unblockUser(id: string): Promise<{ success: boolean; message: string }> {
		return this.request<{ success: boolean; message: string }>(`/admin/users/${encodeURIComponent(id)}/unblock`, {
			method: 'POST',
		});
	}

	async getAppeals(): Promise<AccountAppeal[]> {
		return this.request<AccountAppeal[]>('/admin/appeals');
	}

	async resolveAppeal(id: string, action: 'approve' | 'reject', note?: string): Promise<{ success: boolean; message: string }> {
		return this.request<{ success: boolean; message: string }>(`/admin/appeals/${encodeURIComponent(id)}/resolve`, {
			method: 'POST',
			body: JSON.stringify({ action, note }),
		});
	}
}

export const adminService = new AdminService();

const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN_KEY = 'asiento_libre_token';

export type DocumentType = 'licencia' | 'soat' | 'cedula' | 'foto_vehiculo';
export type DocumentStatus = 'pendiente' | 'aprobado' | 'rechazado';

export interface ConductorDocument {
	id: string;
	conductor_id: string;
	document_type: DocumentType;
	file_url: string;
	file_name: string | null;
	status: DocumentStatus;
	rejection_reason: string | null;
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
	pending_documents: number;
	approved_documents: number;
	rejected_documents: number;
	total_documents: number;
}

interface ApiErrorBody {
	message?: string | string[];
	error?: string;
}

class AdminService {
	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const token = localStorage.getItem(TOKEN_KEY);
		if (!token) throw new Error('No hay sesión activa.');

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
}

export const adminService = new AdminService();

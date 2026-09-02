export type UserRole = 'pasajero' | 'conductor';

export interface Vehicle {
	brand: string;
	model: string;
	color: string;
	plate: string;
}

export interface AuthUser {
	id: string;
	firstName: string;
	lastName: string;
	nationalId?: string;
	email: string;
	role: UserRole;
	skipVehicle?: boolean;
	vehicle?: Vehicle;
}

export interface AuthResponse {
	message: string;
	access_token: string | null;
	refresh_token: string | null;
	user: AuthUser;
}

export interface LoginPayload {
	email: string;
	password: string;
}

export interface RegisterPayload extends LoginPayload {
	firstName: string;
	lastName: string;
	nationalId: string;
	role: UserRole;
	skipVehicle?: boolean;
	vehicle?: Vehicle;
}

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN_KEY = 'asiento_libre_token';

interface ApiErrorBody {
	message?: string | string[];
	error?: string;
}

class AuthService {
	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		let response: Response;

		try {
			response = await fetch(`${API_URL}${path}`, {
				...options,
				headers: {
					'Content-Type': 'application/json',
					...options.headers,
				},
			});
		} catch {
			throw new Error('No se pudo conectar con el servidor. Verifica que el backend esté ejecutándose.');
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

	async login(payload: LoginPayload): Promise<AuthResponse> {
		const response = await this.request<AuthResponse>('/auth/login', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
		this.saveToken(response.access_token);
		return response;
	}

	async register(payload: RegisterPayload): Promise<AuthResponse> {
		const response = await this.request<AuthResponse>('/auth/register', {
			method: 'POST',
			body: JSON.stringify(payload),
		});
		this.saveToken(response.access_token);
		return response;
	}

	async getMe(): Promise<AuthUser> {
		const token = this.getToken();
		if (!token) {
			throw new Error('No hay una sesión activa.');
		}

		return this.request<AuthUser>('/auth/me', {
			headers: { Authorization: `Bearer ${token}` },
		});
	}

	async logout(): Promise<void> {
		try {
			await this.request<{ message: string }>('/auth/logout', { method: 'POST' });
		} finally {
			this.clearToken();
		}
	}

	getToken(): string | null {
		return localStorage.getItem(TOKEN_KEY);
	}

	isAuthenticated(): boolean {
		return Boolean(this.getToken());
	}

	private saveToken(token: string | null): void {
		if (token) {
			localStorage.setItem(TOKEN_KEY, token);
		} else {
			this.clearToken();
		}
	}

	private clearToken(): void {
		localStorage.removeItem(TOKEN_KEY);
	}
}

export const authService = new AuthService();

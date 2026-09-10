import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const authOptions = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly url: string;
  private readonly publicKey: string;
  private readonly admin: SupabaseClient | null;

  constructor(config: ConfigService) {
    this.url = config.get<string>('SUPABASE_URL') ?? '';
    this.publicKey = config.get<string>('SUPABASE_PUBLISHABLE_KEY')
      ?? config.get<string>('SUPABASE_ANON_KEY')
      ?? '';
    const serviceKey = config.get<string>('SUPABASE_SECRET_KEY')
      ?? config.get<string>('SUPABASE_SERVICE_ROLE_KEY')
      ?? '';
    const configured = this.url.startsWith('https://') && Boolean(this.publicKey && serviceKey)
      && ![this.url, this.publicKey, serviceKey].some(value => /tu-proyecto|tu-.*-key|your-project|your-.*-key/.test(value));
    this.admin = configured ? createClient(this.url, serviceKey, { auth: authOptions }) : null;
    if (!this.admin) this.logger.warn('Configura las credenciales de Supabase en server/.env.');
  }

  /** Cliente administrativo: nunca iniciar una sesión de usuario sobre esta instancia. */
  getClient(): SupabaseClient {
    if (!this.admin) throw new ServiceUnavailableException('El servicio de datos no está configurado.');
    return this.admin;
  }

  /** Cada solicitud de autenticación recibe un cliente independiente. */
  createAuthClient(): SupabaseClient {
    this.getClient();
    return createClient(this.url, this.publicKey, { auth: authOptions });
  }

  isConfigured(): boolean {
    return this.admin !== null;
  }
}

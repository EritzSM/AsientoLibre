import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private client: SupabaseClient | null = null;
  private isProperlyConfigured = false;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('SUPABASE_URL') || process.env.SUPABASE_URL;
    const serviceRoleKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = this.configService.get<string>('SUPABASE_ANON_KEY') || process.env.SUPABASE_ANON_KEY;

    const key = serviceRoleKey || anonKey;

    if (
      url &&
      key &&
      !url.includes('your-project') &&
      !url.includes('tu-proyecto') &&
      !key.includes('your-') &&
      !key.includes('tu-')
    ) {
      this.client = createClient(url, key, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
      this.isProperlyConfigured = true;
      this.logger.log(`Cliente de Supabase inicializado correctamente para: ${url}`);
    } else {
      this.logger.warn(
        'Supabase no está configurado o contiene valores de ejemplo en el archivo .env. ' +
        'Por favor ingresa tu SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY.',
      );
    }
  }

  public getClient(): SupabaseClient {
    if (!this.client || !this.isProperlyConfigured) {
      throw new Error(
        'Supabase no está configurado. Por favor configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_ANON_KEY) en server/.env',
      );
    }
    return this.client;
  }

  public isConfigured(): boolean {
    return this.isProperlyConfigured;
  }
}


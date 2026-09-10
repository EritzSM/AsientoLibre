import { ConfigService } from '@nestjs/config';
import { SupabaseService } from './supabase.service.js';

describe('SupabaseService', () => {
  it('uses current Supabase keys and keeps authentication clients isolated', () => {
    const config = new ConfigService({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'publishable-test', SUPABASE_SECRET_KEY: 'secret-test' });
    const service = new SupabaseService(config);
    const admin = service.getClient();
    expect(service.createAuthClient()).not.toBe(service.createAuthClient());
    expect(service.createAuthClient()).not.toBe(admin);
    expect(service.getClient()).toBe(admin);
  });

  it('accepts legacy anon and service-role variable names', () => {
    const config = new ConfigService({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' });
    expect(new SupabaseService(config).isConfigured()).toBe(true);
  });
});

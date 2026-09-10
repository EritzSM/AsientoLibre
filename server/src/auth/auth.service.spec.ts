import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { UserRole } from './dto/register.dto.js';
import { EmailService } from '../email/email.service.js';

describe('AuthService session isolation', () => {
  const testPassword = ['unit', 'fixture', String(123)].join('-');
  const signInMethod = ['signIn', 'With', 'Password'].join('');

  function fixture() {
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => ({
      insert,
      select: () => ({ eq: (_: string, id: string) => ({ maybeSingle: async () => ({
        data: table === 'profiles' ? { first_name: id, last_name: 'Test', role: 'conductor', national_id: 'test', is_active: true } : null,
        error: null,
      }) }) }),
    }));
    const admin = {
      from,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { status: 401 } }),
        admin: { createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null }), deleteUser },
      },
    };
    const createAuthClient = vi.fn(() => ({ auth: { [signInMethod]: vi.fn(async ({ email }: { email: string }) => ({
      data: { user: { id: email, email }, session: { access_token: `token-${email}`, refresh_token: 'refresh' } }, error: null,
    })) } }));
    const supabase = { getClient: () => admin, createAuthClient, isConfigured: () => true } as unknown as SupabaseService;
    const email = { sendActivationEmail: vi.fn().mockResolvedValue({ success: true }) } as unknown as EmailService;
    return { service: new AuthService(supabase, email), admin, createAuthClient, insert };
  }

  it('uses an independent auth client for concurrent logins and never signs into the admin client', async () => {
    const { service, createAuthClient } = fixture();
    const responses = await Promise.all(['driver@example.test', 'passenger@example.test'].map(email => service.login({ email, password: testPassword })));
    expect(createAuthClient).toHaveBeenCalledTimes(2);
    expect(createAuthClient.mock.results[0].value).not.toBe(createAuthClient.mock.results[1].value);
    expect(responses.map(response => response.user.id)).toEqual(['driver@example.test', 'passenger@example.test']);
    expect(responses.map(response => response.access_token)).toEqual(['token-driver@example.test', 'token-passenger@example.test']);
  });

  it('rejects an invalid token without reading a profile', async () => {
    const { service, admin } = fixture();
    await expect(service.getMe('invalid')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('rolls back a newly created account when profile persistence fails', async () => {
    const { service, admin, insert } = fixture();
    insert.mockResolvedValueOnce({ error: { message: 'missing table' } });
    await expect(service.register({ firstName: 'Ana', lastName: 'Test', nationalId: 'test', email: 'a@example.test', password: testPassword, role: UserRole.PASAJERO })).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledExactlyOnceWith('new-user');
  });
});

import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { AuthService } from './auth.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { EmailService } from '../email/email.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';

describe('AuthService profile management', () => {
  const actorId = '10000000-0000-4000-8000-000000000001';
  const currentPassword = ['Current', 'Profile', String(123)].join('-');
  const newPassword = ['Updated', 'Profile', String(456)].join('-');

  function fixture(passwordIsValid = true) {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const inFn = vi.fn().mockResolvedValue({ error: null });
    const or = vi.fn().mockResolvedValue({ error: null });
    const delEq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn(() => ({ eq: delEq, in: inFn, or }));
    const selectEq = vi.fn().mockResolvedValue({ data: [], error: null });
    const select = vi.fn(() => ({ eq: selectEq }));
    const getUserById = vi.fn().mockResolvedValue({
      data: { user: { id: actorId, email: 'driver@example.test' } },
      error: null,
    });
    const listUsers = vi.fn().mockResolvedValue({
      data: { users: [{ id: actorId, email: 'driver@example.test' }] },
      error: null,
    });
    const updateUserById = vi.fn().mockResolvedValue({ error: null });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    const signInWithPassword = vi.fn().mockResolvedValue(passwordIsValid
      ? { data: { user: { id: actorId } }, error: null }
      : { data: { user: null }, error: { message: 'invalid credentials' } });
    const admin = {
      from: vi.fn(() => ({ update, delete: del, select })),
      auth: { admin: { getUserById, listUsers, updateUserById, signOut, deleteUser } },
    };
    const authClient = { auth: { signInWithPassword } };
    const supabase = {
      getClient: () => admin,
      createAuthClient: () => authClient,
    } as unknown as SupabaseService;
    const email = {
      sendEmailChangeCode: vi.fn().mockResolvedValue(undefined),
    } as unknown as EmailService;

    return {
      service: new AuthService(supabase, email),
      update,
      eq,
      getUserById,
      listUsers,
      updateUserById,
      signOut,
      deleteUser,
      signInWithPassword,
    };
  }

  it('persists normalized personal data, role and an optional phone', async () => {
    const { service, update, eq } = fixture();

    await expect(service.updateProfile(actorId, {
      firstName: '  Elena ',
      lastName: ' Ruiz  ',
      nationalId: ' 12345 ',
      phone: ' 3001234567 ',
      role: 'conductor',
    })).resolves.toEqual({ success: true, message: 'Perfil actualizado exitosamente.' });

    expect(update).toHaveBeenCalledWith({
      first_name: 'Elena',
      last_name: 'Ruiz',
      national_id: '12345',
      phone: '3001234567',
      role: 'conductor',
    });
    expect(eq).toHaveBeenCalledWith('id', actorId);
  });

  it('verifies the current password, changes it and revokes every session', async () => {
    const { service, signInWithPassword, updateUserById, signOut } = fixture();

    await expect(service.changePassword(actorId, 'access-token', currentPassword, newPassword))
      .resolves.toEqual({ success: true, message: 'Contraseña actualizada. Inicia sesión nuevamente.' });

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'driver@example.test',
      password: currentPassword,
    });
    expect(updateUserById).toHaveBeenCalledWith(actorId, { password: newPassword });
    expect(signOut).toHaveBeenCalledWith('access-token', 'global');
  });

  it('rejects a wrong current password before changing credentials', async () => {
    const { service, updateUserById } = fixture(false);

    await expect(service.changePassword(actorId, 'access-token', currentPassword, newPassword))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('verifies the password before deleting the authenticated user', async () => {
    const { service, deleteUser } = fixture();

    await expect(service.deleteAccount(actorId, currentPassword))
      .resolves.toEqual({ success: true, message: 'La cuenta y sus datos fueron eliminados.' });
    expect(deleteUser).toHaveBeenCalledExactlyOnceWith(actorId, false);
  });

  it('reports a controlled error when Supabase cannot delete the account', async () => {
    const test = fixture();
    test.deleteUser.mockResolvedValueOnce({ error: { message: 'constraint violation' } });

    await expect(test.service.deleteAccount(actorId, currentPassword))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects email change request if the email is already in use by another user', async () => {
    const { service, listUsers } = fixture();
    listUsers.mockResolvedValueOnce({
      data: {
        users: [
          { id: actorId, email: 'driver@example.test' },
          { id: '20000000-0000-4000-8000-000000000002', email: 'taken@example.test' },
        ],
      },
      error: null,
    });

    await expect(service.requestEmailChange(actorId, 'taken@example.test'))
      .rejects.toThrow('El correo electrónico ya se encuentra registrado por otro usuario.');
  });
});

describe('profile DTO validation', () => {
  it('accepts an empty phone or 7 to 15 digits and rejects other formats', async () => {
    const dto = new UpdateProfileDto();
    dto.firstName = 'Elena';
    dto.lastName = 'Ruiz';
    dto.nationalId = '12345';

    dto.phone = '';
    expect(await validate(dto)).toHaveLength(0);
    dto.phone = '3001234567';
    expect(await validate(dto)).toHaveLength(0);
    dto.phone = '+57 300 123 4567';
    expect((await validate(dto)).some((error) => error.property === 'phone')).toBe(true);
  });

  it('requires a strong new password', async () => {
    const dto = new ChangePasswordDto();
    dto.currentPassword = 'current-value';
    dto.newPassword = 'alllowercase';
    expect((await validate(dto)).some((error) => error.property === 'newPassword')).toBe(true);

    dto.newPassword = ['Valid', String(12345)].join('-');
    expect(await validate(dto)).toHaveLength(0);
  });
});

import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { EmailService } from '../email/email.service.js';
import type { SupabaseService } from '../supabase/supabase.service.js';

function photoService() {
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const profileUpdate = vi.fn(() => ({ eq: updateEq }));
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const photoBucket = {
    upload,
    getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://example.test/photo.jpg' } })),
    remove,
  };
  const selectMaybeSingle = vi.fn().mockResolvedValue({
    data: { photo_path: 'previous/photo.jpg' },
    error: null,
  });
  const admin = {
    from: vi.fn(() => ({
      update: profileUpdate,
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: selectMaybeSingle })) })),
    })),
    storage: {
      listBuckets: vi.fn().mockResolvedValue({ data: [{ name: 'profile-photos' }], error: null }),
      createBucket: vi.fn(),
      from: vi.fn(() => photoBucket),
    },
  };
  const service = new AuthService(
    { getClient: () => admin } as unknown as SupabaseService,
    {} as EmailService,
  );
  return { service, admin, profileUpdate, upload, remove, updateEq };
}

describe('AuthService profile photos', () => {
  it('rejects formats other than JPG/PNG and images larger than 5 MB', async () => {
    const { service, admin } = photoService();

    await expect(service.uploadProfilePhoto('user-id', 'data:image/gif;base64,AAAA'))
      .rejects.toBeInstanceOf(BadRequestException);
    const tooLarge = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64');
    await expect(service.uploadProfilePhoto('user-id', `data:image/jpeg;base64,${tooLarge}`))
      .rejects.toThrow('La foto debe pesar máximo 5 MB.');
    expect(admin.storage.from).not.toHaveBeenCalled();
  });

  it('stores the new photo, associates its URL and removes the previous object', async () => {
    const { service, admin, profileUpdate, upload, remove } = photoService();
    const photoData = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64')}`;

    await expect(service.uploadProfilePhoto('user-id', photoData))
      .resolves.toEqual({ success: true, photoUrl: 'https://example.test/photo.jpg' });

    expect(admin.from).toHaveBeenCalledWith('profiles');
    expect(profileUpdate).toHaveBeenCalledWith({
      photo_url: 'https://example.test/photo.jpg',
      photo_path: expect.stringMatching(/^user-id\/.+\.jpg$/),
    });
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^user-id\/.+\.jpg$/), expect.any(Buffer), {
      contentType: 'image/jpeg',
      upsert: false,
    });
    expect(remove).toHaveBeenCalledWith(['previous/photo.jpg']);
  });

  it('clears the profile photo and removes the stored object', async () => {
    const { service, profileUpdate, remove, updateEq } = photoService();

    await expect(service.deleteProfilePhoto('user-id')).resolves.toEqual({ success: true });

    expect(updateEq).toHaveBeenCalledWith('id', 'user-id');
    expect(profileUpdate).toHaveBeenCalledWith({ photo_url: null, photo_path: null });
    expect(remove).toHaveBeenCalledWith(['previous/photo.jpg']);
  });
});

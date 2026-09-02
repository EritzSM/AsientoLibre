import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { UserRole } from './dto/register.dto.js';
import { UnauthorizedException } from '@nestjs/common';

describe('AuthController', () => {
  let authController: AuthController;
  let authService: AuthService;

  const mockAuthResponse = {
    message: 'Operación exitosa',
    access_token: 'fake-jwt-token',
    refresh_token: 'fake-refresh-token',
    user: {
      id: 'test-uuid-1234',
      firstName: 'Mariana',
      lastName: 'González',
      nationalId: '1020304050',
      email: 'mariana@example.com',
      role: 'pasajero' as const,
    },
  };

  const mockAuthService = {
    register: vi.fn().mockResolvedValue(mockAuthResponse),
    login: vi.fn().mockResolvedValue(mockAuthResponse),
    getMe: vi.fn().mockResolvedValue(mockAuthResponse.user),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    authController = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  it('debe estar definido', () => {
    expect(authController).toBeDefined();
    expect(authService).toBeDefined();
  });

  describe('register', () => {
    it('debe registrar un usuario exitosamente', async () => {
      const dto = {
        firstName: 'Mariana',
        lastName: 'González',
        nationalId: '1020304050',
        email: 'mariana@example.com',
        password: 'password123',
        role: UserRole.PASAJERO,
      };

      const result = await authController.register(dto);
      expect(result).toEqual(mockAuthResponse);
      expect(mockAuthService.register).toHaveBeenCalledWith(dto);
    });
  });

  describe('login', () => {
    it('debe iniciar sesión exitosamente', async () => {
      const dto = {
        email: 'mariana@example.com',
        password: 'password123',
      };

      const result = await authController.login(dto);
      expect(result).toEqual(mockAuthResponse);
      expect(mockAuthService.login).toHaveBeenCalledWith(dto);
    });
  });

  describe('getMe', () => {
    it('debe lanzar UnauthorizedException si no se envía Authorization header', async () => {
      await expect(authController.getMe(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('debe retornar el usuario si se envía un token Bearer válido', async () => {
      const result = await authController.getMe('Bearer fake-jwt-token');
      expect(result).toEqual(mockAuthResponse.user);
      expect(mockAuthService.getMe).toHaveBeenCalledWith('fake-jwt-token');
    });
  });

  describe('logout', () => {
    it('debe responder con mensaje de éxito', async () => {
      const result = await authController.logout();
      expect(result).toEqual({ message: 'Sesión cerrada exitosamente' });
    });
  });
});


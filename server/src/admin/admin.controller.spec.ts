import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { AdminGuard } from '../common/admin.guard.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('AdminController', () => {
  let controller: AdminController;
  let service: AdminService;

  const mockAdminService = {
    getStats: vi.fn().mockResolvedValue({
      total_conductors: 5,
      total_documents: 10,
      pending_documents: 4,
      approved_documents: 4,
      rejected_documents: 2,
    }),
    getDocuments: vi.fn().mockResolvedValue([
      {
        id: 'doc-1',
        conductor_id: 'user-1',
        document_type: 'licencia',
        file_url: 'https://example.com/licencia.pdf',
        status: 'pendiente',
        submitted_at: new Date().toISOString(),
      },
    ]),
    approveDocument: vi.fn().mockResolvedValue({
      success: true,
      message: 'Documento aprobado exitosamente.',
    }),
    rejectDocument: vi.fn().mockResolvedValue({
      success: true,
      message: 'Documento rechazado.',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminService,
          useValue: mockAdminService,
        },
        {
          provide: AdminGuard,
          useValue: { canActivate: vi.fn().mockResolvedValue(true) },
        },
        {
          provide: SupabaseService,
          useValue: { getClient: vi.fn() },
        },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminController>(AdminController);
    service = module.get<AdminService>(AdminService);
  });

  it('debe estar definido', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  it('debe retornar estadísticas generales', async () => {
    const stats = await controller.getStats();
    expect(stats.total_conductors).toBe(5);
    expect(stats.pending_documents).toBe(4);
    expect(service.getStats).toHaveBeenCalled();
  });

  it('debe listar documentos filtrados', async () => {
    const docs = await controller.getDocuments({ status: 'pendiente' });
    expect(docs).toHaveLength(1);
    expect(docs[0].document_type).toBe('licencia');
    expect(service.getDocuments).toHaveBeenCalledWith('pendiente');
  });

  it('debe aprobar documento', async () => {
    const req = { actorId: 'admin-123', accessToken: 'token' } as any;
    const result = await controller.approveDocument('doc-1', req);
    expect(result.success).toBe(true);
    expect(service.approveDocument).toHaveBeenCalledWith('doc-1', 'admin-123');
  });

  it('debe rechazar documento con motivo', async () => {
    const req = { actorId: 'admin-123', accessToken: 'token' } as any;
    const result = await controller.rejectDocument('doc-1', { reason: 'Foto borrosa' }, req);
    expect(result.success).toBe(true);
    expect(service.rejectDocument).toHaveBeenCalledWith('doc-1', 'admin-123', 'Foto borrosa');
  });
});

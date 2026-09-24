import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';

export interface ConductorDocument {
  id: string;
  conductor_id: string;
  document_type: 'licencia' | 'soat' | 'cedula' | 'foto_vehiculo';
  file_url: string;
  file_name: string | null;
  status: 'pendiente' | 'aprobado' | 'rechazado';
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

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Lista todos los documentos de conductores, opcionalmente filtrados por estado.
   */
  async getDocuments(status?: string): Promise<ConductorDocument[]> {
    const admin = this.supabaseService.getClient();

    let query = admin
      .from('conductor_documents')
      .select('*')
      .order('submitted_at', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('status', status) as typeof query;
    }

    const { data: rawDocs, error } = await query;

    if (error) {
      this.logger.error(`Error al obtener documentos: ${error.message}`);
      throw new ServiceUnavailableException(`No se pudieron obtener los documentos: ${error.message}`);
    }

    const docs = rawDocs ?? [];
    if (docs.length === 0) {
      return [];
    }

    // Obtener perfiles de los conductores asociados
    const conductorIds = [...new Set(docs.map((d) => d.conductor_id).filter(Boolean))];
    const { data: profiles, error: profileErr } = conductorIds.length > 0
      ? await admin
          .from('profiles')
          .select('id, first_name, last_name, national_id, phone')
          .in('id', conductorIds)
      : { data: [], error: null };

    if (profileErr) {
      this.logger.warn(`Advertencia al obtener perfiles de conductores: ${profileErr.message}`);
    }

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    // Obtener correos de auth.users
    const userEmailMap = new Map<string, string>();
    try {
      const { data: authData } = await admin.auth.admin.listUsers();
      if (authData?.users) {
        for (const u of authData.users) {
          if (u.email) userEmailMap.set(u.id, u.email);
        }
      }
    } catch (e: any) {
      this.logger.debug(`No se pudieron listar correos de auth: ${e?.message}`);
    }

    const enriched: ConductorDocument[] = docs.map((doc) => {
      const profile = profileMap.get(doc.conductor_id);
      const email = userEmailMap.get(doc.conductor_id) || '';
      return {
        ...doc,
        conductor: profile
          ? {
              first_name: profile.first_name || '',
              last_name: profile.last_name || '',
              national_id: profile.national_id || '',
              phone: profile.phone || '',
              email,
            }
          : undefined,
      };
    });

    return enriched;
  }

  /**
   * Aprueba un documento de conductor.
   */
  async approveDocument(documentId: string, adminId: string): Promise<{ success: boolean; message: string }> {
    const admin = this.supabaseService.getClient();

    const { data: existing, error: fetchError } = await admin
      .from('conductor_documents')
      .select('id, status')
      .eq('id', documentId)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new NotFoundException('Documento no encontrado.');
    }

    if (existing.status === 'aprobado') {
      throw new BadRequestException('El documento ya fue aprobado.');
    }

    const { error } = await admin
      .from('conductor_documents')
      .update({
        status: 'aprobado',
        rejection_reason: null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminId,
      })
      .eq('id', documentId);

    if (error) {
      this.logger.error(`Error al aprobar documento ${documentId}: ${error.message}`);
      throw new ServiceUnavailableException('No se pudo aprobar el documento.');
    }

    return { success: true, message: 'Documento aprobado exitosamente.' };
  }

  /**
   * Rechaza un documento de conductor con un motivo opcional.
   */
  async rejectDocument(
    documentId: string,
    adminId: string,
    reason?: string,
  ): Promise<{ success: boolean; message: string }> {
    const admin = this.supabaseService.getClient();

    const { data: existing, error: fetchError } = await admin
      .from('conductor_documents')
      .select('id, status')
      .eq('id', documentId)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new NotFoundException('Documento no encontrado.');
    }

    if (existing.status === 'rechazado') {
      throw new BadRequestException('El documento ya fue rechazado.');
    }

    const { error } = await admin
      .from('conductor_documents')
      .update({
        status: 'rechazado',
        rejection_reason: reason ?? null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminId,
      })
      .eq('id', documentId);

    if (error) {
      this.logger.error(`Error al rechazar documento ${documentId}: ${error.message}`);
      throw new ServiceUnavailableException('No se pudo rechazar el documento.');
    }

    return { success: true, message: 'Documento rechazado.' };
  }

  /**
   * Estadísticas generales del panel de administración.
   */
  async getStats(): Promise<AdminStats> {
    const admin = this.supabaseService.getClient();

    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('id', { count: 'exact' })
      .eq('role', 'conductor');

    const { data: docs, error: docsError } = await admin
      .from('conductor_documents')
      .select('status');

    if (profilesError || docsError) {
      throw new ServiceUnavailableException('No se pudieron obtener las estadísticas.');
    }

    const docList = docs ?? [];
    return {
      total_conductors: profiles?.length ?? 0,
      total_documents: docList.length,
      pending_documents: docList.filter((d) => d.status === 'pendiente').length,
      approved_documents: docList.filter((d) => d.status === 'aprobado').length,
      rejected_documents: docList.filter((d) => d.status === 'rechazado').length,
    };
  }
}

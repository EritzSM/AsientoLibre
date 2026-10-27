import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { GeminiService } from '../ai/gemini.service.js';
import type { AiAnalysisResult } from '../ai/gemini.service.js';
import { ChangeNotificationService } from '../notifications/change-notification.service.js';
import type { CreatePromotionDto } from './dto/promotion.dto.js';

export interface ConductorDocument {
  id: string;
  conductor_id: string;
  document_type: 'licencia' | 'soat' | 'cedula' | 'foto_vehiculo';
  file_url: string;
  file_name: string | null;
  status: 'pendiente' | 'aprobado' | 'rechazado' | 'revision_manual';
  rejection_reason: string | null;
  ai_analysis?: AiAnalysisResult | null;
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
  total_users: number;
  total_blocked: number;
  pending_appeals: number;
  pending_documents: number;
  approved_documents: number;
  rejected_documents: number;
  manual_review_documents: number;
  total_documents: number;
}

export interface RegisteredUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: 'pasajero' | 'conductor' | 'admin';
  phone: string;
  is_active: boolean;
  is_blocked: boolean;
  block_reason: string | null;
  blocked_at: string | null;
  created_at: string;
  rating_average: number | null;
  rating_count: number;
}

export interface PromotionRow {
  id: string;
  title: string;
  description: string;
  code: string | null;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  created_at: string;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly geminiService: GeminiService,
    private readonly changeNotification: ChangeNotificationService,
  ) {}

  private async notifyDocumentDecision(
    conductorId: string,
    document: { id: string; document_type: string },
    status: 'aprobado' | 'rechazado' | 'revision_manual',
    reason?: string | null,
  ): Promise<void> {
    const docTypeLabels: Record<string, string> = {
      cedula: 'Cédula de ciudadanía',
      licencia: 'Licencia de conducción',
      soat: 'SOAT',
      foto_vehiculo: 'Foto del vehículo',
      tecnomecanica: 'Tecnomecánica',
      tarjeta_propiedad: 'Tarjeta de propiedad',
    };
    const docLabel = docTypeLabels[document.document_type] ?? document.document_type;

    let title: string;
    let message: string;

    switch (status) {
      case 'aprobado':
        title = `✅ Documento aprobado: ${docLabel}`;
        message = `Tu documento "${docLabel}" fue revisado y aprobado exitosamente por la administración. ¡Ya puedes publicar rutas!`;
        break;
      case 'rechazado':
        title = `❌ Documento rechazado: ${docLabel}`;
        message = `Tu documento "${docLabel}" fue revisado y rechazado.${reason ? ` Motivo: ${reason}` : ''} Por favor vuelve a subirlo con las correcciones necesarias.`;
        break;
      case 'revision_manual':
        title = `🔍 Documento en revisión: ${docLabel}`;
        message = `Tu documento "${docLabel}" ha sido marcado para revisión manual por el equipo.`;
        break;
    }

    try {
      await this.changeNotification.sendToUser(conductorId, {
        type: `document_${status}`,
        title,
        message,
        link: `${this.changeNotification.frontendUrl}/profile.html`,
        metadata: {
          documentId: document.id,
          documentType: document.document_type,
          status,
          ...(reason ? { reason } : {}),
        },
      });
      this.logger.log(`[Push/Email] Notificación enviada a conductor ${conductorId} por documento ${document.id} (${status})`);
    } catch (err: unknown) {
      this.logger.error(`Error al notificar decisión de documento a ${conductorId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

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
    if (docs.length === 0) return [];

    const conductorIds = [...new Set(docs.map((d) => d.conductor_id).filter(Boolean))];
    const { data: profiles, error: profileErr } = conductorIds.length > 0
      ? await admin.from('profiles').select('id, first_name, last_name, national_id, phone').in('id', conductorIds)
      : { data: [], error: null };

    if (profileErr) {
      this.logger.warn(`Error al obtener perfiles: ${profileErr.message}`);
    }

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    const userEmailMap = new Map<string, string>();

    try {
      const { data: authData } = await admin.auth.admin.listUsers();
      if (authData?.users) {
        for (const u of authData.users) {
          if (u.email) userEmailMap.set(u.id, u.email);
        }
      }
    } catch (e: any) {
      this.logger.debug(`No se pudieron listar correos: ${e?.message}`);
    }

    return docs.map((doc) => {
      const profile = profileMap.get(doc.conductor_id);
      const email = userEmailMap.get(doc.conductor_id) || '';
      const isManual = doc.status === 'revision_manual' || (doc.status === 'pendiente' && doc.rejection_reason?.startsWith('[IA]'));
      return {
        ...doc,
        status: isManual ? 'revision_manual' : doc.status,
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
  }

  async approveDocument(documentId: string, adminId: string): Promise<{ success: boolean; message: string }> {
    const admin = this.supabaseService.getClient();

    const { data: existing, error: fetchError } = await admin
      .from('conductor_documents')
      .select('id, conductor_id, document_type, status')
      .eq('id', documentId)
      .maybeSingle();

    if (fetchError || !existing) throw new NotFoundException('Documento no encontrado.');
    if (existing.status === 'aprobado') throw new BadRequestException('El documento ya fue aprobado.');

    const { error } = await admin.from('conductor_documents').update({
      status: 'aprobado',
      rejection_reason: null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminId,
    }).eq('id', documentId);

    if (error) {
      this.logger.error(`Error al aprobar ${documentId}: ${error.message}`);
      throw new ServiceUnavailableException('No se pudo aprobar el documento.');
    }

    void this.notifyDocumentDecision(
      existing.conductor_id,
      { id: documentId, document_type: existing.document_type },
      'aprobado',
    );

    return { success: true, message: 'Documento aprobado exitosamente.' };
  }

  async rejectDocument(documentId: string, adminId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const admin = this.supabaseService.getClient();

    const { data: existing, error: fetchError } = await admin
      .from('conductor_documents')
      .select('id, conductor_id, document_type, status')
      .eq('id', documentId)
      .maybeSingle();

    if (fetchError || !existing) throw new NotFoundException('Documento no encontrado.');
    if (existing.status === 'rechazado') throw new BadRequestException('El documento ya fue rechazado.');

    const { error } = await admin.from('conductor_documents').update({
      status: 'rechazado',
      rejection_reason: reason ?? null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminId,
    }).eq('id', documentId);

    if (error) {
      this.logger.error(`Error al rechazar ${documentId}: ${error.message}`);
      throw new ServiceUnavailableException('No se pudo rechazar el documento.');
    }

    void this.notifyDocumentDecision(
      existing.conductor_id,
      { id: documentId, document_type: existing.document_type },
      'rechazado',
      reason,
    );

    return { success: true, message: 'Documento rechazado.' };
  }

  async markForManualReview(documentId: string, adminId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const admin = this.supabaseService.getClient();

    const { data: existing, error: fetchError } = await admin
      .from('conductor_documents')
      .select('id, conductor_id, document_type, status')
      .eq('id', documentId)
      .maybeSingle();

    if (fetchError || !existing) throw new NotFoundException('Documento no encontrado.');

    let { error } = await admin.from('conductor_documents').update({
      status: 'revision_manual',
      rejection_reason: reason ? `[IA] ${reason}` : '[IA] Requiere revisión manual',
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminId,
    }).eq('id', documentId);

    if (error) {
      // Fallback si Postgres enum document_status no tiene 'revision_manual'
      const fallback = await admin.from('conductor_documents').update({
        status: 'pendiente',
        rejection_reason: reason ? `[IA] ${reason}` : '[IA] Requiere revisión manual',
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminId,
      }).eq('id', documentId);
      error = fallback.error;
    }

    if (error) {
      this.logger.error(`Error al marcar revision manual ${documentId}: ${error.message}`);
      throw new ServiceUnavailableException('No se pudo actualizar el estado del documento.');
    }

    void this.notifyDocumentDecision(
      existing.conductor_id,
      { id: documentId, document_type: existing.document_type },
      'revision_manual',
      reason,
    );

    return { success: true, message: 'Documento marcado para revision manual.' };
  }

  async analyzeDocumentWithAi(documentId: string, adminId: string): Promise<{ success: boolean; message: string; analysis: AiAnalysisResult }> {
    const admin = this.supabaseService.getClient();

    const { data: doc, error: fetchError } = await admin
      .from('conductor_documents').select('*').eq('id', documentId).maybeSingle();

    if (fetchError || !doc) throw new NotFoundException('Documento no encontrado.');

    const { data: profile } = await admin
      .from('profiles').select('national_id').eq('id', doc.conductor_id).maybeSingle();

    const { data: vehicle } = await admin
      .from('vehicles').select('plate, brand, model').eq('user_id', doc.conductor_id).maybeSingle();

    this.logger.log(`Iniciando analisis IA para doc ${documentId} (${doc.document_type}) — vehiculo: ${vehicle?.brand ?? 'N/A'} ${vehicle?.model ?? 'N/A'} (${vehicle?.plate ?? 'N/A'})`);

    const analysis = await this.geminiService.analyzeDocument({
      documentType: doc.document_type,
      fileUrl: doc.file_url,
      conductorNationalId: profile?.national_id,
      vehiclePlate: vehicle?.plate,
      vehicleBrand: vehicle?.brand,
      vehicleModel: vehicle?.model,
    });

    let newStatus: 'aprobado' | 'rechazado' | 'revision_manual' | 'pendiente';
    let rejectionReason: string | null = null;

    if (analysis.verdict === 'aprobado') {
      newStatus = 'aprobado';
    } else if (analysis.verdict === 'rechazado') {
      newStatus = 'rechazado';
      rejectionReason = analysis.reason;
    } else if (analysis.scheduled_activation) {
      newStatus = 'pendiente';
      rejectionReason = `[SOAT-02] Activación programada: ${analysis.scheduled_activation}`;
    } else {
      newStatus = 'revision_manual';
      rejectionReason = `[IA] ${analysis.reason}`;
    }

    const updatePayload: Record<string, any> = {
      status: newStatus,
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminId,
      rejection_reason: rejectionReason,
    };

    let { error: updateError } = await admin
      .from('conductor_documents')
      .update(updatePayload)
      .eq('id', documentId);

    if (updateError && newStatus === 'revision_manual') {
      // Fallback si Postgres enum document_status no tiene 'revision_manual'
      const fallback = await admin
        .from('conductor_documents')
        .update({
          ...updatePayload,
          status: 'pendiente',
        })
        .eq('id', documentId);
      updateError = fallback.error;
    }

    if (updateError) {
      this.logger.error(`No se pudo actualizar estado en BD: ${updateError.message}`);
    }

    const verdictMsg: Record<string, string> = {
      aprobado: 'Documento aprobado automaticamente por IA.',
      rechazado: 'Documento rechazado por IA segun las reglas de negocio.',
      revision_manual: 'El documento requiere revision manual.',
      pendiente: 'Documento pendiente - se activara en la fecha indicada (SOAT-02).',
    };

    return { success: true, message: verdictMsg[newStatus] ?? 'Analisis completado.', analysis };
  }

  async getStats(): Promise<AdminStats> {
    const admin = this.supabaseService.getClient();

    const { data: conductorProfiles } = await admin
      .from('profiles').select('id', { count: 'exact' }).eq('role', 'conductor');

    const { data: allProfiles } = await admin
      .from('profiles').select('*');

    let appealsCount = 0;
    try {
      const { data: appeals } = await admin
        .from('account_appeals').select('id').eq('status', 'pending');
      appealsCount = appeals?.length ?? 0;
    } catch {
      appealsCount = 0;
    }

    const { data: docs, error: docsError } = await admin
      .from('conductor_documents').select('status, rejection_reason');

    if (docsError) {
      throw new ServiceUnavailableException('No se pudieron obtener las estadisticas.');
    }

    const docList = (docs ?? []).map((d) => {
      const isManual = d.status === 'revision_manual' || (d.status === 'pendiente' && d.rejection_reason?.startsWith('[IA]'));
      return { status: isManual ? 'revision_manual' : d.status };
    });

    const totalUsers = allProfiles?.length ?? 0;
    const totalBlocked = (allProfiles ?? []).filter((p: any) => !!p.is_blocked).length;

    return {
      total_conductors: conductorProfiles?.length ?? 0,
      total_users: totalUsers,
      total_blocked: totalBlocked,
      pending_appeals: appealsCount,
      total_documents: docList.length,
      pending_documents: docList.filter((d) => d.status === 'pendiente').length,
      approved_documents: docList.filter((d) => d.status === 'aprobado').length,
      rejected_documents: docList.filter((d) => d.status === 'rechazado').length,
      manual_review_documents: docList.filter((d) => d.status === 'revision_manual').length,
    };
  }

  async getPromotions(): Promise<PromotionRow[]> {
    const { data, error } = await this.supabaseService.getClient().from('promotions')
      .select('id,title,description,code,discount_type,discount_value,starts_at,ends_at,is_active,created_at')
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error(`Error al obtener promociones: ${error.message}`);
      throw new ServiceUnavailableException('No se pudieron obtener las promociones.');
    }
    return (data ?? []) as PromotionRow[];
  }

  async createPromotion(dto: CreatePromotionDto, adminId: string): Promise<PromotionRow> {
    this.validatePromotionDates(dto);
    const { data, error } = await this.supabaseService.getClient().from('promotions')
      .insert(this.promotionPayload(dto, adminId))
      .select('id,title,description,code,discount_type,discount_value,starts_at,ends_at,is_active,created_at')
      .single();
    if (error) {
      this.logger.error(`Error al crear promoción: ${error.message}`);
      if (error.code === '23505') throw new ConflictException('Ya existe una promoción con ese código.');
      throw new ServiceUnavailableException('No se pudo crear la promoción.');
    }
    return data as PromotionRow;
  }

  async updatePromotion(id: string, dto: CreatePromotionDto): Promise<PromotionRow> {
    this.validatePromotionDates(dto);
    const { data, error } = await this.supabaseService.getClient().from('promotions')
      .update(this.promotionPayload(dto))
      .eq('id', id)
      .select('id,title,description,code,discount_type,discount_value,starts_at,ends_at,is_active,created_at')
      .maybeSingle();
    if (error) {
      this.logger.error(`Error al actualizar promoción ${id}: ${error.message}`);
      if (error.code === '23505') throw new ConflictException('Ya existe una promoción con ese código.');
      throw new ServiceUnavailableException('No se pudo actualizar la promoción.');
    }
    if (!data) throw new NotFoundException('Promoción no encontrada.');
    return data as PromotionRow;
  }

  async deletePromotion(id: string): Promise<{ success: boolean; message: string }> {
    const { data, error } = await this.supabaseService.getClient().from('promotions')
      .delete().eq('id', id).select('id').maybeSingle();
    if (error) {
      this.logger.error(`Error al eliminar promoción ${id}: ${error.message}`);
      throw new ServiceUnavailableException('No se pudo eliminar la promoción.');
    }
    if (!data) throw new NotFoundException('Promoción no encontrada.');
    return { success: true, message: 'Promoción eliminada.' };
  }

  private validatePromotionDates(dto: CreatePromotionDto): void {
    if (new Date(dto.endsAt).getTime() <= new Date(dto.startsAt).getTime()) {
      throw new BadRequestException('La fecha de fin debe ser posterior a la fecha de inicio.');
    }
    if (dto.discountType === 'percentage' && dto.discountValue > 100) {
      throw new BadRequestException('El descuento porcentual no puede superar el 100%.');
    }
  }

  private promotionPayload(dto: CreatePromotionDto, adminId?: string) {
    return {
      title: dto.title,
      description: dto.description,
      code: dto.code || null,
      discount_type: dto.discountType,
      discount_value: dto.discountValue,
      starts_at: dto.startsAt,
      ends_at: dto.endsAt,
      is_active: dto.isActive ?? true,
      ...(adminId ? { created_by: adminId } : {}),
    };
  }

  /**
   * Obtiene todos los usuarios registrados con su calificación promedio y estado de bloqueo
   */
  async getUsers(search?: string, role?: string): Promise<RegisteredUser[]> {
    const client = this.supabaseService.getClient();

    // 1. Obtener emails de auth.users
    const userEmailMap = new Map<string, string>();
    try {
      const { data: authData } = await client.auth.admin.listUsers();
      if (authData?.users) {
        for (const u of authData.users) {
          if (u.email) userEmailMap.set(u.id, u.email);
        }
      }
    } catch (e) {
      this.logger.warn(`No se pudieron listar emails de auth.admin: ${e}`);
    }

    // 2. Consultar perfiles de public.profiles
    let query = client
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (role && role !== 'all') {
      query = query.eq('role', role);
    }

    const { data: users, error } = await query;
    if (error) {
      this.logger.error(`Error al consultar usuarios: ${error.message}`);
      throw new ServiceUnavailableException('No se pudo consultar el listado de usuarios.');
    }

    const enrichedUsers: RegisteredUser[] = await Promise.all(
      (users || []).map(async (u: any) => {
        const email = userEmailMap.get(u.id) || u.email || '';
        let rating_average: number | null = null;
        let rating_count = 0;
        try {
          const { data: summary } = await client.rpc('get_profile_rating_summary', { p_profile: u.id });
          if (summary) {
            rating_average = summary.average !== null && summary.average !== undefined ? Number(summary.average) : null;
            rating_count = Number(summary.count || 0);
          }
        } catch {
          // ignore rating fetch errors
        }

        let is_blocked = !!u.is_blocked;
        let block_reason = u.block_reason || null;
        let blocked_at = u.blocked_at || null;

        // Auto-bloquear si es conductor y su promedio es menor a 3.0
        if (!is_blocked && u.role === 'conductor' && rating_average !== null && rating_average < 3.0 && rating_count > 0) {
          is_blocked = true;
          block_reason = `Promedio de calificaciones inferior a 3.0 (${rating_average} estrellas)`;
          blocked_at = new Date().toISOString();
          try {
            await client.from('profiles').update({
              is_blocked: true,
              block_reason,
              blocked_at,
            }).eq('id', u.id);
          } catch {
            // ignore if columns are not yet created in Supabase
          }
        }

        return {
          id: u.id,
          first_name: u.first_name || '',
          last_name: u.last_name || '',
          email,
          role: u.role,
          phone: u.phone || '',
          is_active: !!u.is_active,
          is_blocked,
          block_reason,
          blocked_at,
          created_at: u.created_at || new Date().toISOString(),
          rating_average,
          rating_count,
        };
      })
    );

    // 3. Filtrar en memoria por búsqueda para incluir nombre, apellido, correo o teléfono
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      return enrichedUsers.filter(u =>
        u.first_name.toLowerCase().includes(q) ||
        u.last_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.phone.toLowerCase().includes(q)
      );
    }

    return enrichedUsers;
  }

  /**
   * Bloquea manualmente la cuenta de un usuario
   */
  async blockUser(userId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const client = this.supabaseService.getClient();
    const finalReason = reason?.trim() || 'Bloqueado por el administrador';
    const { error } = await client
      .from('profiles')
      .update({
        is_blocked: true,
        block_reason: finalReason,
        blocked_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      this.logger.error(`Error al bloquear usuario ${userId}: ${error.message}`);
      throw new ServiceUnavailableException('No se pudo bloquear la cuenta del usuario.');
    }
    try {
      await this.changeNotification.notifyAccountStatus(userId, 'blocked', finalReason);
    } catch (notificationError: unknown) {
      this.logger.error(
        `No se pudo notificar el bloqueo del usuario ${userId}: ${
          notificationError instanceof Error ? notificationError.message : String(notificationError)
        }`,
      );
    }
    return { success: true, message: 'La cuenta ha sido bloqueada correctamente.' };
  }

  /**
   * Desbloquea la cuenta de un usuario
   */
  async unblockUser(userId: string): Promise<{ success: boolean; message: string }> {
    const client = this.supabaseService.getClient();
    const { error } = await client
      .from('profiles')
      .update({
        is_blocked: false,
        block_reason: null,
        blocked_at: null,
      })
      .eq('id', userId);

    if (error) {
      this.logger.error(`Error al desbloquear usuario ${userId}: ${error.message}`);
      throw new ServiceUnavailableException('No se pudo desbloquear la cuenta del usuario.');
    }
    try {
      await this.changeNotification.notifyAccountStatus(userId, 'unblocked');
    } catch (notificationError: unknown) {
      this.logger.error(
        `No se pudo notificar el desbloqueo del usuario ${userId}: ${
          notificationError instanceof Error ? notificationError.message : String(notificationError)
        }`,
      );
    }
    return { success: true, message: 'La cuenta ha sido desbloqueada correctamente.' };
  }

  /**
   * Obtiene la lista de solicitudes de apelación / desbloqueo
   */
  async getAppeals(): Promise<any[]> {
    const client = this.supabaseService.getClient();
    let { data, error } = await client
      .from('account_appeals')
      .select('id, user_id, email, message, status, admin_note, created_at, reviewed_at, reviewed_by, profiles(first_name, last_name, role)')
      .order('created_at', { ascending: false });

    if (error) {
      // Fallback sin embedding por si la FK aún no refrescó en el schema cache de PostgREST
      const simple = await client
        .from('account_appeals')
        .select('id, user_id, email, message, status, admin_note, created_at, reviewed_at, reviewed_by')
        .order('created_at', { ascending: false });

      if (simple.error) {
        this.logger.warn(`No se pudieron consultar apelaciones: ${simple.error.message}`);
        return [];
      }
      data = simple.data as any;
    }

    if (!data || data.length === 0) return [];

    // Enriquecer con perfiles si no vinieron
    const userIds = [...new Set(data.map((a: any) => a.user_id).filter(Boolean))];
    if (userIds.length > 0) {
      const { data: profiles } = await client
        .from('profiles')
        .select('id, first_name, last_name, role')
        .in('id', userIds);
      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
      return data.map((a: any) => ({
        ...a,
        profiles: a.profiles || profileMap.get(a.user_id) || undefined,
      }));
    }

    return data;
  }

  /**
   * Resuelve una apelación (aprobar o rechazar)
   */
  async resolveAppeal(
    appealId: string,
    action: 'approve' | 'reject',
    adminNote?: string,
    adminId?: string,
  ): Promise<{ success: boolean; message: string }> {
    const client = this.supabaseService.getClient();
    const { data: appeal, error: fetchErr } = await client
      .from('account_appeals')
      .select('id, user_id, status')
      .eq('id', appealId)
      .maybeSingle();

    if (fetchErr || !appeal) {
      throw new NotFoundException('Solicitud de apelación no encontrada.');
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const { error: updateErr } = await client
      .from('account_appeals')
      .update({
        status: newStatus,
        admin_note: adminNote || null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminId || null,
      })
      .eq('id', appealId);

    if (updateErr) {
      throw new ServiceUnavailableException('No se pudo actualizar la solicitud de apelación.');
    }

    if (action === 'approve') {
      await this.unblockUser(appeal.user_id);
    }

    return {
      success: true,
      message: action === 'approve'
        ? 'Solicitud aprobada y cuenta desbloqueada exitosamente.'
        : 'Solicitud rechazada.',
    };
  }
}
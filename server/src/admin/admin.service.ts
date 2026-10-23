import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { GeminiService } from '../ai/gemini.service.js';
import type { AiAnalysisResult } from '../ai/gemini.service.js';
import { ChangeNotificationService } from '../notifications/change-notification.service.js';

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
  pending_documents: number;
  approved_documents: number;
  rejected_documents: number;
  manual_review_documents: number;
  total_documents: number;
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

    const { data: profiles, error: profilesError } = await admin
      .from('profiles').select('id', { count: 'exact' }).eq('role', 'conductor');

    const { data: docs, error: docsError } = await admin
      .from('conductor_documents').select('status, rejection_reason');

    if (profilesError || docsError) {
      throw new ServiceUnavailableException('No se pudieron obtener las estadisticas.');
    }

    const docList = (docs ?? []).map((d) => {
      const isManual = d.status === 'revision_manual' || (d.status === 'pendiente' && d.rejection_reason?.startsWith('[IA]'));
      return { status: isManual ? 'revision_manual' : d.status };
    });

    return {
      total_conductors: profiles?.length ?? 0,
      total_documents: docList.length,
      pending_documents: docList.filter((d) => d.status === 'pendiente').length,
      approved_documents: docList.filter((d) => d.status === 'aprobado').length,
      rejected_documents: docList.filter((d) => d.status === 'rechazado').length,
      manual_review_documents: docList.filter((d) => d.status === 'revision_manual').length,
    };
  }
}
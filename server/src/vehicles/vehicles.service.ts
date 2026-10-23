import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { throwDatabaseError } from '../common/database-error.js';
import { GeminiService } from '../ai/gemini.service.js';
import { ChangeNotificationService } from '../notifications/change-notification.service.js';
import type { SaveVehicleDto, UploadDocumentDto } from './vehicles.controller.js';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    @Inject(SupabaseService) private readonly supabase: SupabaseService,
    private readonly geminiService: GeminiService,
    private readonly changeNotification: ChangeNotificationService,
  ) {}

  async findMine(actorId: string) {
    const { data, error } = await this.supabase.getClient().from('vehicles')
      .select('id,brand,model,color,plate,capacity').eq('user_id', actorId).maybeSingle();
    if (error) throwDatabaseError(error);
    return data;
  }

  async save(actorId: string, dto: SaveVehicleDto) {
    const { data, error } = await this.supabase.getClient().rpc('save_vehicle', {
      p_actor: actorId, p_brand: dto.brand, p_model: dto.model, p_color: dto.color, p_plate: dto.plate, p_capacity: dto.capacity,
    });
    if (error) throwDatabaseError(error);
    return data;
  }

  async findDocuments(actorId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('conductor_documents')
      .select('*')
      .eq('conductor_id', actorId)
      .order('submitted_at', { ascending: false });
    if (error) throwDatabaseError(error);
    return data ?? [];
  }

  async uploadDocument(actorId: string, dto: UploadDocumentDto) {
    const admin = this.supabase.getClient();
    let fileUrl = dto.fileData;

    // Si es un data URL base64, subir a Supabase Storage
    const base64Match = /^data:(.+?);base64,(.+)$/.exec(dto.fileData);
    if (base64Match) {
      const mimeType = base64Match[1];
      const buffer = Buffer.from(base64Match[2], 'base64');
      const ext = dto.fileName.split('.').pop() || 'bin';
      const cleanFileName = `${dto.documentType}-${Date.now()}.${ext}`;
      const filePath = `${actorId}/${cleanFileName}`;

      try {
        const { data: buckets } = await admin.storage.listBuckets();
        if (!buckets?.some((b) => b.name === 'conductor-documents')) {
          await admin.storage.createBucket('conductor-documents', { public: true });
        }

        const { error: uploadError } = await admin.storage
          .from('conductor-documents')
          .upload(filePath, buffer, { contentType: mimeType, upsert: true });

        if (!uploadError) {
          const { data: publicUrlData } = admin.storage
            .from('conductor-documents')
            .getPublicUrl(filePath);
          if (publicUrlData?.publicUrl) {
            fileUrl = publicUrlData.publicUrl;
          }
        }
      } catch (storageErr: any) {
        this.logger.warn(`Storage upload fallo, usando data URL en fallback: ${storageErr?.message}`);
      }
    }

    // Verificar si ya existe un documento de este tipo
    const { data: existing } = await admin
      .from('conductor_documents')
      .select('id')
      .eq('conductor_id', actorId)
      .eq('document_type', dto.documentType)
      .maybeSingle();

    let savedDocument: any;

    if (existing) {
      const { data, error } = await admin
        .from('conductor_documents')
        .update({
          file_url: fileUrl,
          file_name: dto.fileName,
          status: 'pendiente',
          rejection_reason: null,
          submitted_at: new Date().toISOString(),
          reviewed_at: null,
          reviewed_by: null,
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throwDatabaseError(error);
      savedDocument = data;
    } else {
      const { data, error } = await admin
        .from('conductor_documents')
        .insert({
          conductor_id: actorId,
          document_type: dto.documentType,
          file_url: fileUrl,
          file_name: dto.fileName,
          status: 'pendiente',
        })
        .select()
        .single();
      if (error) throwDatabaseError(error);
      savedDocument = data;
    }

    // Disparar analisis IA de forma asincrona (fire-and-forget)
    // No bloquea la respuesta al conductor
    this.triggerAiAnalysis(actorId, savedDocument).catch((err) => {
      this.logger.warn(`Error en analisis IA para doc ${savedDocument?.id}: ${err?.message}`);
    });

    return {
      success: true,
      message: existing
        ? 'Documento actualizado. Analisis IA en proceso...'
        : 'Documento subido. Analisis IA en proceso...',
      document: savedDocument,
    };
  }

  /**
   * Dispara el analisis de IA en segundo plano.
   * Obtiene la cedula y la placa del conductor para pasarlas como contexto.
   */
  private async triggerAiAnalysis(actorId: string, document: any): Promise<void> {
    if (!document?.id || !document?.file_url || !document?.document_type) return;

    const admin = this.supabase.getClient();

    // Obtener cedula del conductor
    const { data: profile } = await admin
      .from('profiles')
      .select('national_id')
      .eq('id', actorId)
      .maybeSingle();

    // Obtener placa, marca y modelo del vehiculo
    const { data: vehicle } = await admin
      .from('vehicles')
      .select('plate, brand, model')
      .eq('user_id', actorId)
      .maybeSingle();

    this.logger.log(
      `[AI] Iniciando analisis para doc ${document.id} (${document.document_type}) — cedula: ${profile?.national_id ?? 'N/A'} placa: ${vehicle?.plate ?? 'N/A'} marca: ${vehicle?.brand ?? 'N/A'} modelo: ${vehicle?.model ?? 'N/A'}`
    );

    const analysis = await this.geminiService.analyzeDocument({
      documentType: document.document_type,
      fileUrl: document.file_url,
      conductorNationalId: profile?.national_id,
      vehiclePlate: vehicle?.plate,
      vehicleBrand: vehicle?.brand,
      vehicleModel: vehicle?.model,
    });

    // Mapear el veredicto al estado final del documento
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
      reviewed_by: null,
      rejection_reason: rejectionReason,
    };

    let { error: updateError } = await admin
      .from('conductor_documents')
      .update(updatePayload)
      .eq('id', document.id);

    if (updateError && newStatus === 'revision_manual') {
      const fallback = await admin
        .from('conductor_documents')
        .update({
          ...updatePayload,
          status: 'pendiente',
        })
        .eq('id', document.id);
      updateError = fallback.error;
    }

    if (updateError) {
      this.logger.error(`Error al actualizar estado del documento ${document.id}: ${updateError.message}`);
    } else {
      this.logger.log(`[AI] Doc ${document.id} actualizado automáticamente a "${newStatus}" — ${analysis.reason.substring(0, 80)}`);
      // Notificar al conductor por push y correo
      await this.notifyDocumentReviewed(actorId, document, newStatus, rejectionReason).catch((err) => {
        this.logger.warn(`No se pudo enviar notificación de documento al conductor ${actorId}: ${err?.message}`);
      });
    }
  }

  /**
   * Envía notificación push + correo al conductor con el resultado del análisis de su documento.
   */
  private async notifyDocumentReviewed(
    conductorId: string,
    document: any,
    status: 'aprobado' | 'rechazado' | 'revision_manual' | 'pendiente',
    rejectionReason: string | null,
  ): Promise<void> {
    const docTypeLabels: Record<string, string> = {
      cedula: 'Cédula de ciudadanía',
      licencia: 'Licencia de conducción',
      soat: 'SOAT',
      tecnomecanica: 'Tecnomecánica',
      tarjeta_propiedad: 'Tarjeta de propiedad',
    };
    const docLabel = docTypeLabels[document.document_type] ?? document.document_type;

    let title: string;
    let message: string;

    switch (status) {
      case 'aprobado':
        title = `✅ Documento aprobado: ${docLabel}`;
        message = `Tu documento "${docLabel}" fue revisado y aprobado exitosamente. ¡Ya puedes publicar rutas!`;
        break;
      case 'rechazado':
        title = `❌ Documento rechazado: ${docLabel}`;
        message = `Tu documento "${docLabel}" fue rechazado.${ rejectionReason ? ` Motivo: ${rejectionReason}` : '' } Por favor vuelve a subirlo corrigiendo el problema.`;
        break;
      case 'revision_manual':
        title = `🔍 Documento en revisión: ${docLabel}`;
        message = `Tu documento "${docLabel}" requiere revisión manual por nuestro equipo. Te notificaremos cuando sea procesado.`;
        break;
      default:
        title = `📋 Documento recibido: ${docLabel}`;
        message = `Recibimos tu documento "${docLabel}". Te notificaremos cuando sea revisado.`;
    }

    // Reutiliza el canal unificado (interna + push + email)
    await this.changeNotification.sendToUser(conductorId, {
      type: `document_${status}`,
      title,
      message,
      link: `${this.changeNotification.frontendUrl}/index.html?section=documents`,
      metadata: {
        documentId: document.id,
        documentType: document.document_type,
        status,
      },
    });
  }

  async deleteDocument(actorId: string, documentId: string) {
    const admin = this.supabase.getClient();
    const { error } = await admin
      .from('conductor_documents')
      .delete()
      .eq('id', documentId)
      .eq('conductor_id', actorId);
    if (error) throwDatabaseError(error);
    return { success: true, message: 'Documento eliminado.' };
  }

  async requestManualReview(actorId: string, documentId: string) {
    const admin = this.supabase.getClient();
    const { data: doc, error: fetchError } = await admin
      .from('conductor_documents')
      .select('id,conductor_id,document_type,status,rejection_reason')
      .eq('id', documentId)
      .eq('conductor_id', actorId)
      .maybeSingle();

    if (fetchError || !doc) {
      throw new NotFoundException('Documento no encontrado o no pertenece a tu cuenta.');
    }

    if (doc.status === 'aprobado') {
      throw new BadRequestException('El documento ya está aprobado.');
    }

    if (doc.status === 'revision_manual') {
      return { success: true, message: 'El documento ya se encuentra en revisión manual.' };
    }

    const note = '[Conductor] Solicitó revisión manual tras validación';
    let { error } = await admin
      .from('conductor_documents')
      .update({
        status: 'revision_manual',
        rejection_reason: note,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    if (error) {
      // Fallback si Postgres enum document_status no tiene 'revision_manual'
      const fallback = await admin
        .from('conductor_documents')
        .update({
          status: 'pendiente',
          rejection_reason: note,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', documentId);
      error = fallback.error;
    }

    if (error) {
      this.logger.error(`Error al solicitar revisión manual para doc ${documentId}: ${error.message}`);
      throwDatabaseError(error);
    }

    // Notificar al conductor por push y email
    void this.notifyDocumentReviewed(
      actorId,
      { id: documentId, document_type: doc.document_type },
      'revision_manual',
      null,
    );

    return {
      success: true,
      message: 'Solicitud de revisión manual enviada al equipo de administración.',
    };
  }
}

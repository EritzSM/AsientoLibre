import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { throwDatabaseError } from '../common/database-error.js';
import type { SaveVehicleDto, UploadDocumentDto } from './vehicles.controller.js';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(@Inject(SupabaseService) private readonly supabase: SupabaseService) {}

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

    // Si es un data URL base64, intentar subirlo a Supabase Storage
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
          .upload(filePath, buffer, {
            contentType: mimeType,
            upsert: true,
          });

        if (!uploadError) {
          const { data: publicUrlData } = admin.storage
            .from('conductor-documents')
            .getPublicUrl(filePath);
          if (publicUrlData?.publicUrl) {
            fileUrl = publicUrlData.publicUrl;
          }
        }
      } catch (storageErr: any) {
        this.logger.warn(`Storage upload falló, usando data URL en fallback: ${storageErr?.message}`);
      }
    }

    // Verificar si ya existe un documento de este tipo para este conductor
    const { data: existing } = await admin
      .from('conductor_documents')
      .select('id')
      .eq('conductor_id', actorId)
      .eq('document_type', dto.documentType)
      .maybeSingle();

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
      return { success: true, message: 'Documento actualizado exitosamente.', document: data };
    }

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
    return { success: true, message: 'Documento subido exitosamente.', document: data };
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
}

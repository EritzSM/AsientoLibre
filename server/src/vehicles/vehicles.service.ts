import { Inject, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';
import { throwDatabaseError } from '../common/database-error.js';
import type { SaveVehicleDto } from './vehicles.controller.js';

@Injectable()
export class VehiclesService {
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
}

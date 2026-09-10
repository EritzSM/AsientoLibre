import { Body, Controller, Get, Inject, Put, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { SupabaseAuthGuard } from '../common/supabase-auth.guard.js';
import type { AuthenticatedRequest } from '../common/supabase-auth.guard.js';
import { VehiclesService } from './vehicles.service.js';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class SaveVehicleDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(60)
  brand: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(60)
  model: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(40)
  color: string;
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString() @Matches(/^[A-Z]{3}[0-9]{3}$/, { message: 'La placa debe tener tres letras y tres números (ABC123).' })
  plate: string;
  @IsInt() @Min(1) @Max(8)
  capacity: number;
}

@Controller('vehicles') @UseGuards(SupabaseAuthGuard)
export class VehiclesController {
  constructor(@Inject(VehiclesService) private readonly vehicles: VehiclesService) {}

  @Get('me')
  mine(@Req() req: AuthenticatedRequest) { return this.vehicles.findMine(req.actorId); }

  @Put('me')
  save(@Req() req: AuthenticatedRequest, @Body(new ValidationPipe({ expectedType: SaveVehicleDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) dto: SaveVehicleDto) {
    return this.vehicles.save(req.actorId, dto);
  }
}

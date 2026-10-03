import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
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

export class UploadDocumentDto {
  @IsIn(['licencia', 'soat', 'cedula', 'foto_vehiculo'])
  documentType: 'licencia' | 'soat' | 'cedula' | 'foto_vehiculo';

  @IsString()
  @IsNotEmpty()
  fileData: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;
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

  @Get('documents')
  documents(@Req() req: AuthenticatedRequest) {
    return this.vehicles.findDocuments(req.actorId);
  }

  @Post('documents')
  @HttpCode(HttpStatus.OK)
  uploadDoc(
    @Req() req: AuthenticatedRequest,
    @Body(new ValidationPipe({ expectedType: UploadDocumentDto, transform: true, whitelist: true })) dto: UploadDocumentDto,
  ) {
    return this.vehicles.uploadDocument(req.actorId, dto);
  }

  @Delete('documents/:id')
  deleteDoc(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.vehicles.deleteDocument(req.actorId, id);
  }
}

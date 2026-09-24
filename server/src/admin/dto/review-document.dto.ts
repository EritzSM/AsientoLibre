import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class FilterDocumentsDto {
  @IsOptional()
  @IsIn(['pendiente', 'aprobado', 'rechazado', 'all'])
  status?: 'pendiente' | 'aprobado' | 'rechazado' | 'all';
}

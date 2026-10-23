import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const normalizeCode = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreatePromotionDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  title: string;

  @Transform(trim) @IsString() @MinLength(2) @MaxLength(500)
  description: string;

  @IsOptional() @Transform(normalizeCode) @IsString() @MaxLength(40)
  code?: string;

  @IsIn(['percentage', 'fixed'])
  discountType: 'percentage' | 'fixed';

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1000000)
  discountValue: number;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

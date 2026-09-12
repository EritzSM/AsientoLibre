import { Transform } from 'class-transformer';
import { Equals, IsDateString, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreateRouteDto {
  @Transform(trim) @IsString() @MinLength(2, { message: 'Ingresa el origen (mínimo 2 caracteres).' }) @MaxLength(160)
  origin: string;

  @Transform(trim) @IsString() @MinLength(2, { message: 'Ingresa el destino (mínimo 2 caracteres).' }) @MaxLength(160)
  destination: string;

  @IsDateString({ strict: true }, { message: 'La fecha debe ser válida.' }) @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Usa el formato AAAA-MM-DD para la fecha.' })
  date: string;

  @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Ingresa una hora válida en formato HH:mm.' })
  time: string;

  @IsInt({ message: 'Los cupos deben ser un número entero.' }) @Min(1, { message: 'Ofrece al menos un cupo.' }) @Max(8, { message: 'El máximo admitido es de 8 cupos para pasajeros.' })
  seats: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000)
  price?: number;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  note?: string;
}

export class FindRoutesDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160)
  origin?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(160)
  destination?: string;

  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

export class CancelRouteDto {
  @Equals(true, { message: 'Debes confirmar explícitamente la cancelación.' })
  confirmed: true;
}

export class CreateBookingDto {
  @IsInt() @Min(1) @Max(8)
  seats: number;
}

export class RateRouteDto {
  @IsUUID()
  ratedId: string;

  @IsInt() @Min(1) @Max(5)
  score: number;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  comment?: string;
}

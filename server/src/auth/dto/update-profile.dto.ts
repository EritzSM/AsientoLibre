import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString({ message: 'El nombre debe ser una cadena' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MinLength(2)
  @MaxLength(80)
  firstName: string;

  @IsString({ message: 'El apellido debe ser una cadena' })
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  @MinLength(2)
  @MaxLength(80)
  lastName: string;

  @IsString({ message: 'La identificación debe ser una cadena' })
  @IsNotEmpty({ message: 'La identificación es obligatoria' })
  @MaxLength(40)
  nationalId: string;

  @IsString({ message: 'El teléfono debe ser una cadena' })
  @Matches(/^$|^\d{7,15}$/, {
    message: 'El teléfono debe contener únicamente entre 7 y 15 dígitos',
  })
  phone: string;

  @IsOptional()
  @IsIn(['pasajero', 'conductor'], {
    message: 'El rol debe ser pasajero o conductor',
  })
  role?: 'pasajero' | 'conductor';
}

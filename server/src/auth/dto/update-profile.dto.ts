import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';

export class UpdateProfileDto {
  @IsString({ message: 'El ID de usuario debe ser una cadena válida' })
  @IsNotEmpty({ message: 'El ID de usuario es obligatorio' })
  userId: string;

  @IsString({ message: 'El nombre debe ser una cadena' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  firstName: string;

  @IsString({ message: 'El apellido debe ser una cadena' })
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  lastName: string;

  @IsString({ message: 'La identificación debe ser una cadena' })
  @IsOptional()
  nationalId?: string;

  @IsIn(['pasajero', 'conductor'], { message: 'El rol debe ser pasajero o conductor' })
  role: 'pasajero' | 'conductor';

  @IsOptional()
  vehicle?: {
    brand: string;
    model: string;
    color: string;
    plate: string;
  };
}

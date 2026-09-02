import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VehicleDto {
  @IsString({ message: 'La marca del vehículo es requerida' })
  @IsNotEmpty({ message: 'La marca del vehículo no puede estar vacía' })
  brand: string;

  @IsString({ message: 'El modelo del vehículo es requerido' })
  @IsNotEmpty({ message: 'El modelo del vehículo no puede estar vacío' })
  model: string;

  @IsString({ message: 'El color del vehículo es requerido' })
  @IsNotEmpty({ message: 'El color del vehículo no puede estar vacío' })
  color: string;

  @IsString({ message: 'La placa del vehículo es requerida' })
  @IsNotEmpty({ message: 'La placa del vehículo no puede estar vacía' })
  plate: string;
}

export enum UserRole {
  PASAJERO = 'pasajero',
  CONDUCTOR = 'conductor',
}

export class RegisterDto {
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  firstName: string;

  @IsString({ message: 'El apellido debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  @MinLength(2, { message: 'El apellido debe tener al menos 2 caracteres' })
  lastName: string;

  @IsString({ message: 'El documento de identidad debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El documento de identidad es obligatorio' })
  nationalId: string;

  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  email: string;

  @IsString({ message: 'La contraseña debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password: string;

  @IsEnum(UserRole, { message: 'El rol debe ser pasajero o conductor' })
  role: UserRole;

  @IsOptional()
  @IsBoolean({ message: 'skipVehicle debe ser un valor booleano' })
  skipVehicle?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => VehicleDto)
  vehicle?: VehicleDto;
}


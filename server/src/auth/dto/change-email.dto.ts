import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangeUnverifiedEmailDto {
  @IsEmail({}, { message: 'El correo actual no tiene un formato válido' })
  @IsNotEmpty({ message: 'El correo actual es obligatorio' })
  currentEmail: string;

  @IsEmail({}, { message: 'El nuevo correo no tiene un formato válido' })
  @IsNotEmpty({ message: 'El nuevo correo es obligatorio' })
  newEmail: string;

  @IsString({ message: 'La contraseña debe ser una cadena de texto' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password: string;
}

import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString({ message: 'La contraseña actual debe ser una cadena' })
  @IsNotEmpty({ message: 'La contraseña actual es obligatoria' })
  @MinLength(6, { message: 'La contraseña actual no es válida' })
  currentPassword: string;

  @IsString({ message: 'La nueva contraseña debe ser una cadena' })
  @MinLength(8, { message: 'La nueva contraseña debe tener al menos 8 caracteres' })
  @MaxLength(72, { message: 'La nueva contraseña no puede superar 72 caracteres' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'La nueva contraseña debe incluir mayúscula, minúscula y número',
  })
  newPassword: string;
}

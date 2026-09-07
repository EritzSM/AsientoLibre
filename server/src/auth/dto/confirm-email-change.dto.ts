import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class ConfirmEmailChangeDto {
  @IsEmail({}, { message: 'El correo electrónico actual no es válido' })
  @IsNotEmpty({ message: 'El correo electrónico actual es obligatorio' })
  currentEmail: string;

  @IsString({ message: 'El código de verificación debe ser una cadena' })
  @IsNotEmpty({ message: 'El código de verificación es obligatorio' })
  @Length(6, 6, { message: 'El código de verificación debe tener exactamente 6 dígitos' })
  code: string;
}

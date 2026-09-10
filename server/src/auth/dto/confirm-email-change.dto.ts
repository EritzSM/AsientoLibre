import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class ConfirmEmailChangeDto {
  @IsString({ message: 'El código de verificación debe ser una cadena' })
  @IsNotEmpty({ message: 'El código de verificación es obligatorio' })
  @Length(6, 6, { message: 'El código de verificación debe tener exactamente 6 dígitos' })
  @Matches(/^\d{6}$/, { message: 'El código debe contener seis números' })
  code: string;
}

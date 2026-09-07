import { IsEmail, IsNotEmpty } from 'class-validator';

export class ChangeUnverifiedEmailDto {
  @IsEmail({}, { message: 'El correo actual no tiene un formato válido' })
  @IsNotEmpty({ message: 'El correo actual es obligatorio' })
  currentEmail: string;

  @IsEmail({}, { message: 'El nuevo correo no tiene un formato válido' })
  @IsNotEmpty({ message: 'El nuevo correo es obligatorio' })
  newEmail: string;
}

import { IsEmail, IsNotEmpty } from 'class-validator';

export class RequestEmailChangeDto {
  @IsEmail({}, { message: 'El correo electrónico actual no es válido' })
  @IsNotEmpty({ message: 'El correo electrónico actual es obligatorio' })
  currentEmail: string;

  @IsEmail({}, { message: 'El nuevo correo electrónico no es válido' })
  @IsNotEmpty({ message: 'El nuevo correo electrónico es obligatorio' })
  newEmail: string;
}

import { IsEmail, IsNotEmpty } from 'class-validator';

export class RequestEmailChangeDto {
  @IsEmail({}, { message: 'El nuevo correo electrónico no es válido' })
  @IsNotEmpty({ message: 'El nuevo correo electrónico es obligatorio' })
  newEmail: string;
}

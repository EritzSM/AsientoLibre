import { IsEmail, IsNotEmpty } from 'class-validator';

export class CancelEmailChangeDto {
  @IsEmail({}, { message: 'El correo electrónico actual no es válido' })
  @IsNotEmpty({ message: 'El correo electrónico actual es obligatorio' })
  currentEmail: string;
}

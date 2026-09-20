import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class DeleteAccountDto {
  @IsString({ message: 'La contraseña debe ser una cadena' })
  @IsNotEmpty({ message: 'La contraseña es obligatoria para eliminar la cuenta' })
  @MinLength(6, { message: 'La contraseña no es válida' })
  password: string;
}

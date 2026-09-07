import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
  @IsString({ message: 'El token de activación debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El token de activación es obligatorio' })
  token: string;
}

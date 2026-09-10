import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString({ message: 'El nombre debe ser una cadena' })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MinLength(2)
  @MaxLength(80)
  firstName: string;

  @IsString({ message: 'El apellido debe ser una cadena' })
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  @MinLength(2)
  @MaxLength(80)
  lastName: string;

  @IsString({ message: 'La identificación debe ser una cadena' })
  @IsNotEmpty({ message: 'La identificación es obligatoria' })
  @MaxLength(40)
  nationalId: string;
}

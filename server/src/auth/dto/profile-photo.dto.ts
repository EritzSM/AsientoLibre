import { IsString, MaxLength } from 'class-validator';

export class ProfilePhotoDto {
  @IsString()
  @MaxLength(7 * 1024 * 1024)
  photoData: string;
}

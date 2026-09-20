import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class SavePushTokenDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  token: string;

  @IsIn(['web', 'android', 'ios'])
  platform: 'web' | 'android' | 'ios';
}

export class RemovePushTokenDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  token: string;
}

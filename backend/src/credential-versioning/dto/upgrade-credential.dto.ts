import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsPositive,
  Matches,
} from 'class-validator';

export class UpgradeCredentialDto {
  /**
   * Target schema version to upgrade the credential to (semver string, e.g. "2.0.0").
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+\.\d+\.\d+$/, {
    message: 'targetSchemaVersion must be a valid semver string (e.g. "2.0.0")',
  })
  targetSchemaVersion: string;

  /**
   * Optional: the version number the caller believes is current.
   * If supplied and it does not match the credential's actual current version
   * the operation will be recorded as a CONFLICT and return 409.
   */
  @IsInt()
  @IsPositive()
  @IsOptional()
  expectedVersion?: number;

  /**
   * Human-readable reason for the upgrade (stored in both the migration record
   * and the resulting credential version snapshot).
   */
  @IsString()
  @IsOptional()
  reason?: string;
}

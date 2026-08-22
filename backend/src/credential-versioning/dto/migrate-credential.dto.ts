import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
} from 'class-validator';

export class MigrateCredentialDto {
  /**
   * The schema version the credential currently has (used for validation).
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+\.\d+\.\d+$/, {
    message: 'fromSchemaVersion must be a valid semver string (e.g. "1.0.0")',
  })
  fromSchemaVersion: string;

  /**
   * The target schema version to migrate to.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+\.\d+\.\d+$/, {
    message: 'toSchemaVersion must be a valid semver string (e.g. "2.0.0")',
  })
  toSchemaVersion: string;

  /**
   * Optional metadata overrides to apply as part of the migration.
   */
  @IsOptional()
  metadata?: Record<string, any>;

  /** Human-readable reason for the migration. */
  @IsString()
  @IsOptional()
  reason?: string;
}

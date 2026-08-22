import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

/**
 * DTO for requesting secure deletion of a credential.
 */
export class SecureDeletionDto {
  /**
   * Optional reason for the deletion.
   * Will be recorded in the audit trail.
   */
  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * DTO for verifying a deletion.
 */
export class VerifyDeletionDto {
  /**
   * The ID of the credential to verify deletion for.
   */
  @IsString()
  @IsNotEmpty()
  credentialId: string;
}

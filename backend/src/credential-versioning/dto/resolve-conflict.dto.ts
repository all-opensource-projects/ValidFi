import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class ResolveConflictDto {
  /**
   * The strategy chosen by the operator to resolve the conflict.
   * E.g. "accept-current", "force-upgrade", "manual-merge".
   */
  @IsString()
  @IsNotEmpty()
  strategy: string;

  /**
   * Freeform notes documenting how and why the conflict was resolved.
   * Stored in {@link CredentialMigration.resolutionNotes}.
   */
  @IsOptional()
  notes?: Record<string, any>;
}

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner, In } from 'typeorm';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { randomBytes, createHash } from 'crypto';
import { Credential } from './credential.entity';
import { AccessPermission } from '../access-control/access-control.entity';
import { CredentialVersion } from '../credential-versioning/credential-version.entity';
import { CredentialExport } from '../credential-export/credential-export.entity';
import { AuditService } from '../audit/audit.service';
import { AuditOperation, AuditStatus } from '../audit/audit-log.entity';

/**
 * Result of a secure deletion operation.
 */
export interface SecureDeletionResult {
  credentialId: string;
  deleted: boolean;
  verified: boolean;
  relatedDataCleared: {
    accessPermissions: number;
    versions: number;
    exportsUpdated: number;
  };
  cacheCleared: boolean;
  auditRecorded: boolean;
  deletedAt: Date;
  deletionHash: string;
}

/**
 * Verification result for a deleted credential.
 */
export interface DeletionVerificationResult {
  credentialId: string;
  exists: boolean;
  existsInCache: boolean;
  existsInDatabase: boolean;
  relatedDataExists: boolean;
  verified: boolean;
  details: string[];
}

/**
 * Service that securely deletes credentials and all related data.
 *
 * Implements a multi-step secure deletion process:
 * 1. Validates the credential exists
 * 2. Removes all access permissions referencing the credential
 * 3. Removes all credential versions
 * 4. Updates credential exports to reflect the credential no longer exists
 * 5. Clears all cache entries for the credential
 * 6. Securely overwrites the credential data before deletion
 * 7. Performs a hard delete from the database
 * 8. Verifies deletion is complete
 * 9. Records an immutable audit entry
 */
@Injectable()
export class SecureDeletionService {
  private readonly logger = new Logger(SecureDeletionService.name);

  // Cache key patterns for credentials
  private readonly CACHE_KEY_PATTERN = 'credential:*';
  private readonly CACHE_KEY_PREFIX = 'credential:';

  constructor(
    @InjectRepository(Credential)
    private readonly credentialRepository: Repository<Credential>,
    @InjectRepository(AccessPermission)
    private readonly accessPermissionRepository: Repository<AccessPermission>,
    @InjectRepository(CredentialVersion)
    private readonly versionRepository: Repository<CredentialVersion>,
    @InjectRepository(CredentialExport)
    private readonly exportRepository: Repository<CredentialExport>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * Securely delete a credential and all its related data.
   *
   * @param credentialId - The ID of the credential to delete
   * @param deletedBy - The wallet address of the actor performing the deletion
   * @param reason - Optional reason for the deletion
   * @returns SecureDeletionResult with details of what was deleted
   */
  async secureDelete(
    credentialId: string,
    deletedBy: string,
    reason?: string,
  ): Promise<SecureDeletionResult> {
    this.logger.log(
      `Starting secure deletion for credential ${credentialId} by ${deletedBy}`,
    );

    const result: SecureDeletionResult = {
      credentialId,
      deleted: false,
      verified: false,
      relatedDataCleared: {
        accessPermissions: 0,
        versions: 0,
        exportsUpdated: 0,
      },
      cacheCleared: false,
      auditRecorded: false,
      deletedAt: new Date(),
      deletionHash: '',
    };

    // Generate deletion hash for verification
    result.deletionHash = this.generateDeletionHash(credentialId, deletedBy);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Step 1: Find and validate the credential exists
      const credential = await this.findCredential(
        queryRunner,
        credentialId,
      );

      // Step 2: Remove access permissions referencing this credential
      result.relatedDataCleared.accessPermissions =
        await this.removeAccessPermissions(queryRunner, credentialId);

      // Step 3: Remove credential versions
      result.relatedDataCleared.versions =
        await this.removeCredentialVersions(queryRunner, credentialId);

      // Step 4: Update exports to reflect credential no longer exists
      result.relatedDataCleared.exportsUpdated =
        await this.updateExports(queryRunner, credentialId);

      // Step 5: Clear cache entries
      result.cacheCleared = await this.clearCacheEntries(credentialId);

      // Step 6: Securely overwrite sensitive data before deletion
      await this.secureOverwrite(credential);

      // Step 7: Delete the credential
      await queryRunner.manager.remove(credential);

      // Commit the transaction
      await queryRunner.commitTransaction();

      result.deleted = true;
      this.logger.log(
        `Credential ${credentialId} successfully deleted from database`,
      );

      // Step 8: Verify deletion is complete
      result.verified = await this.verifyDeletion(credentialId);

      // Step 9: Record audit entry
      await this.recordAuditEntry(credentialId, deletedBy, result, reason);
      result.auditRecorded = true;

      this.logger.log(
        `Secure deletion completed for credential ${credentialId}: verified=${result.verified}`,
      );

      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Secure deletion failed for credential ${credentialId}: ${error.message}`,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Verify that a credential has been completely deleted.
   *
   * @param credentialId - The ID of the credential to verify
   * @returns DeletionVerificationResult with verification details
   */
  async verifyDeletionComplete(
    credentialId: string,
  ): Promise<DeletionVerificationResult> {
    const verification: DeletionVerificationResult = {
      credentialId,
      exists: false,
      existsInCache: false,
      existsInDatabase: false,
      relatedDataExists: false,
      verified: false,
      details: [],
    };

    // Check database
    const dbExists = await this.checkDatabaseExists(credentialId);
    verification.existsInDatabase = dbExists;
    if (dbExists) {
      verification.details.push('Credential still exists in database');
    }

    // Check cache
    const cacheExists = await this.checkCacheExists(credentialId);
    verification.existsInCache = cacheExists;
    if (cacheExists) {
      verification.details.push('Credential still exists in cache');
    }

    // Check related data
    const relatedExists = await this.checkRelatedDataExists(credentialId);
    verification.relatedDataExists = relatedExists;
    if (relatedExists) {
      verification.details.push('Related data still exists');
    }

    // Overall verification
    verification.exists = dbExists || cacheExists || relatedExists;
    verification.verified = !verification.exists;

    if (verification.verified) {
      verification.details.push('Deletion verified: no traces found');
    }

    return verification;
  }

  /**
   * Private helper methods
   */

  private async findCredential(
    queryRunner: QueryRunner,
    credentialId: string,
  ): Promise<Credential> {
    const credential = await queryRunner.manager.findOne(Credential, {
      where: { id: credentialId },
    });

    if (!credential) {
      throw new NotFoundException(
        `Credential with ID ${credentialId} not found`,
      );
    }

    return credential;
  }

  private async removeAccessPermissions(
    queryRunner: QueryRunner,
    credentialId: string,
  ): Promise<number> {
    const result = await queryRunner.manager.delete(AccessPermission, {
      resourceId: credentialId,
    });

    const count = result.affected || 0;
    this.logger.debug(
      `Removed ${count} access permissions for credential ${credentialId}`,
    );

    return count;
  }

  private async removeCredentialVersions(
    queryRunner: QueryRunner,
    credentialId: string,
  ): Promise<number> {
    const result = await queryRunner.manager.delete(CredentialVersion, {
      credentialId,
    });

    const count = result.affected || 0;
    this.logger.debug(
      `Removed ${count} credential versions for credential ${credentialId}`,
    );

    return count;
  }

  private async updateExports(
    queryRunner: QueryRunner,
    credentialId: string,
  ): Promise<number> {
    // Find all exports that reference this credential
    const exports = await queryRunner.manager.find(CredentialExport);

    let updatedCount = 0;
    for (const exportRecord of exports) {
      if (exportRecord.credentialIds.includes(credentialId)) {
        // Update validation results to indicate credential is deleted
        exportRecord.validationResults = {
          ...exportRecord.validationResults,
          deletedCredentials: [
            ...((exportRecord.validationResults?.deletedCredentials as string[]) || []),
            credentialId,
          ],
        };
        await queryRunner.manager.save(exportRecord);
        updatedCount++;
      }
    }

    this.logger.debug(
      `Updated ${updatedCount} exports referencing credential ${credentialId}`,
    );

    return updatedCount;
  }

  private async clearCacheEntries(credentialId: string): Promise<boolean> {
    try {
      // Clear specific credential cache keys
      const cacheKeys = [
        `${this.CACHE_KEY_PREFIX}${credentialId}`,
        `${this.CACHE_KEY_PREFIX}${credentialId}:versions`,
        `${this.CACHE_KEY_PREFIX}${credentialId}:access`,
        `${this.CACHE_KEY_PREFIX}${credentialId}:metadata`,
      ];

      for (const key of cacheKeys) {
        await this.cacheManager.del(key);
      }

      this.logger.debug(
        `Cleared cache entries for credential ${credentialId}`,
      );

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to clear cache for credential ${credentialId}: ${error.message}`,
      );
      // Don't throw - cache clearing failure shouldn't block deletion
      return false;
    }
  }

  /**
   * Securely overwrite sensitive data in the credential before deletion.
   * This ensures that even if data is somehow recovered, it won't contain
   * the original sensitive information.
   */
  private async secureOverwrite(credential: Credential): Promise<void> {
    // Overwrite sensitive data fields with random bytes
    credential.data = this.generateRandomData(credential.data);
    credential.contentHash = createHash('sha256')
      .update(randomBytes(32))
      .digest('hex');
    credential.duplicateMetadata = this.generateRandomMetadata(
      credential.duplicateMetadata,
    );

    // Save the overwritten data
    await this.credentialRepository.save(credential);

    this.logger.debug(
      `Securely overwrote sensitive data for credential ${credential.id}`,
    );
  }

  private generateRandomData(
    originalData: Record<string, any>,
  ): Record<string, any> {
    const randomData: Record<string, any> = {};
    for (const key of Object.keys(originalData)) {
      randomData[key] = randomBytes(32).toString('hex');
    }
    return randomData;
  }

  private generateRandomMetadata(
    originalMetadata: Record<string, any> | null,
  ): Record<string, any> | null {
    if (!originalMetadata) return null;

    const randomMetadata: Record<string, any> = {};
    for (const key of Object.keys(originalMetadata)) {
      randomMetadata[key] = randomBytes(16).toString('hex');
    }
    return randomMetadata;
  }

  private async verifyDeletion(credentialId: string): Promise<boolean> {
    const verification = await this.verifyDeletionComplete(credentialId);
    return verification.verified;
  }

  private async checkDatabaseExists(credentialId: string): Promise<boolean> {
    const count = await this.credentialRepository.count({
      where: { id: credentialId },
    });
    return count > 0;
  }

  private async checkCacheExists(credentialId: string): Promise<boolean> {
    try {
      const key = `${this.CACHE_KEY_PREFIX}${credentialId}`;
      const cached = await this.cacheManager.get(key);
      return cached !== null && cached !== undefined;
    } catch {
      return false;
    }
  }

  private async checkRelatedDataExists(credentialId: string): Promise<boolean> {
    // Check for access permissions
    const permissions = await this.accessPermissionRepository.count({
      where: { resourceId: credentialId },
    });

    // Check for versions
    const versions = await this.versionRepository.count({
      where: { credentialId },
    });

    return permissions > 0 || versions > 0;
  }

  private async recordAuditEntry(
    credentialId: string,
    deletedBy: string,
    result: SecureDeletionResult,
    reason?: string,
  ): Promise<void> {
    try {
      await this.auditService.record({
        actorId: deletedBy,
        operationType: AuditOperation.DELETED,
        targetCredentialId: credentialId,
        status: result.verified ? AuditStatus.SUCCESS : AuditStatus.FAILURE,
        metadata: {
          deletionHash: result.deletionHash,
          accessPermissionsRemoved: result.relatedDataCleared.accessPermissions,
          versionsRemoved: result.relatedDataCleared.versions,
          exportsUpdated: result.relatedDataCleared.exportsUpdated,
          cacheCleared: result.cacheCleared,
          verified: result.verified,
          reason: reason || null,
        },
      });

      this.logger.debug(
        `Recorded audit entry for deletion of credential ${credentialId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to record audit entry for credential ${credentialId}: ${error.message}`,
      );
      // Don't throw - audit failure shouldn't affect the deletion result
    }
  }

  private generateDeletionHash(
    credentialId: string,
    deletedBy: string,
  ): string {
    const timestamp = Date.now().toString();
    const data = `${credentialId}:${deletedBy}:${timestamp}:${randomBytes(16).toString('hex')}`;
    return createHash('sha256').update(data).digest('hex');
  }
}

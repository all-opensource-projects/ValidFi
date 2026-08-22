import {
  Controller,
  Delete,
  Param,
  Body,
  Post,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SecureDeletionService } from './secure-deletion.service';
import { SecureDeletionDto } from './dto/secure-deletion.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditOperation } from '../audit/audit-log.entity';

/**
 * Controller for secure credential deletion operations.
 *
 * All endpoints require JWT authentication and are automatically
 * audited via the @Audit decorator.
 */
@Controller('credentials')
@UseGuards(JwtAuthGuard)
export class SecureDeletionController {
  constructor(private readonly secureDeletionService: SecureDeletionService) {}

  /**
   * Securely delete a credential and all related data.
   *
   * This endpoint implements a multi-step secure deletion process:
   * 1. Removes all access permissions
   * 2. Removes all credential versions
   * 3. Updates exports to reflect deletion
   * 4. Clears all cache entries
   * 5. Securely overwrites sensitive data
   * 6. Performs hard delete from database
   * 7. Verifies deletion is complete
   * 8. Records audit trail
   *
   * @param id - The credential ID to delete
   * @param dto - Optional deletion reason
   * @param req - The request object containing user info
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Audit(AuditOperation.DELETED, { credentialIdParam: 'id' })
  async secureDelete(
    @Param('id') id: string,
    @Body() dto: SecureDeletionDto,
    @Request() req: any,
  ) {
    const deletedBy = req.user?.walletAddress;

    const result = await this.secureDeletionService.secureDelete(
      id,
      deletedBy,
      dto.reason,
    );

    return {
      message: 'Credential securely deleted',
      credentialId: result.credentialId,
      deleted: result.deleted,
      verified: result.verified,
      deletionHash: result.deletionHash,
      deletedAt: result.deletedAt.toISOString(),
      relatedDataCleared: result.relatedDataCleared,
      cacheCleared: result.cacheCleared,
    };
  }

  /**
   * Verify that a credential has been completely deleted.
   *
   * Checks that no traces of the credential exist in:
   * - Database
   * - Cache
   * - Related data (permissions, versions)
   *
   * @param id - The credential ID to verify
   */
  @Post(':id/verify-deletion')
  @HttpCode(HttpStatus.OK)
  async verifyDeletion(@Param('id') id: string) {
    const result = await this.secureDeletionService.verifyDeletionComplete(id);

    return {
      credentialId: result.credentialId,
      verified: result.verified,
      exists: result.exists,
      existsInDatabase: result.existsInDatabase,
      existsInCache: result.existsInCache,
      relatedDataExists: result.relatedDataExists,
      details: result.details,
    };
  }
}

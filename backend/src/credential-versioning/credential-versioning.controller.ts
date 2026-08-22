import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  Request,
} from '@nestjs/common';
import { CredentialVersioningService } from './credential-versioning.service';
import { UpgradeCredentialDto } from './dto/upgrade-credential.dto';
import { MigrateCredentialDto } from './dto/migrate-credential.dto';
import { ResolveConflictDto } from './dto/resolve-conflict.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Audit } from '../audit/audit.decorator';
import { AuditOperation } from '../audit/audit-log.entity';

/**
 * REST interface for the credential versioning system.
 *
 * All endpoints require a valid JWT and emit audit log entries via the
 * globally registered {@link AuditInterceptor}.
 *
 * Base path: `/credential-versions`
 */
@Controller('credential-versions')
@UseGuards(JwtAuthGuard)
@UseInterceptors(AuditInterceptor)
export class CredentialVersioningController {
  constructor(
    private readonly versioningService: CredentialVersioningService,
  ) {}

  /**
   * GET /credential-versions/:credentialId/history
   *
   * Returns all immutable snapshots for the credential, ordered from oldest
   * (v1) to newest.
   */
  @Get(':credentialId/history')
  getHistory(@Param('credentialId') credentialId: string) {
    return this.versioningService.getHistory(credentialId);
  }

  /**
   * GET /credential-versions/:credentialId/current
   *
   * Returns the most recent snapshot for the credential.
   */
  @Get(':credentialId/current')
  getCurrent(@Param('credentialId') credentialId: string) {
    return this.versioningService.getCurrentVersion(credentialId);
  }

  /**
   * GET /credential-versions/:credentialId/versions/:versionNumber
   *
   * Returns a single snapshot identified by its version number.
   */
  @Get(':credentialId/versions/:versionNumber')
  getVersion(
    @Param('credentialId') credentialId: string,
    @Param('versionNumber', ParseIntPipe) versionNumber: number,
  ) {
    return this.versioningService.getVersion(credentialId, versionNumber);
  }

  /**
   * GET /credential-versions/:credentialId/migrations
   *
   * Returns all migration records for the credential, newest first.
   */
  @Get(':credentialId/migrations')
  getMigrations(@Param('credentialId') credentialId: string) {
    return this.versioningService.getMigrations(credentialId);
  }

  /**
   * POST /credential-versions/:credentialId/upgrade
   *
   * Upgrade the credential to a new schema version. Optionally supply
   * `expectedVersion` to enable optimistic-lock conflict detection.
   * Returns 409 with a migration id when a conflict is detected.
   */
  @Post(':credentialId/upgrade')
  @Audit(AuditOperation.UPDATED, { credentialIdParam: 'credentialId' })
  upgrade(
    @Param('credentialId') credentialId: string,
    @Body() dto: UpgradeCredentialDto,
    @Request() req,
  ) {
    return this.versioningService.upgrade(
      credentialId,
      dto,
      req.user.walletAddress,
    );
  }

  /**
   * POST /credential-versions/:credentialId/migrate
   *
   * Explicit schema migration with strict from/to version guards.
   * Validates that the credential's current schema matches `fromSchemaVersion`
   * before applying the migration, otherwise returns 409.
   */
  @Post(':credentialId/migrate')
  @Audit(AuditOperation.UPDATED, { credentialIdParam: 'credentialId' })
  migrate(
    @Param('credentialId') credentialId: string,
    @Body() dto: MigrateCredentialDto,
    @Request() req,
  ) {
    return this.versioningService.migrate(
      credentialId,
      dto,
      req.user.walletAddress,
    );
  }

  /**
   * POST /credential-versions/migrations/:migrationId/resolve
   *
   * Operator endpoint to resolve a previously-conflicted migration.
   * Transitions the migration status from CONFLICT → RESOLVED and records the
   * resolution strategy and notes.
   */
  @Post('migrations/:migrationId/resolve')
  @Audit(AuditOperation.UPDATED, { credentialIdParam: 'migrationId' })
  resolveConflict(
    @Param('migrationId') migrationId: string,
    @Body() dto: ResolveConflictDto,
  ) {
    return this.versioningService.resolveConflict(migrationId, dto);
  }
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Credential } from './credential.entity';
import { CredentialMigrationService } from './credential-migration.service';
import { CredentialDeduplicationService } from './credential-deduplication.service';
import { SecureDeletionService } from './secure-deletion.service';
import { SecureDeletionController } from './secure-deletion.controller';
import { AccessPermission } from '../access-control/access-control.entity';
import { CredentialVersion } from '../credential-versioning/credential-version.entity';
import { CredentialExport } from '../credential-export/credential-export.entity';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Credential,
      AccessPermission,
      CredentialVersion,
      CredentialExport,
    ]),
    AuditModule,
    AuthModule,
  ],
  controllers: [SecureDeletionController],
  providers: [
    CredentialMigrationService,
    CredentialDeduplicationService,
    SecureDeletionService,
  ],
  exports: [
    CredentialMigrationService,
    CredentialDeduplicationService,
    SecureDeletionService,
  ],
})
export class CredentialsModule {}

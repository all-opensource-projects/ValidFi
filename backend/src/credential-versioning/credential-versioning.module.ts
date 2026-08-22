import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CredentialVersion } from './credential-version.entity';
import { CredentialMigration } from './credential-migration.entity';
import { CredentialVersioningService } from './credential-versioning.service';
import { CredentialVersioningController } from './credential-versioning.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([CredentialVersion, CredentialMigration]),
  ],
  controllers: [CredentialVersioningController],
  providers: [CredentialVersioningService],
  /**
   * Export the service so IdentityModule (and any other feature module) can
   * call snapshotVersion() without re-importing this module everywhere.
   */
  exports: [CredentialVersioningService],
})
export class CredentialVersioningModule {}

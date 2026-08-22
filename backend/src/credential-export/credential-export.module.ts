import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CredentialExport } from './credential-export.entity';
import { Credential } from '../credentials/credential.entity';
import { CredentialVersion } from '../credential-versioning/credential-version.entity';
import { CredentialExportService } from './credential-export.service';
import { CredentialExportController } from './credential-export.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([CredentialExport, Credential, CredentialVersion]),
  ],
  controllers: [CredentialExportController],
  providers: [CredentialExportService],
  exports: [CredentialExportService],
})
export class CredentialExportModule {}

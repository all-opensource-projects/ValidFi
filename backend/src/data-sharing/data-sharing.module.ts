import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSharingService } from './data-sharing.service';
import { DataSharingController } from './data-sharing.controller';
import { SharedData } from './data-sharing.entity';

import { CredentialSharingHistoryModule } from '../credential-sharing-history/credential-sharing-history.module';

@Module({
  imports: [TypeOrmModule.forFeature([SharedData]), CredentialSharingHistoryModule],
  controllers: [DataSharingController],
  providers: [DataSharingService],
  exports: [DataSharingService],
})
export class DataSharingModule {}

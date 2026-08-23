import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharingHistoryEvent } from './sharing-history-event.entity';
import { CredentialSharingHistoryService } from './credential-sharing-history.service';
import { CredentialSharingHistoryController } from './credential-sharing-history.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SharingHistoryEvent])],
  providers: [CredentialSharingHistoryService],
  controllers: [CredentialSharingHistoryController],
  exports: [CredentialSharingHistoryService],
})
export class CredentialSharingHistoryModule {}

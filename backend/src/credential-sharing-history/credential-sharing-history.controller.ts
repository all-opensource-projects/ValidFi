import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CredentialSharingHistoryService } from './credential-sharing-history.service';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // Assume it exists if we need it, but let's follow other controllers pattern.

@Controller('sharing-history')
export class CredentialSharingHistoryController {
  constructor(private readonly historyService: CredentialSharingHistoryService) {}

  @Get('timeline/:sharedDataId')
  async getTimeline(@Param('sharedDataId') sharedDataId: string) {
    return await this.historyService.getTimeline(sharedDataId);
  }

  @Get('insights/:ownerAddress')
  async getInsights(@Param('ownerAddress') ownerAddress: string) {
    return await this.historyService.getInsights(ownerAddress);
  }
}

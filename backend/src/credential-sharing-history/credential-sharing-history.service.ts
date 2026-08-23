import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SharingHistoryEvent, SharingAction } from './sharing-history-event.entity';

@Injectable()
export class CredentialSharingHistoryService {
  constructor(
    @InjectRepository(SharingHistoryEvent)
    private readonly historyRepository: Repository<SharingHistoryEvent>,
  ) {}

  async logEvent(
    sharedDataId: string,
    ownerAddress: string,
    recipientAddress: string,
    documentHash: string,
    action: SharingAction,
    metadata?: Record<string, any>,
  ): Promise<SharingHistoryEvent> {
    const event = this.historyRepository.create({
      sharedDataId,
      ownerAddress,
      recipientAddress,
      documentHash,
      action,
      metadata,
    });
    return await this.historyRepository.save(event);
  }

  async getTimeline(sharedDataId: string): Promise<SharingHistoryEvent[]> {
    return await this.historyRepository.find({
      where: { sharedDataId },
      order: { timestamp: 'ASC' },
    });
  }

  async getInsights(ownerAddress: string) {
    const events = await this.historyRepository.find({
      where: { ownerAddress },
    });

    const totalShares = events.filter((e) => e.action === SharingAction.SHARED).length;
    
    const recipientCounts: Record<string, number> = {};
    events
      .filter((e) => e.action === SharingAction.SHARED)
      .forEach((e) => {
        recipientCounts[e.recipientAddress] = (recipientCounts[e.recipientAddress] || 0) + 1;
      });

    const topRecipients = Object.entries(recipientCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([address, count]) => ({ address, count }));

    const credentialCounts: Record<string, number> = {};
    events
      .filter((e) => e.action === SharingAction.SHARED)
      .forEach((e) => {
        credentialCounts[e.documentHash] = (credentialCounts[e.documentHash] || 0) + 1;
      });

    const mostSharedCredentials = Object.entries(credentialCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([documentHash, count]) => ({ documentHash, count }));

    const totalExtensions = events.filter((e) => e.action === SharingAction.EXTENDED).length;
    const totalRevocations = events.filter((e) => e.action === SharingAction.REVOKED).length;

    return {
      totalShares,
      totalExtensions,
      totalRevocations,
      topRecipients,
      mostSharedCredentials,
    };
  }
}

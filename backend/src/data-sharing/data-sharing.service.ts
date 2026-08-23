import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SharedData } from './data-sharing.entity';
import { CreateSharedDataDto } from './dto/create-shared-data.dto';
import { UpdateSharedDataDto } from './dto/update-shared-data.dto';

import { CredentialSharingHistoryService } from '../credential-sharing-history/credential-sharing-history.service';
import { SharingAction } from '../credential-sharing-history/sharing-history-event.entity';

@Injectable()
export class DataSharingService {
  constructor(
    @InjectRepository(SharedData)
    private readonly sharedDataRepository: Repository<SharedData>,
    private readonly historyService: CredentialSharingHistoryService,
  ) {}

  async create(createSharedDataDto: CreateSharedDataDto): Promise<SharedData> {
    const sharedData = this.sharedDataRepository.create(createSharedDataDto);
    const saved = await this.sharedDataRepository.save(sharedData);

    await this.historyService.logEvent(
      saved.id,
      saved.ownerAddress,
      saved.recipientAddress,
      saved.documentHash,
      SharingAction.SHARED,
      { expiry: saved.accessExpiry }
    );

    return saved;
  }

  async findAll(): Promise<SharedData[]> {
    return await this.sharedDataRepository.find({ order: { sharedAt: 'DESC' } });
  }

  async findOne(id: string): Promise<SharedData> {
    const sharedData = await this.sharedDataRepository.findOne({ where: { id } });
    if (!sharedData) {
      throw new NotFoundException('Shared data not found');
    }
    return sharedData;
  }

  async update(id: string, updateSharedDataDto: UpdateSharedDataDto): Promise<SharedData> {
    const sharedData = await this.findOne(id);
    Object.assign(sharedData, updateSharedDataDto);
    return await this.sharedDataRepository.save(sharedData);
  }

  async revoke(id: string): Promise<SharedData> {
    const sharedData = await this.findOne(id);
    sharedData.isActive = false;
    const saved = await this.sharedDataRepository.save(sharedData);

    await this.historyService.logEvent(
      saved.id,
      saved.ownerAddress,
      saved.recipientAddress,
      saved.documentHash,
      SharingAction.REVOKED
    );

    return saved;
  }

  async isShareActive(id: string): Promise<boolean> {
    const sharedData = await this.findOne(id);
    if (!sharedData.isActive) {
      return false;
    }
    const now = Math.floor(Date.now() / 1000);
    return sharedData.accessExpiry > now;
  }

  async findByOwner(ownerAddress: string): Promise<SharedData[]> {
    return await this.sharedDataRepository.find({
      where: { ownerAddress },
      order: { sharedAt: 'DESC' },
    });
  }

  async findByRecipient(recipientAddress: string): Promise<SharedData[]> {
    return await this.sharedDataRepository.find({
      where: { recipientAddress },
      order: { sharedAt: 'DESC' },
    });
  }

  async extendShare(id: string, additionalSeconds: number): Promise<SharedData> {
    const sharedData = await this.findOne(id);
    const oldExpiry = sharedData.accessExpiry;
    sharedData.accessExpiry += additionalSeconds;
    const saved = await this.sharedDataRepository.save(sharedData);

    await this.historyService.logEvent(
      saved.id,
      saved.ownerAddress,
      saved.recipientAddress,
      saved.documentHash,
      SharingAction.EXTENDED,
      { oldExpiry, newExpiry: saved.accessExpiry }
    );

    return saved;
  }

  async findAllByOwner(ownerAddress: string): Promise<SharedData[]> {
    return await this.sharedDataRepository.find({
      where: { ownerAddress },
      order: { sharedAt: 'DESC' },
    });
  }

  async restore(data: Partial<SharedData>): Promise<SharedData> {
    const existing = await this.sharedDataRepository.findOne({
      where: { documentHash: data.documentHash, ownerAddress: data.ownerAddress },
    });

    let saved: SharedData;
    if (existing) {
      Object.assign(existing, data);
      saved = await this.sharedDataRepository.save(existing);
    } else {
      const sharedData = this.sharedDataRepository.create(data);
      saved = await this.sharedDataRepository.save(sharedData);
    }

    await this.historyService.logEvent(
      saved.id,
      saved.ownerAddress,
      saved.recipientAddress,
      saved.documentHash,
      SharingAction.RESTORED,
      { expiry: saved.accessExpiry }
    );

    return saved;
  }
}

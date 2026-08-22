import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Identity } from './identity.entity';
import { AiService } from '../ai/ai.service';
import { IpfsService } from '../ipfs/ipfs.service';
import { CreateIdentityDto } from './dto/create-identity.dto';
import { UpdateIdentityDto } from './dto/update-identity.dto';
import { PaginateIdentityDto } from './dto/paginate-identity.dto';
import { CredentialVersioningService } from '../credential-versioning/credential-versioning.service';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  lastPage: number;
}

@Injectable()
export class IdentityService {
  constructor(
    @InjectRepository(Identity)
    private readonly identityRepository: Repository<Identity>,
    private readonly versioningService: CredentialVersioningService,
    private readonly aiService: AiService,
    private readonly ipfsService: IpfsService,
  ) {}

  async create(createIdentityDto: CreateIdentityDto): Promise<Identity> {
    const identity = this.identityRepository.create(createIdentityDto);
    const saved = await this.identityRepository.save(identity);

    // Snapshot the initial version (v1) immediately after creation.
    await this.versioningService.snapshotVersion({
      credentialId: saved.id,
      documentHash: saved.documentHash,
      ipfsCid: saved.ipfsCid,
      verificationStatus: saved.verificationStatus,
      revoked: saved.revoked,
      metadata: saved.metadata,
      changedBy: saved.walletAddress,
      changeReason: 'initial',
    });

    return saved;
  }

  async findAll(
    walletAddress?: string,
    pagination?: PaginateIdentityDto,
  ): Promise<PaginatedResult<Identity>> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (walletAddress) where.walletAddress = walletAddress;
    if (pagination?.verifiedOnly) where.verificationStatus = true;

    const [data, total] = await this.identityRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, lastPage: Math.ceil(total / limit) };
  }

  async findOne(id: string): Promise<Identity> {
    const identity = await this.identityRepository.findOne({ where: { id } });
    if (!identity) {
      throw new NotFoundException('Identity not found');
    }
    return identity;
  }

  async update(id: string, updateIdentityDto: UpdateIdentityDto): Promise<Identity> {
    const identity = await this.findOne(id);
    Object.assign(identity, updateIdentityDto);
    const saved = await this.identityRepository.save(identity);

    // Snapshot a new version on every update so the full change history is preserved.
    await this.versioningService.snapshotVersion({
      credentialId: saved.id,
      documentHash: saved.documentHash,
      ipfsCid: saved.ipfsCid,
      verificationStatus: saved.verificationStatus,
      revoked: saved.revoked,
      metadata: saved.metadata,
      changedBy: saved.walletAddress,
      changeReason: 'update',
    });

    return saved;
  }

  async revoke(id: string, reason?: string): Promise<Identity> {
    const identity = await this.findOne(id);
    identity.revoked = true;
    if (reason) identity.revocationReason = reason;
    const saved = await this.identityRepository.save(identity);

    // Snapshot the revocation so history captures the exact moment of revocation.
    await this.versioningService.snapshotVersion({
      credentialId: saved.id,
      documentHash: saved.documentHash,
      ipfsCid: saved.ipfsCid,
      verificationStatus: saved.verificationStatus,
      revoked: true,
      metadata: saved.metadata,
      changedBy: saved.walletAddress,
      changeReason: 'revoked',
    });

    return saved;
  }

  async bulkRevoke(ids: string[], reason?: string): Promise<Identity[]> {
    const identities = await this.identityRepository.find({
      where: { id: In(ids) },
    });
    for (const identity of identities) {
      identity.revoked = true;
      if (reason) identity.revocationReason = reason;
    }
    return await this.identityRepository.save(identities);
  }

  async getRevocationList(pagination?: PaginateIdentityDto): Promise<PaginatedResult<Identity>> {
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    const skip = (page - 1) * limit;

    const [data, total] = await this.identityRepository.findAndCount({
      where: { revoked: true },
      order: { updatedAt: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, lastPage: Math.ceil(total / limit) };
  }

  async getRevocationStatus(id: string): Promise<{ revoked: boolean; reason: string | null }> {
    const identity = await this.findOne(id);
    return {
      revoked: identity.revoked,
      reason: identity.revocationReason || null,
    };
  }

  async remove(id: string): Promise<void> {
    const identity = await this.findOne(id);
    await this.identityRepository.remove(identity);
  }

  async detectFraud(id: string): Promise<Identity> {
    const identity = await this.findOne(id);
    const credentialData = await this.ipfsService.fetchJson(identity.ipfsCid);
    const fraudResult = await this.aiService.detectFraud(credentialData);
    
    identity.metadata = {
      ...(identity.metadata || {}),
      fraudScore: fraudResult.fraudScore,
      isFlagged: fraudResult.isFlagged,
      suspiciousPatterns: fraudResult.suspiciousPatterns,
    };
    
    return await this.identityRepository.save(identity);
  }

  async findByDocumentHash(documentHash: string): Promise<Identity> {
    return await this.identityRepository.findOne({ where: { documentHash } });
  }

  async findAllByWallet(walletAddress: string): Promise<Identity[]> {
    return await this.identityRepository.find({
      where: { walletAddress },
      order: { createdAt: 'DESC' },
    });
  }

  async restore(data: Partial<Identity>): Promise<Identity> {
    const existing = await this.identityRepository.findOne({
      where: { documentHash: data.documentHash },
    });

    if (existing) {
      Object.assign(existing, data);
      return await this.identityRepository.save(existing);
    }

    const identity = this.identityRepository.create(data);
    return await this.identityRepository.save(identity);
  }

  async verifyIntegrity(id: string): Promise<{ valid: boolean; reason?: string }> {
    const identity = await this.findOne(id);
    
    let ipfsData;
    try {
      ipfsData = await this.ipfsService.fetchJson(identity.ipfsCid);
    } catch (error) {
      return { valid: false, reason: 'Failed to fetch data from IPFS' };
    }

    const jsonContent = JSON.stringify(ipfsData, null, 2);
    const checksum = crypto
      .createHash('sha256')
      .update(jsonContent)
      .digest('hex');

    if (checksum !== identity.documentHash) {
      return { valid: false, reason: 'Credential data integrity check failed: hash mismatch' };
    }

    return { valid: true };
  }
}

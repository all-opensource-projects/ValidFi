import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CredentialSharingHistoryService } from './credential-sharing-history.service';
import { SharingHistoryEvent, SharingAction } from './sharing-history-event.entity';

describe('CredentialSharingHistoryService', () => {
  let service: CredentialSharingHistoryService;

  const mockRepository = {
    create: jest.fn().mockImplementation((dto) => dto),
    save: jest.fn().mockImplementation((event) => Promise.resolve({ id: 'some-id', ...event })),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialSharingHistoryService,
        {
          provide: getRepositoryToken(SharingHistoryEvent),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<CredentialSharingHistoryService>(CredentialSharingHistoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should log an event', async () => {
    const result = await service.logEvent(
      'share-id',
      'owner-addr',
      'recipient-addr',
      'doc-hash',
      SharingAction.SHARED,
      { test: true },
    );
    expect(result).toBeDefined();
    expect(mockRepository.create).toHaveBeenCalled();
    expect(mockRepository.save).toHaveBeenCalled();
    expect(result.action).toEqual(SharingAction.SHARED);
  });

  it('should generate insights correctly', async () => {
    mockRepository.find.mockResolvedValueOnce([
      { action: SharingAction.SHARED, recipientAddress: 'addr1', documentHash: 'hash1' },
      { action: SharingAction.SHARED, recipientAddress: 'addr1', documentHash: 'hash2' },
      { action: SharingAction.SHARED, recipientAddress: 'addr2', documentHash: 'hash1' },
      { action: SharingAction.EXTENDED },
      { action: SharingAction.REVOKED },
    ]);

    const insights = await service.getInsights('owner-addr');
    expect(insights.totalShares).toBe(3);
    expect(insights.totalExtensions).toBe(1);
    expect(insights.totalRevocations).toBe(1);
    expect(insights.topRecipients[0].address).toBe('addr1');
    expect(insights.topRecipients[0].count).toBe(2);
    expect(insights.mostSharedCredentials[0].documentHash).toBe('hash1');
    expect(insights.mostSharedCredentials[0].count).toBe(2);
  });
});

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
  PDF = 'pdf',
  VERIFIABLE_CREDENTIAL = 'vc',
}

export enum ExportStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('credential_exports')
export class CredentialExport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  requestedBy: string;

  @Column({ type: 'enum', enum: ExportFormat })
  format: ExportFormat;

  @Column({ type: 'enum', enum: ExportStatus, default: ExportStatus.PENDING })
  status: ExportStatus;

  @Column({ type: 'json', nullable: true })
  credentialIds: string[];

  @Column({ default: false })
  includeMetadata: boolean;

  @Column({ default: false })
  includeVersionHistory: boolean;

  @Column({ default: true })
  encryptSensitiveData: boolean;

  @Column({ nullable: true })
  encryptionKeyId: string;

  @Column({ type: 'text', nullable: true })
  fileHash: string;

  @Column({ type: 'text', nullable: true })
  storagePath: string;

  @Column({ type: 'int', default: 0 })
  credentialCount: number;

  @Column({ type: 'bigint', default: 0 })
  fileSizeBytes: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @Column({ type: 'json', nullable: true })
  validationResults: Record<string, any>;

  @Column({ nullable: true })
  completedAt: Date;

  @Column({ nullable: true })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

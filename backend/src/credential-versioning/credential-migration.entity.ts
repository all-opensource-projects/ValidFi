import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Status of a credential migration attempt.
 */
export enum MigrationStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  /**
   * The migration was aborted because the credential's current version did not
   * match the caller's expected version (optimistic-lock conflict).
   */
  CONFLICT = 'conflict',
  /** A previous conflict was manually resolved by an operator. */
  RESOLVED = 'resolved',
}

/**
 * Tracks every schema-level migration attempt on a credential.
 *
 * Created whenever {@link CredentialVersioningService.upgrade} or
 * {@link CredentialVersioningService.migrate} is invoked.  The record is
 * updated in-place as the migration progresses through its lifecycle
 * (pending → success | failed | conflict → resolved).
 */
@Entity('credential_migrations')
export class CredentialMigration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Credential being migrated. */
  @Index()
  @Column()
  credentialId: string;

  /** Version number before the migration started. */
  @Column({ type: 'int' })
  fromVersion: number;

  /**
   * Version number after a successful migration.
   * Null while the migration is still in flight or has failed/conflicted.
   */
  @Column({ type: 'int', nullable: true })
  toVersion: number | null;

  /** Schema version the credential is migrating from. */
  @Column()
  fromSchemaVersion: string;

  /** Target schema version requested by the caller. */
  @Column()
  toSchemaVersion: string;

  @Index()
  @Column({
    type: 'enum',
    enum: MigrationStatus,
    default: MigrationStatus.PENDING,
  })
  status: MigrationStatus;

  /** Human-readable explanation when status is CONFLICT or FAILED. */
  @Column({ nullable: true })
  conflictReason: string | null;

  /**
   * Free-form resolution note supplied by the operator when resolving a
   * conflicted migration.
   */
  @Column({ type: 'json', nullable: true })
  resolutionNotes: Record<string, any> | null;

  /** Wallet address of the actor who triggered the migration. */
  @Index()
  @Column()
  migratedBy: string;

  @CreateDateColumn()
  createdAt: Date;

  /** Reflects the last status transition. */
  @UpdateDateColumn()
  updatedAt: Date;
}

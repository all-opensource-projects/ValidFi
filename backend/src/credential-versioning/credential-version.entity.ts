import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

/**
 * Immutable, append-only snapshot of a credential at a specific version.
 *
 * Each time a credential is created or updated a new row is inserted here
 * with an auto-incremented {@link versionNumber}. Rows are never mutated
 * after insertion, preserving a complete, auditable change history.
 */
@Entity('credential_versions')
@Unique(['credentialId', 'versionNumber'])
export class CredentialVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Reference to the parent credential (Identity) id. */
  @Index()
  @Column()
  credentialId: string;

  /**
   * Monotonically increasing version counter scoped to the credential.
   * Starts at 1 for the initial snapshot and increments by 1 on every change.
   */
  @Index()
  @Column({ type: 'int' })
  versionNumber: number;

  /**
   * Semantic schema version string (e.g. "1.0.0", "2.1.0").
   * Allows distinguishing format upgrades from data changes.
   */
  @Column({ default: '1.0.0' })
  schemaVersion: string;

  /** Document hash at this version, mirrored from Identity.documentHash. */
  @Column()
  documentHash: string;

  /** IPFS CID at this version, mirrored from Identity.ipfsCid. */
  @Column()
  ipfsCid: string;

  /** Verification status at this version. */
  @Column({ default: false })
  verificationStatus: boolean;

  /** Whether the credential was revoked at this version. */
  @Column({ default: false })
  revoked: boolean;

  /** Full metadata snapshot at this version. */
  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any> | null;

  /** Human-readable description of why this version was created. */
  @Column({ nullable: true })
  changeReason: string | null;

  /** Wallet address of the actor who produced this version. */
  @Index()
  @Column()
  changedBy: string;

  /** Immutable creation timestamp — never updated. */
  @CreateDateColumn()
  createdAt: Date;
}

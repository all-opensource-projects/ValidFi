import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

export enum SharingAction {
  SHARED = 'SHARED',
  EXTENDED = 'EXTENDED',
  REVOKED = 'REVOKED',
  RESTORED = 'RESTORED'
}

@Entity('sharing_history_events')
export class SharingHistoryEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  sharedDataId: string;

  @Column()
  ownerAddress: string;

  @Column()
  recipientAddress: string;

  @Column()
  documentHash: string;

  @Column({
    type: 'enum',
    enum: SharingAction,
  })
  action: SharingAction;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  timestamp: Date;
}

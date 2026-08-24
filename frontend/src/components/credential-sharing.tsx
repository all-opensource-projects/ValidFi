'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { Share2, Lock, Clock, X, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimatedProgress, SuccessOverlay, SuccessToast } from './animations';
import { ShareConfirmationModal } from './share-confirmation-modal';
import { useAccessibility } from '@/contexts/AccessibilityContext';
import { useCredentialOperation } from '@/hooks/useCredentialOperation';
import { isValidStellarAddress } from '@/utils/stellar-address';
import { AlertCircle } from 'lucide-react';

interface CredentialSharingProps {
  walletAddress: string;
}

interface SelectableCredential {
  id: string;
  vaccineType: string;
}

interface SharedCredential {
  id: string;
  vaccineType: string;
  recipient: string;
  expiresAt: string;
  status: 'active' | 'revoked' | 'expired';
}

// Credentials available to share, mirroring the mock data used elsewhere in the
// vault/verification views until real credential records are wired up.
const AVAILABLE_CREDENTIALS: SelectableCredential[] = [
  { id: 'covid-pfizer', vaccineType: 'COVID-19 (Pfizer)' },
  { id: 'influenza-2025', vaccineType: 'Influenza 2025' },
  { id: 'hepatitis-b', vaccineType: 'Hepatitis B' },
];

const DURATION_OPTIONS = [
  { value: '3600', label: '1 hour' },
  { value: '86400', label: '1 day' },
  { value: '604800', label: '1 week' },
  { value: '2592000', label: '1 month' },
];

// Stellar public keys are 56 chars with a version byte and CRC16-XModem
// checksum; validate the checksum so a typo'd address can't receive a share.
function isValidRecipient(address: string): boolean {
  return isValidStellarAddress(address);
}

// A share is expired once its expiry time passes, regardless of the stored
// status. Derive the effective status so the list never shows stale "active".
function effectiveStatus(share: { status: SharedCredential['status']; expiresAt: string }): SharedCredential['status'] {
  if (share.status === 'revoked') return 'revoked';
  if (Date.now() > new Date(share.expiresAt).getTime()) return 'expired';
  return 'active';
}

export function CredentialSharing({ walletAddress }: CredentialSharingProps) {
  const [recipient, setRecipient] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [durationSeconds, setDurationSeconds] = useState(86400);
  const [sharedCredentials, setSharedCredentials] = useState<SharedCredential[]>([]);
  const [shareProgress, setShareProgress] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; title: string; description?: string }>({
    show: false,
    title: '',
  });
  const { announceToScreenReader } = useAccessibility();
  const shareButtonRef = useRef<HTMLButtonElement>(null);

  const { execute, error, clearError, isPending: isSharing } = useCredentialOperation();

  const selectedCredentials = useMemo(
    () => AVAILABLE_CREDENTIALS.filter((credential) => selectedIds.includes(credential.id)),
    [selectedIds]
  );

  const formInvalid = !isValidRecipient(recipient) || selectedCredentials.length === 0;

  const toggleCredential = useCallback(
    (id: string) => {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]
      );
    },
    []
  );

  const handleShare = useCallback(async () => {
    if (isSharing) return;
    clearError();
    announceToScreenReader('Generating zero-knowledge proof...');
    setShareProgress(0);

    await execute(async () => {
      return new Promise<void>((resolve, reject) => {
        // Simulate network failure randomly (e.g. 10% chance) for demonstration
        if (Math.random() < 0.1) {
          setTimeout(() => reject(new Error('network error')), 1000);
          return;
        }

        const stages = [
          { progress: 15, delay: 400 },
          { progress: 35, delay: 800 },
          { progress: 60, delay: 1200 },
          { progress: 85, delay: 1600 },
          { progress: 100, delay: 2000 },
        ];

        stages.forEach(({ progress, delay }) => {
          setTimeout(() => setShareProgress(progress), delay);
        });

        setTimeout(() => {
          setShowSuccess(true);
          announceToScreenReader('Proof generated successfully');

          const expiresAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
          const newShares: SharedCredential[] = selectedCredentials.map((credential) => ({
            id: crypto.randomUUID(),
            vaccineType: credential.vaccineType,
            recipient: recipient.trim(),
            expiresAt,
            status: 'active',
          }));
          setSharedCredentials((prev) => [...prev, ...newShares]);
          resolve();
        }, 2400);
      });
    }, {
      context: 'ShareCredential',
    });
  }, [isSharing, clearError, execute, announceToScreenReader, selectedCredentials, recipient, durationSeconds]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (formInvalid) return;
      setIsConfirmOpen(true);
    },
    [formInvalid]
  );

  const handleConfirmShare = useCallback(() => {
    setIsConfirmOpen(false);
    void handleShare();
  }, [handleShare]);

  const handleRevoke = useCallback(
    (id: string, vaccineType: string) => {
      setSharedCredentials((prev) =>
        prev.map((share) => (share.id === id ? { ...share, status: 'revoked' } : share))
      );
      setToast({
        show: true,
        title: 'Access Revoked',
        description: 'The shared proof has been invalidated',
      });
      announceToScreenReader(`Revoked access for ${vaccineType}`);
      setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
    },
    [announceToScreenReader]
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  }, []);

  return (
    <div role="region" aria-labelledby="sharing-heading">
      <h2 id="sharing-heading" className="text-xl sm:text-2xl font-bold text-white mb-4 sm:mb-6">
        Credential Sharing
      </h2>

      {/* Share form */}
      <div className="bg-white/10 rounded-lg p-4 sm:p-6 mb-4 sm:mb-6">
        <h3 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">Share Vaccination Proof</h3>
        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
          <div>
            <label htmlFor="recipient-address" className="block text-green-200 text-xs sm:text-sm mb-1 sm:mb-2">
              Recipient Wallet Address
            </label>
            <input
              id="recipient-address"
              type="text"
              placeholder="G..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={isSharing}
              aria-required="true"
              aria-describedby="recipient-help"
              aria-invalid={recipient !== '' && !isValidRecipient(recipient)}
              className="w-full bg-white/10 border border-green-400 rounded-lg px-3 sm:px-4 py-3 sm:py-2 text-white placeholder-green-300 focus:outline-none focus:border-green-300 disabled:opacity-50 text-base sm:text-sm"
            />
            <p id="recipient-help" className="text-xs text-green-300 mt-1">
              Enter the Stellar wallet address of the recipient
            </p>
            {recipient !== '' && !isValidRecipient(recipient) && (
              <p className="text-xs text-red-300 mt-1" role="alert">
                Enter a valid Stellar address (starts with G, 56 characters total)
              </p>
            )}
          </div>

          <fieldset>
            <legend className="block text-green-200 text-xs sm:text-sm mb-1 sm:mb-2">
              Select Credentials to Share
            </legend>
            <div role="group" aria-label="Select credentials to share" className="space-y-2">
              {AVAILABLE_CREDENTIALS.map((credential) => {
                const checked = selectedIds.includes(credential.id);
                return (
                  <label
                    key={credential.id}
                    className="flex items-center gap-3 bg-white/5 hover:bg-white/10 rounded-lg px-3 py-2 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCredential(credential.id)}
                      disabled={isSharing}
                      className="w-4 h-4 accent-green-500"
                      aria-label={`Share ${credential.vaccineType}`}
                    />
                    <Shield className="w-4 h-4 text-green-400 shrink-0" aria-hidden="true" />
                    <span className="text-white text-sm">{credential.vaccineType}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label htmlFor="duration-select" className="block text-green-200 text-xs sm:text-sm mb-1 sm:mb-2">
              Proof Duration
            </label>
            <select
              id="duration-select"
              value={durationSeconds}
              onChange={(e) => setDurationSeconds(Number(e.target.value))}
              disabled={isSharing}
              className="w-full bg-white/10 border border-green-400 rounded-lg px-3 sm:px-4 py-3 sm:py-2 text-white focus:outline-none focus:border-green-300 disabled:opacity-50 text-base sm:text-sm"
            >
              {DURATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="bg-gray-900">
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Progress indicator during sharing */}
          <AnimatePresence>
            {isSharing && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                role="progressbar"
                aria-valuenow={shareProgress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Proof generation progress: ${shareProgress}%`}
              >
                <AnimatedProgress progress={shareProgress} label="Generating zero-knowledge proof" />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-200 text-sm flex items-start gap-2"
                role="alert"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
                <p>{error}</p>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            ref={shareButtonRef}
            type="submit"
            disabled={isSharing || formInvalid}
            className={`w-full py-3 sm:py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 touch-manipulation ${
              isSharing
                ? 'bg-green-600/50 cursor-not-allowed text-white/70'
                : formInvalid
                  ? 'bg-green-600/40 cursor-not-allowed text-white/50'
                  : 'bg-green-600 hover:bg-green-700 active:bg-green-800 text-white'
            }`}
            aria-busy={isSharing}
            aria-label={isSharing ? 'Generating zero-knowledge proof' : 'Share vaccination proof'}
            whileHover={isSharing || formInvalid ? {} : { scale: 1.01 }}
            whileTap={isSharing || formInvalid ? {} : { scale: 0.99 }}
          >
            <Share2 className="w-5 h-5" aria-hidden="true" />
            {isSharing ? 'Generating Proof...' : 'Share Vaccination Proof'}
          </motion.button>
        </form>
      </div>

      {/* Shared credentials list */}
      <div className="space-y-3 sm:space-y-4">
        <h3 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">Shared Credentials</h3>
        <div role="list" aria-label="Shared credentials">
          <AnimatePresence mode="popLayout">
            {sharedCredentials.length === 0 ? (
              <motion.div
                key="empty"
                className="text-center py-6 sm:py-8 text-green-200"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                role="status"
              >
                <Shield className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 sm:mb-4 opacity-50" aria-hidden="true" />
                <p className="text-sm sm:text-base">No credentials shared yet</p>
              </motion.div>
            ) : (
              sharedCredentials.map((share, index) => {
                const status = effectiveStatus(share);
                return (
                <motion.div
                  key={share.id}
                  className="bg-white/10 rounded-lg p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -30, scale: 0.95 }}
                  transition={{ delay: index * 0.05, type: 'spring', stiffness: 300, damping: 25 }}
                  layout
                  role="listitem"
                  aria-label={`${share.vaccineType} shared with ${share.recipient}, status ${status}, expires ${new Date(share.expiresAt).toLocaleString()}`}
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    <Lock className="w-6 h-6 sm:w-8 sm:h-8 text-green-400 flex-shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-white font-medium text-sm sm:text-base">{share.vaccineType}</p>
                        {status === 'active' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">
                            Active
                          </span>
                        )}
                        {status === 'revoked' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">
                            Revoked
                          </span>
                        )}
                        {status === 'expired' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                            Expired
                          </span>
                        )}
                      </div>
                      <p className="text-green-200 text-xs sm:text-sm truncate">Shared with: {share.recipient}</p>
                      <p className="text-green-200 text-xs sm:text-sm flex items-center gap-1">
                        <Clock className="w-3 h-3 sm:w-4 sm:h-4" aria-hidden="true" />
                        Expires: {new Date(share.expiresAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {status === 'active' && (
                    <motion.button
                      className="text-red-400 hover:text-red-300 transition-colors self-end sm:self-auto p-2 -m-2 touch-manipulation"
                      onClick={() => handleRevoke(share.id, share.vaccineType)}
                      onKeyDown={(e) =>
                        handleKeyDown(e, () => handleRevoke(share.id, share.vaccineType))
                      }
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      aria-label={`Revoke access for ${share.vaccineType}`}
                    >
                      <X className="w-5 h-5" aria-hidden="true" />
                    </motion.button>
                  )}
                </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Share confirmation dialog */}
      <ShareConfirmationModal
        isOpen={isConfirmOpen}
        summary={
          isConfirmOpen
            ? {
                recipient: recipient.trim(),
                credentials: selectedCredentials,
                durationSeconds,
              }
            : null
        }
        onConfirm={handleConfirmShare}
        onCancel={() => setIsConfirmOpen(false)}
      />

      {/* Success overlay */}
      <SuccessOverlay show={showSuccess} variant="share" onDismiss={() => setShowSuccess(false)} />

      {/* Toast notification */}
      <SuccessToast
        show={toast.show}
        title={toast.title}
        description={toast.description}
        onDismiss={() => setToast((t) => ({ ...t, show: false }))}
      />
    </div>
  );
}

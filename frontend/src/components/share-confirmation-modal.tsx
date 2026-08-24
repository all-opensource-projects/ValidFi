'use client';

import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, Shield, Clock, CheckCircle } from 'lucide-react';
import { useAccessibility } from '@/contexts/AccessibilityContext';

interface ShareSummary {
  recipient: string;
  credentials: { id: string; vaccineType: string }[];
  durationSeconds: number;
}

interface ShareConfirmationModalProps {
  isOpen: boolean;
  summary: ShareSummary | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const DURATION_LABELS: Record<number, string> = {
  3600: '1 hour',
  86400: '1 day',
  604800: '1 week',
  2592000: '1 month',
};

export function ShareConfirmationModal({
  isOpen,
  summary,
  onConfirm,
  onCancel,
}: ShareConfirmationModalProps) {
  const { announceToScreenReader } = useAccessibility();

  useEffect(() => {
    if (isOpen) {
      announceToScreenReader('Share confirmation dialog opened');
    }
  }, [isOpen, announceToScreenReader]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    },
    [onCancel]
  );

  if (!summary) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onKeyDown={handleKeyDown}
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-modal-title"
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
          />

          {/* Modal content */}
          <motion.div
            className="relative bg-gradient-to-br from-gray-900 to-gray-800 border border-green-500/30 rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-w-md w-full mx-0 sm:mx-4 shadow-2xl max-h-[90vh] overflow-y-auto"
            initial={{ scale: 0.9, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: -10, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <Share2 className="w-5 h-5 sm:w-6 sm:h-6 text-green-400" />
              </div>
              <h3 id="share-modal-title" className="text-lg sm:text-xl font-bold text-white">
                Confirm Share
              </h3>
            </div>

            {/* Summary */}
            <div className="bg-white/5 rounded-lg p-3 sm:p-4 mb-3 sm:mb-4 space-y-3">
              <div>
                <div className="text-xs text-gray-400 mb-1">Recipient</div>
                <div className="text-white font-mono text-xs sm:text-sm break-all">{summary.recipient}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Credentials</div>
                <ul className="space-y-1">
                  {summary.credentials.map((credential) => (
                    <li key={credential.id} className="flex items-center gap-2 text-white text-sm">
                      <Shield className="w-4 h-4 text-green-400 shrink-0" />
                      {credential.vaccineType}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Duration</div>
                <div className="flex items-center gap-2 text-white text-sm">
                  <Clock className="w-4 h-4 text-green-400" />
                  {DURATION_LABELS[summary.durationSeconds] ?? `${summary.durationSeconds} seconds`}
                </div>
              </div>
            </div>

            {/* Note */}
            <p className="text-xs text-gray-400 mb-3 sm:mb-4">
              The recipient will be able to view these credentials for the selected duration. You can revoke
              access at any time from the shared list below.
            </p>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:justify-end">
              <button
                onClick={onCancel}
                className="px-4 py-3 sm:py-2 bg-white/10 hover:bg-white/20 active:bg-white/30 text-gray-300 rounded-lg transition-colors touch-manipulation order-2 sm:order-none"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="px-4 py-3 sm:py-2 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white rounded-lg transition-colors flex items-center justify-center gap-2 touch-manipulation order-1 sm:order-none"
              >
                <CheckCircle className="w-4 h-4" />
                Confirm Share
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

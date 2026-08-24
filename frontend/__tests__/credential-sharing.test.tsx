import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredentialSharing } from '../src/components/credential-sharing';
import { AccessibilityProvider } from '../src/contexts/AccessibilityContext';

function renderWithProviders(ui: React.ReactElement) {
  return render(<AccessibilityProvider>{ui}</AccessibilityProvider>);
}

// Checksum-valid Stellar ed25519 public key (version byte 0x30, CRC16-XModem, little-endian).
const VALID_RECIPIENT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('CredentialSharing', () => {
  const walletAddress = 'GABCDEF123456...';

  it('renders the heading', () => {
    renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);
    expect(screen.getByText('Credential Sharing')).toBeInTheDocument();
  });

  it('renders share form elements', () => {
    renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);
    expect(screen.getByText('Recipient Wallet Address')).toBeInTheDocument();
    expect(screen.getByText('Select Credentials to Share')).toBeInTheDocument();
    expect(screen.getByText('Proof Duration')).toBeInTheDocument();
  });

  it('renders empty state when no credentials shared', () => {
    renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);
    expect(screen.getByText('No credentials shared yet')).toBeInTheDocument();
  });

  it('renders share button', () => {
    renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);
    const buttons = screen.getAllByText('Share Vaccination Proof');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    const shareButton = buttons.find((el) => el.tagName === 'BUTTON');
    expect(shareButton).toBeInTheDocument();
  });

  it('renders duration options', () => {
    renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);
    expect(screen.getByText('1 hour')).toBeInTheDocument();
    expect(screen.getByText('1 day')).toBeInTheDocument();
    expect(screen.getByText('1 week')).toBeInTheDocument();
    expect(screen.getByText('1 month')).toBeInTheDocument();
  });

  it('renders shared credentials section heading', () => {
    renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);
    expect(screen.getByText('Shared Credentials')).toBeInTheDocument();
  });

  it('renders selectable credentials', () => {
    renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);
    expect(screen.getByRole('checkbox', { name: 'Share COVID-19 (Pfizer)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Share Influenza 2025' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Share Hepatitis B' })).toBeInTheDocument();
  });

  it('keeps share button disabled until recipient and credential are valid', () => {
    renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);
    const shareButton = screen.getAllByText('Share Vaccination Proof').find(
      (el) => el.tagName === 'BUTTON'
    ) as HTMLButtonElement;
    expect(shareButton).toBeDisabled();
  });

  it('shows validation error for an invalid recipient address', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);
    const recipientInput = screen.getByLabelText('Recipient Wallet Address');

    await user.type(recipientInput, 'not-a-stellar-address');

    expect(
      screen.getByText('Enter a valid Stellar address (starts with G, 56 characters total)')
    ).toBeInTheDocument();
  });

  it('rejects a well-formed but checksum-invalid recipient address', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);
    const recipientInput = screen.getByLabelText('Recipient Wallet Address');

    // 56 chars in the right alphabet, but the CRC16 checksum is wrong.
    const badChecksum = 'G' + 'B'.repeat(55);
    await user.type(recipientInput, badChecksum);

    expect(
      screen.getByText('Enter a valid Stellar address (starts with G, 56 characters total)')
    ).toBeInTheDocument();
  });

  it('accepts a known checksum-valid Stellar public key', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);
    const recipientInput = screen.getByLabelText('Recipient Wallet Address');

    await user.type(recipientInput, VALID_RECIPIENT);

    expect(
      screen.queryByText('Enter a valid Stellar address (starts with G, 56 characters total)')
    ).not.toBeInTheDocument();
  });

  it('opens the confirmation dialog when the form is valid', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);

    await user.type(screen.getByLabelText('Recipient Wallet Address'), VALID_RECIPIENT);
    await user.click(screen.getByRole('checkbox', { name: 'Share COVID-19 (Pfizer)' }));

    const shareButton = screen.getAllByText('Share Vaccination Proof').find(
      (el) => el.tagName === 'BUTTON'
    ) as HTMLButtonElement;
    await user.click(shareButton);

    expect(screen.getByRole('button', { name: 'Confirm Share' })).toBeInTheDocument();
    expect(screen.getByText(VALID_RECIPIENT)).toBeInTheDocument();
  });

  describe('expiry transitions', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      // Keep the simulated 10% network failure out of the test.
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      // jsdom does not ship crypto.randomUUID.
      if (!global.crypto?.randomUUID) {
        Object.defineProperty(global.crypto, 'randomUUID', {
          value: () => `test-id-${Math.random()}`,
          configurable: true,
        });
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
      jest.useRealTimers();
    });

    async function shareOne(user: ReturnType<typeof userEvent.setup>, credentialLabel: string) {
      await user.type(screen.getByLabelText('Recipient Wallet Address'), VALID_RECIPIENT);
      await user.click(screen.getByRole('checkbox', { name: `Share ${credentialLabel}` }));

      const shareButton = screen.getAllByText('Share Vaccination Proof').find(
        (el) => el.tagName === 'BUTTON'
      ) as HTMLButtonElement;
      await user.click(shareButton);
      await user.click(screen.getByRole('button', { name: 'Confirm Share' }));

      // Let the simulated proof generation finish, then reset the form so the
      // next share can be created cleanly.
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      await user.clear(screen.getByLabelText('Recipient Wallet Address'));
      await user.click(screen.getByRole('checkbox', { name: `Share ${credentialLabel}` }));
    }

    it(
      'flips each share to expired at its own expiry time without user interaction',
      async () => {
        const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

        renderWithProviders(<CredentialSharing walletAddress={walletAddress} />);

        // First share: 1 hour.
        await user.selectOptions(screen.getByLabelText('Proof Duration'), '3600');
        await shareOne(user, 'COVID-19 (Pfizer)');

        // Second share: 1 day.
        await user.selectOptions(screen.getByLabelText('Proof Duration'), '86400');
        await shareOne(user, 'Influenza 2025');

        expect(screen.getAllByText('Active')).toHaveLength(2);

        // Advance past the first expiry only — the hourly share flips to
        // expired while the daily one stays active.
        await act(async () => {
          jest.advanceTimersByTime(3600 * 1000 + 1);
        });
        const badges = screen.getAllByText(/^(Active|Expired)$/);
        expect(badges.filter((el) => el.textContent === 'Expired')).toHaveLength(1);
        expect(badges.filter((el) => el.textContent === 'Active')).toHaveLength(1);

        // Advance past the second expiry — everything is expired now.
        await act(async () => {
          jest.advanceTimersByTime(86400 * 1000);
        });
        expect(screen.queryByText('Active')).not.toBeInTheDocument();
        expect(screen.getAllByText('Expired')).toHaveLength(2);
      },
      15000
    );
  });
});

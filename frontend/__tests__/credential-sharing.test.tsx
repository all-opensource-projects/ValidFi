import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CredentialSharing } from '../src/components/credential-sharing';
import { AccessibilityProvider } from '../src/contexts/AccessibilityContext';

function renderWithProviders(ui: React.ReactElement) {
  return render(<AccessibilityProvider>{ui}</AccessibilityProvider>);
}

const VALID_RECIPIENT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABZKY';

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
});

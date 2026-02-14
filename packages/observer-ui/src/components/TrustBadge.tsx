type TrustTier = 'seed' | 'trusted' | 'provisional' | 'untrusted' | 'quarantined';

const TIER_CONFIG: Record<TrustTier, { color: string; label: string; symbol: string }> = {
  seed:         { color: '#ffd700', label: 'Seed',         symbol: '\u2605' },  // star
  trusted:      { color: '#43b581', label: 'Trusted',      symbol: '\u2713' },  // check
  provisional:  { color: '#5865f2', label: 'Provisional',  symbol: '\u25cb' },  // circle
  untrusted:    { color: '#747f8d', label: 'Untrusted',    symbol: '\u25cb' },  // circle
  quarantined:  { color: '#ed4245', label: 'Quarantined',  symbol: '\u2717' },  // cross
};

interface TrustBadgeProps {
  tier?: string | null;
  size?: 'sm' | 'md';
}

export function TrustBadge({ tier, size = 'sm' }: TrustBadgeProps) {
  if (!tier || !(tier in TIER_CONFIG)) return null;

  const config = TIER_CONFIG[tier as TrustTier];
  const fontSize = size === 'sm' ? '0.65rem' : '0.75rem';
  const padding = size === 'sm' ? '1px 4px' : '2px 6px';

  return (
    <span
      title={config.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        fontSize,
        padding,
        borderRadius: '3px',
        background: `${config.color}20`,
        color: config.color,
        fontWeight: 600,
        lineHeight: 1,
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
      }}
    >
      {config.symbol}
      {size === 'md' && <span style={{ marginLeft: '2px' }}>{config.label}</span>}
    </span>
  );
}

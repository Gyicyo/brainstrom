interface Props {
  roundNumber: number;
}

export default function RoundDivider({ roundNumber }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, margin: '24px 0',
      color: 'var(--primary)', fontSize: 14,
    }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontWeight: 600, letterSpacing: '0.02em' }}>Round {roundNumber}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

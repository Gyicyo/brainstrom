interface Props {
  roundNumber: number;
}

export default function RoundDivider({ roundNumber }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, margin: '24px 0',
      color: '#999', fontSize: 13,
    }}>
      <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
      <span style={{ fontWeight: 500 }}>Round {roundNumber}</span>
      <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
    </div>
  )
}

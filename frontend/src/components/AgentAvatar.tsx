interface Props {
  name: string;
  avatarUrl?: string;
  size?: number;
  isHuman?: boolean;
}

export default function AgentAvatar({ name, avatarUrl, size = 40, isHuman }: Props) {
  const initials = name.slice(0, 2).toUpperCase()
  const bgColor = isHuman ? 'var(--primary)' : 'var(--accent)'

  if (avatarUrl) {
    return <img src={avatarUrl} alt={name}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bgColor, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 'bold', fontSize: size * 0.4,
      flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}

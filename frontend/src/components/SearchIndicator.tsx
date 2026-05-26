interface Props {
  searchStatus?: { status: 'idle' | 'searching' | 'done' | 'failed'; query?: string }
}

export default function SearchIndicator({ searchStatus }: Props) {
  if (!searchStatus || searchStatus.status === 'idle') return null
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 'var(--radius)',
      background: searchStatus.status === 'searching' ? '#FEF3C7' : '#F3F4F6',
      fontSize: 11, color: searchStatus.status === 'searching' ? '#92400E' : '#6B7280',
      marginLeft: 6,
    }}>
      {searchStatus.status === 'searching' && <>🔍 搜索中{searchStatus.query ? `: "${searchStatus.query.slice(0, 40)}..."` : ''}</>}
      {searchStatus.status === 'done' && '🌐 已搜索'}
      {searchStatus.status === 'failed' && '🌐 搜索不可用'}
    </span>
  )
}

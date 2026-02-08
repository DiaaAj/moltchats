import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';
import { getServers } from '../api.js';
import { theme } from '../theme.js';


const styles = {
  container: {
    minHeight: '100vh',
    padding: '2rem',
    position: 'relative' as const,
  },
  header: {
    maxWidth: '900px',
    margin: '0 auto 2rem',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 700,
    marginBottom: '1rem',
    fontFamily: theme.fonts.heading,
  },
  searchRow: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1rem',
  },
  search: {
    flex: 1,
    padding: '0.6rem 1rem',
    background: '#16213e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#e0e0e0',
    fontSize: '1rem',
    outline: 'none',
  },
  sortBtn: (active: boolean) => ({
    padding: '0.6rem 1.2rem',
    background: active ? '#e94560' : '#16213e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#e0e0e0',
    cursor: 'pointer',
    fontSize: '0.9rem',
  }),
  grid: {
    maxWidth: '900px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '1rem',
  },
  card: {
    background: '#16213e',
    borderRadius: '12px',
    padding: '1.2rem',
    border: '1px solid rgba(255,255,255,0.08)',
    textDecoration: 'none',
    color: '#e0e0e0',
    display: 'block',
    transition: 'border-color 0.2s',
  },
  cardName: {
    fontSize: '1.1rem',
    fontWeight: 600,
    marginBottom: '0.3rem',
  },
  cardDesc: {
    fontSize: '0.85rem',
    color: '#a0a0b0',
    marginBottom: '0.6rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  cardMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.8rem',
    color: '#808090',
  },
  tags: {
    display: 'flex',
    gap: '0.3rem',
    flexWrap: 'wrap' as const,
    marginTop: '0.5rem',
  },
  tag: {
    background: 'rgba(233,69,96,0.15)',
    color: '#e94560',
    padding: '0.15rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
  },
  homeLink: {
    color: '#e94560',
    textDecoration: 'none',
    marginBottom: '1rem',
    display: 'inline-block',
  },
};

export function Explore() {
  const [servers, setServers] = useState<any[]>([]);
  const [sort, setSort] = useState('popular');
  const [search, setSearch] = useState('');

  useEffect(() => {
    getServers(sort).then(data => setServers(data.servers || [])).catch(() => {});
  }, [sort]);

  const filtered = search
    ? servers.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description?.toLowerCase().includes(search.toLowerCase()) ||
        s.tags?.some((t: string) => t.toLowerCase().includes(search.toLowerCase()))
      )
    : servers;

  return (
    <div style={styles.container}>
      <div style={{ ...styles.header, position: 'relative', zIndex: 1 }}>
        <Link to="/" style={{ ...styles.homeLink, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
          <ArrowLeft size={16} /> Home
        </Link>
        <h1 style={styles.title}>Explore Servers</h1>
        <div style={styles.searchRow}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#808090', pointerEvents: 'none' }} />
            <input
              style={{ ...styles.search, paddingLeft: '2.2rem', width: '100%' }}
              placeholder="Search servers..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {(['popular', 'new', 'hot'] as const).map(s => (
            <button key={s} style={styles.sortBtn(sort === s)} onClick={() => setSort(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div style={{ ...styles.grid, position: 'relative', zIndex: 1 }}>
        {filtered.map(server => (
          <Link key={server.id} to={`/servers/${server.id}`} style={styles.card}>
            <div style={styles.cardName}>{server.name}</div>
            <div style={styles.cardDesc}>{server.description || 'No description'}</div>
            <div style={styles.cardMeta}>
              <span>{server.memberCount || 0} members</span>
              <span>{new Date(server.createdAt).toLocaleDateString()}</span>
            </div>
            {server.tags?.length > 0 && (
              <div style={styles.tags}>
                {server.tags.map((t: string) => (
                  <span key={t} style={styles.tag}>{t}</span>
                ))}
              </div>
            )}
          </Link>
        ))}
        {filtered.length === 0 && (
          <div style={{ color: '#808090', gridColumn: '1/-1', textAlign: 'center', padding: '2rem' }}>
            No servers found
          </div>
        )}
      </div>
    </div>
  );
}

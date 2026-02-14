import { useState, useEffect } from 'react';
import { X, Bot, Star, Clock, Shield, Zap, ShieldCheck } from 'lucide-react';
import { getAgent } from '../api.js';
import { theme } from '../theme.js';
import { TrustBadge } from './TrustBadge.js';

interface AgentProfileModalProps {
  username: string | null;
  serverRole?: string;
  serverJoinedAt?: string;
  onClose: () => void;
}

const styles = {
  backdrop: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  modal: {
    background: '#16213e',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.1)',
    width: '380px',
    maxHeight: '80vh',
    overflowY: 'auto' as const,
    position: 'relative' as const,
  },
  closeBtn: {
    position: 'absolute' as const,
    top: 12,
    right: 12,
    background: 'rgba(255,255,255,0.08)',
    border: 'none',
    borderRadius: '6px',
    color: '#a0a0b0',
    padding: '0.3rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '1.5rem 1.5rem 1rem',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: '#e94560',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#fff',
    marginBottom: '0.75rem',
    overflow: 'hidden',
  },
  displayName: {
    fontSize: '1.2rem',
    fontWeight: 700,
    fontFamily: theme.fonts.heading,
    textAlign: 'center' as const,
  },
  username: {
    fontSize: '0.85rem',
    color: '#808090',
    marginTop: '0.15rem',
  },
  presence: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    marginTop: '0.5rem',
    fontSize: '0.8rem',
    color: '#a0a0b0',
  },
  statusDot: (presence: string) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: presence === 'online' ? '#43b581' : presence === 'idle' ? '#faa61a' : '#747f8d',
  }),
  body: {
    padding: '1rem 1.5rem 1.5rem',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.8rem',
  },
  bio: {
    fontSize: '0.9rem',
    color: '#c0c0d0',
    lineHeight: 1.5,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: '8px',
    padding: '0.7rem',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.85rem',
    color: '#a0a0b0',
  },
  label: {
    color: '#808090',
    minWidth: '5rem',
  },
  value: {
    color: '#e0e0e0',
  },
  caps: {
    display: 'flex',
    gap: '0.3rem',
    flexWrap: 'wrap' as const,
  },
  capTag: {
    background: 'rgba(233,69,96,0.15)',
    color: '#e94560',
    padding: '0.15rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
  },
  section: {
    borderTop: '1px solid rgba(255,255,255,0.08)',
    paddingTop: '0.8rem',
  },
  sectionLabel: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#808090',
    textTransform: 'uppercase' as const,
    marginBottom: '0.5rem',
  },
};

export function AgentProfileModal({ username, serverRole, serverJoinedAt, onClose }: AgentProfileModalProps) {
  const [agent, setAgent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    setError(false);
    setAgent(null);
    getAgent(username)
      .then(setAgent)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [username]);

  if (!username) return null;

  const presence: string = agent?.presence ?? 'offline';

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <button style={styles.closeBtn} onClick={onClose}>
          <X size={16} />
        </button>

        {loading && (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#808090' }}>Loading...</div>
        )}

        {error && (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#808090' }}>Agent not found</div>
        )}

        {agent && (
          <>
            <div style={styles.header}>
              <div style={styles.avatar}>
                {agent.avatarUrl
                  ? <img src={agent.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (agent.displayName || agent.username || '?')[0].toUpperCase()
                }
              </div>
              <div style={styles.displayName}>{agent.displayName || agent.username}</div>
              <div style={styles.username}>@{agent.username}</div>
              <div style={styles.presence}>
                <div style={styles.statusDot(presence)} />
                {presence === 'online'
                  ? 'Online'
                  : presence === 'idle'
                    ? 'Idle'
                    : agent.lastSeenAt
                      ? `Last seen ${new Date(agent.lastSeenAt).toLocaleDateString()}`
                      : 'Offline'
                }
              </div>
            </div>

            <div style={styles.body}>
              {agent.bio && <div style={styles.bio}>{agent.bio}</div>}

              <div style={styles.row}>
                <Bot size={14} style={{ flexShrink: 0 }} />
                <span style={styles.label}>Type</span>
                <span style={styles.value}>{agent.agentType || 'Unknown'}</span>
              </div>

              <div style={styles.row}>
                <Star size={14} style={{ flexShrink: 0 }} />
                <span style={styles.label}>Karma</span>
                <span style={styles.value}>{agent.karma ?? 0}</span>
              </div>

              <div style={styles.row}>
                <ShieldCheck size={14} style={{ flexShrink: 0 }} />
                <span style={styles.label}>Trust</span>
                <span style={styles.value}>
                  <TrustBadge tier={agent.trustTier} size="md" />
                </span>
              </div>

              <div style={styles.row}>
                <Clock size={14} style={{ flexShrink: 0 }} />
                <span style={styles.label}>Joined</span>
                <span style={styles.value}>{new Date(agent.createdAt).toLocaleDateString()}</span>
              </div>

              {agent.capabilities?.length > 0 && (
                <div>
                  <div style={{ ...styles.row, marginBottom: '0.4rem' }}>
                    <Zap size={14} style={{ flexShrink: 0 }} />
                    <span style={styles.label}>Capabilities</span>
                  </div>
                  <div style={styles.caps}>
                    {agent.capabilities.map((cap: string) => (
                      <span key={cap} style={styles.capTag}>{cap}</span>
                    ))}
                  </div>
                </div>
              )}

              {(serverRole || serverJoinedAt) && (
                <div style={styles.section}>
                  <div style={styles.sectionLabel}>Server membership</div>
                  {serverRole && (
                    <div style={styles.row}>
                      <Shield size={14} style={{ flexShrink: 0 }} />
                      <span style={styles.label}>Role</span>
                      <span style={styles.value}>{serverRole}</span>
                    </div>
                  )}
                  {serverJoinedAt && (
                    <div style={{ ...styles.row, marginTop: '0.3rem' }}>
                      <Clock size={14} style={{ flexShrink: 0 }} />
                      <span style={styles.label}>Since</span>
                      <span style={styles.value}>{new Date(serverJoinedAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

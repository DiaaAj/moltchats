import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, ChevronDown, Hash, Users, EyeOff } from 'lucide-react';
import { getServer, getServerChannels, getChannelMessages, getServerMembers } from '../api.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { theme } from '../theme.js';
import { AgentProfileModal } from '../components/AgentProfileModal.js';
import { TrustBadge } from '../components/TrustBadge.js';

const styles = {
  layout: {
    display: 'grid',
    gridTemplateColumns: '240px 1fr 240px',
    height: '100vh',
    background: '#1a1a2e',
    position: 'relative' as const,
    zIndex: 1,
  },
  sidebar: {
    background: '#16213e',
    borderRight: '1px solid rgba(255,255,255,0.08)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  sidebarHeader: {
    padding: '1rem',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    fontWeight: 700,
    fontSize: '1.1rem',
    fontFamily: theme.fonts.heading,
  },
  channelList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '0.5rem',
  },
  category: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#808090',
    textTransform: 'uppercase' as const,
    padding: '0.5rem 0.5rem 0.2rem',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  channel: (active: boolean) => ({
    padding: '0.4rem 0.8rem',
    borderRadius: '6px',
    cursor: 'pointer',
    background: active ? 'rgba(233,69,96,0.2)' : 'transparent',
    color: active ? '#fff' : '#a0a0b0',
    fontSize: '0.9rem',
    marginBottom: '1px',
  }),
  chatArea: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  chatHeader: {
    padding: '0.8rem 1rem',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    fontWeight: 600,
    fontFamily: theme.fonts.heading,
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
  },
  chatMessages: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '1rem',
  },
  message: {
    marginBottom: '1rem',
    display: 'flex',
    gap: '0.8rem',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: '#e94560',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
  },
  msgContent: {
    flex: 1,
  },
  msgAuthor: {
    fontWeight: 600,
    fontSize: '0.9rem',
    marginBottom: '0.2rem',
  },
  msgText: {
    fontSize: '0.9rem',
    color: '#c0c0d0',
    lineHeight: 1.4,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  msgTime: {
    fontSize: '0.7rem',
    color: '#606070',
    marginLeft: '0.5rem',
  },
  memberPanel: {
    background: '#16213e',
    borderLeft: '1px solid rgba(255,255,255,0.08)',
    padding: '1rem',
    overflowY: 'auto' as const,
  },
  memberHeader: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#808090',
    textTransform: 'uppercase' as const,
    marginBottom: '0.5rem',
  },
  member: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.3rem 0',
    fontSize: '0.9rem',
  },
  statusDot: (presence: string) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: presence === 'online' ? '#43b581' : presence === 'idle' ? '#faa61a' : '#747f8d',
  }),
  readOnly: {
    padding: '0.8rem 1rem',
    background: '#0f3460',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    textAlign: 'center' as const,
    fontSize: '0.85rem',
    color: '#a0a0b0',
  },
  backLink: {
    color: '#e94560',
    textDecoration: 'none',
    fontSize: '0.85rem',
    display: 'block',
    padding: '0.5rem 1rem',
  },
};

interface Message {
  id: string;
  content: string;
  agent: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  createdAt: string;
  contentType: string;
  trustTier?: string;
}

export function Server() {
  const { serverId } = useParams<{ serverId: string }>();
  const [server, setServer] = useState<any>(null);
  const [channels, setChannels] = useState<Record<string, any[]>>({});
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedMember, setSelectedMember] = useState<any | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const wsChannels = useMemo(() => activeChannelId ? [activeChannelId] : [], [activeChannelId]);
  const { messages: wsMessages, presence, typing } = useWebSocket(wsChannels);
  const [activeTyping, setActiveTyping] = useState<string[]>([]);

  useEffect(() => {
    if (!serverId) return;
    getServer(serverId).then(setServer).catch(() => {});
    getServerChannels(serverId).then(data => {
      setChannels(data.channels || {});
      // Select first channel
      const allChannels = Object.values(data.channels || {}).flat();
      if (allChannels.length > 0 && !activeChannelId) {
        setActiveChannelId(allChannels[0].id);
      }
    }).catch(() => {});
    getServerMembers(serverId).then(data => setMembers(data.members || [])).catch(() => {});
  }, [serverId]);

  useEffect(() => {
    if (!activeChannelId) return;
    getChannelMessages(activeChannelId).then(msgs => {
      setChatMessages((msgs || []).reverse());
    }).catch(() => {});
  }, [activeChannelId]);

  // Append WebSocket messages
  useEffect(() => {
    if (wsMessages.length === 0) return;
    const latest = wsMessages[wsMessages.length - 1];
    if (latest.channel === activeChannelId) {
      setChatMessages(prev => [...prev, {
        id: latest.id,
        content: latest.content,
        agent: latest.agent,
        createdAt: latest.timestamp,
        contentType: latest.contentType,
        trustTier: latest.trustTier,
      } as Message]);
    }
  }, [wsMessages, activeChannelId]);

  // Update member presence from WebSocket
  useEffect(() => {
    if (!presence || presence.channel !== activeChannelId) return;
    const onlineSet = new Set(presence.online);
    setMembers(prev => prev.map(m => ({
      ...m,
      presence: onlineSet.has(m.agentId) ? 'online' : 'offline',
    })));
  }, [presence, activeChannelId]);

  // Track typing indicators with 5s expiry
  useEffect(() => {
    const active = typing
      .filter(t => t.channel === activeChannelId && Date.now() - t.receivedAt < 5000)
      .map(t => t.agent);
    setActiveTyping(active);

    if (active.length > 0) {
      const timer = setTimeout(() => {
        setActiveTyping(
          typing
            .filter(t => t.channel === activeChannelId && Date.now() - t.receivedAt < 5000)
            .map(t => t.agent)
        );
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [typing, activeChannelId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const toggleCategory = (cat: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const activeChannel = Object.values(channels).flat().find(c => c.id === activeChannelId);

  return (
    <div style={styles.layout}>
      {/* Channel sidebar */}
      <div style={styles.sidebar}>
        <Link to="/explore" style={{ ...styles.backLink, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <ArrowLeft size={16} /> Explore
        </Link>
        <div style={styles.sidebarHeader}>{server?.name || 'Loading...'}</div>
        <div style={styles.channelList}>
          {Object.entries(channels).map(([category, chs]) => (
            <div key={category}>
              <div style={{ ...styles.category, display: 'flex', alignItems: 'center', gap: '0.2rem' }} onClick={() => toggleCategory(category)}>
                {collapsed.has(category) ? <ChevronRight size={14} /> : <ChevronDown size={14} />} {category || 'Channels'}
              </div>
              {!collapsed.has(category) && chs.map(ch => (
                <div
                  key={ch.id}
                  style={styles.channel(ch.id === activeChannelId)}
                  onClick={() => setActiveChannelId(ch.id)}
                >
                  <Hash size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4, flexShrink: 0 }} />{ch.name}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div style={styles.chatArea}>
        <div style={styles.chatHeader}>
          <Hash size={18} style={{ flexShrink: 0 }} /> {activeChannel?.name || '...'} {activeChannel?.topic && <span style={{ fontWeight: 400, color: '#808090', fontSize: '0.85rem', marginLeft: '0.5rem' }}>{activeChannel.topic}</span>}
        </div>
        <div style={styles.chatMessages}>
          {chatMessages.map(msg => (
            <div key={msg.id} style={styles.message}>
              <div style={styles.avatar}>
                {(msg.agent?.displayName || msg.agent?.username || '?')[0].toUpperCase()}
              </div>
              <div style={styles.msgContent}>
                <div style={styles.msgAuthor}>
                  <span
                    style={{ cursor: 'pointer' }}
                    onClick={() => msg.agent?.username && setSelectedMember({ username: msg.agent.username })}
                  >
                    {msg.agent?.displayName || msg.agent?.username}
                  </span>
                  {msg.trustTier && <TrustBadge tier={msg.trustTier} />}
                  <span style={styles.msgTime}>
                    {new Date(msg.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div style={styles.msgText}>{msg.content}</div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        {activeTyping.length > 0 && (
          <div style={{ padding: '0.3rem 1rem', fontSize: '0.8rem', color: '#a0a0b0', fontStyle: 'italic' }}>
            {activeTyping.length > 5
              ? 'Many agents are typing...'
              : `${activeTyping.join(', ')} ${activeTyping.length === 1 ? 'is' : 'are'} typing...`}
          </div>
        )}
        <div style={{ ...styles.readOnly, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
          <EyeOff size={16} /> You are observing in read-only mode. Only AI agents can post messages.
        </div>
      </div>

      {selectedMember && (
        <AgentProfileModal
          username={selectedMember.username}
          serverRole={selectedMember.role}
          serverJoinedAt={selectedMember.joinedAt}
          onClose={() => setSelectedMember(null)}
        />
      )}

      {/* Member panel */}
      <div style={styles.memberPanel}>
        <div style={{ ...styles.memberHeader, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Users size={14} /> Members — {members.length}
        </div>
        {members.map(m => (
          <div
            key={m.agentId || m.id}
            style={{ ...styles.member, cursor: 'pointer' }}
            onClick={() => setSelectedMember(m)}
          >
            <div style={styles.statusDot(m.presence ?? 'offline')} />
            <span>{m.displayName || m.username}</span>
            {m.trustTier && <TrustBadge tier={m.trustTier} />}
          </div>
        ))}
      </div>
    </div>
  );
}

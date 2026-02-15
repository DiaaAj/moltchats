import { useEffect, useRef, useState, useCallback } from 'react';

interface WsMessage {
  op: string;
  [key: string]: any;
}

export interface WsPresence {
  channel: string;
  online: string[];
}

export interface WsTyping {
  channel: string;
  agent: string;
  receivedAt: number;
}

export function useWebSocket(channels: string[]) {
  const wsRef = useRef<WebSocket | null>(null);
  const destroyedRef = useRef(false);
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [presence, setPresence] = useState<WsPresence | null>(null);
  const [typing, setTyping] = useState<WsTyping[]>([]);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (channels.length > 0) {
        ws.send(JSON.stringify({ op: 'subscribe', channels }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as WsMessage;
        switch (data.op) {
          case 'message':
            setMessages(prev => [...prev, data]);
            break;
          case 'presence':
            setPresence({ channel: data.channel, online: data.online });
            break;
          case 'typing':
            setTyping(prev => {
              // Deduplicate: replace existing entry for same agent+channel
              const filtered = prev.filter(t => !(t.agent === data.agent && t.channel === data.channel));
              return [...filtered, { channel: data.channel, agent: data.agent, receivedAt: Date.now() }];
            });
            break;
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setConnected(false);
      if (!destroyedRef.current) {
        setTimeout(connect, 3000);
      }
    };

    return ws;
  }, [channels]);

  useEffect(() => {
    destroyedRef.current = false;
    const ws = connect();
    return () => {
      destroyedRef.current = true;
      ws.close();
    };
  }, [connect]);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, presence, typing, connected, clearMessages };
}

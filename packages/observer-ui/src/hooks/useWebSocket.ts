import { useEffect, useRef, useState, useCallback } from 'react';

interface WsMessage {
  op: string;
  [key: string]: any;
}

export function useWebSocket(channels: string[]) {
  const wsRef = useRef<WebSocket | null>(null);
  const [messages, setMessages] = useState<WsMessage[]>([]);
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
        if (data.op === 'message') {
          setMessages(prev => [...prev, data]);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 3s
      setTimeout(connect, 3000);
    };

    return ws;
  }, [channels]);

  useEffect(() => {
    const ws = connect();
    return () => { ws.close(); };
  }, [connect]);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, connected, clearMessages };
}

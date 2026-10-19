'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type QueueItem = { table: string; data: any };

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  // refs always hold the latest values, so sync() never uses stale data
  const queueRef = useRef<QueueItem[]>([]);
  const onlineRef = useRef(true);
  const busy = useRef(false);

  const saveQueue = (q: QueueItem[]) => {
    queueRef.current = q;
    setQueue(q);
    localStorage.setItem('sync_queue', JSON.stringify(q));
  };

  const sync = useCallback(async () => {
    if (busy.current || !onlineRef.current || !supabase || queueRef.current.length === 0) return;
    busy.current = true;
    setSyncing(true);
    const snapshot = [...queueRef.current];
    const failed: QueueItem[] = [];
    for (const item of snapshot) {
      try {
        const { error } = await supabase.from(item.table).upsert(item.data);
        if (error) failed.push(item); // keep it, retry later
      } catch {
        failed.push(item); // network died mid-way, keep it
      }
    }
    // anything added while we were syncing stays in the queue
    const added = queueRef.current.filter((i) => !snapshot.includes(i));
    saveQueue([...failed, ...added]);
    busy.current = false;
    setSyncing(false);
  }, []);

  const addToQueue = useCallback((item: QueueItem) => {
    saveQueue([...queueRef.current, item]);
    if (onlineRef.current) setTimeout(sync, 0);
  }, [sync]);

  useEffect(() => {
    queueRef.current = JSON.parse(localStorage.getItem('sync_queue') || '[]');
    setQueue(queueRef.current);
    onlineRef.current = navigator.onLine;
    setIsOnline(navigator.onLine);

    const goOnline = () => { onlineRef.current = true; setIsOnline(true); sync(); };
    const goOffline = () => { onlineRef.current = false; setIsOnline(false); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const timer = setInterval(() => { if (onlineRef.current) sync(); }, 10000);
    sync();
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(timer);
    };
  }, [sync]);

  return { isOnline, queue, syncing, addToQueue, sync };
}

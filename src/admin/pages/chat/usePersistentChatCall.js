import { useContext, useEffect } from 'react';
import { ChatCallContext } from './chatCallContext';

export function usePersistentChatCall(channel, actor) {
  const call = useContext(ChatCallContext);
  if (!call) throw new Error('ChatCallProvider topilmadi.');
  const { configure } = call;
  useEffect(() => {
    configure(channel, actor);
  }, [configure, channel, actor]);
  return call;
}

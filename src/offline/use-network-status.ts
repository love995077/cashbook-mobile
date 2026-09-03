import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/**
 * Whether the device can currently reach the internet.
 *
 * `isInternetReachable` is deliberately preferred over `isConnected`: being
 * joined to a Wi-Fi network says nothing about whether traffic gets out of it,
 * and a captive portal at a site office looks exactly like a working
 * connection to `isConnected`. It starts as null while NetInfo probes, which
 * is treated as "assume online" so the first load is not held back.
 */
export function useNetworkStatus(): { isOnline: boolean; isProbing: boolean } {
  const [state, setState] = useState<{ isOnline: boolean; isProbing: boolean }>({
    isOnline: true,
    isProbing: true,
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((status) => {
      const reachable = status.isInternetReachable;
      setState({
        isOnline: reachable === null ? !!status.isConnected : reachable,
        isProbing: reachable === null,
      });
    });

    return unsubscribe;
  }, []);

  return state;
}

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackRoutePageView } from './applicationInsights';

export default function TelemetryRouteTracker() {
  const { pathname } = useLocation();
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    if (previousPathname.current === pathname) {
      return;
    }
    previousPathname.current = pathname;
    trackRoutePageView(pathname);
  }, [pathname]);

  return null;
}

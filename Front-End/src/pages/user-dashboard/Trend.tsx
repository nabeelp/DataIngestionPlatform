import { TrendingDown, TrendingUp } from 'lucide-react';
import { percentChange, type PeriodMetric } from './dashboardModel';

/**
 * Trend badge. `higherIsBetter` controls colour; the arrow follows the direction of change.
 */
export default function Trend({ metric, higherIsBetter, days }: { metric: PeriodMetric; higherIsBetter: boolean; days: number }) {
  const change = percentChange(metric);
  if (change === null) {
    return <span className="text-[11px] text-slate-400">No data for previous {days} days</span>;
  }
  const good = change === 0 || (change > 0) === higherIsBetter;
  const Icon = change >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${good ? 'text-emerald-600' : 'text-rose-600'}`}>
      <Icon className="w-3 h-3" /> {change > 0 ? '+' : ''}{change}% <span className="text-slate-400 font-normal">vs previous {days} days</span>
    </span>
  );
}

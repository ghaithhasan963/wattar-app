/**
 * Wattar Admin — بطاقة إحصائية
 */
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

interface StatCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  color?: 'wattar' | 'gold' | 'green' | 'blue' | 'red';
  link?: string;
  children?: ReactNode;
}

const colorClasses: Record<string, { bg: string; text: string; border: string }> = {
  wattar: { bg: 'bg-wattar-500/10', text: 'text-wattar-400', border: 'border-wattar-500/20' },
  gold: { bg: 'bg-gold-500/10', text: 'text-gold-500', border: 'border-gold-500/20' },
  green: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  red: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
};

export function StatCard({ title, value, icon: Icon, color = 'wattar', link }: StatCardProps) {
  const colors = colorClasses[color];

  const content = (
    <div className={clsx(
      'rounded-xl border bg-dark-surface p-6 transition-colors',
      colors.border,
      link && 'hover:bg-dark-elevated',
    )}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">{title}</p>
        <div className={clsx('rounded-lg p-2', colors.bg)}>
          <Icon className={colors.text} size={20} />
        </div>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );

  if (link) {
    return <Link to={link}>{content}</Link>;
  }
  return content;
}

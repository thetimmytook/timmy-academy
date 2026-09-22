export function counted(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

export function resolution(value: { width: number; height: number } | null): string {
  return value ? `${value.width} × ${value.height}` : 'Unknown';
}

export function execution(value: string): 'BSG servers' | 'Local' {
  return value === 'bsg_servers' ? 'BSG servers' : 'Local';
}

export function number(value: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);
}

export function words(value: string): string {
  const text = value.replaceAll('_', ' ');

  return text.charAt(0).toUpperCase() + text.slice(1);
}

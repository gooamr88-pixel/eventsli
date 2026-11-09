import { View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';

import { Text } from './Text';
import { colors } from './theme';

/**
 * The dashboard's ring: checked in against everyone expected. A full circle of
 * track with the admitted share drawn over it, starting at twelve o'clock.
 */
export function Ring({
  value, total, size = 148, stroke = 16, label, sublabel,
}: { value: number; total: number; size?: number; stroke?: number; label: string; sublabel: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const share = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityLabel={`${label} ${sublabel}, ${Math.round(share * 100)} percent`}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.teal100} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap={share > 0 && share < 1 ? 'round' : 'butt'}
          strokeDasharray={`${c * share} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text variant="heading" style={{ fontVariant: ['tabular-nums'] }}>{label}</Text>
      <Text variant="small" color={colors.muted}>{sublabel}</Text>
    </View>
  );
}

/** Arrivals per time bucket. Plain bars, the tallest one labelled. */
export function Bars({
  values, height = 120, color = colors.accent,
}: { values: number[]; height?: number; color?: string }) {
  const max = Math.max(1, ...values);
  const n = Math.max(values.length, 1);
  const gap = n > 24 ? 1 : 3;
  const width = 100;
  const bar = (width - gap * (n - 1)) / n;
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {values.map((v, i) => {
        const h = Math.max(v > 0 ? 2 : 0, (v / max) * (height - 4));
        return (
          <Rect key={i} x={i * (bar + gap)} y={height - h} width={bar} height={h} rx={1} fill={color} />
        );
      })}
    </Svg>
  );
}

/** One horizontal share bar: "General Admission — 412 of 500". */
export function ShareBar({ value, total, color = colors.accent }: { value: number; total: number; color?: string }) {
  const share = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.teal50, overflow: 'hidden' }}>
      <View style={{ width: `${share * 100}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
    </View>
  );
}

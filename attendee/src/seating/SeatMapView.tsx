import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { money } from '@/lib/format';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { colors, fonts, radius, shadow } from '@/ui/theme';

import { clampView, fitView, hitTest, keepView, OPEN_SEAT, SEAT_RADIUS, type Box, type MapModel, type MapSeat, type MapTable, type PlacedTable } from './model';
import { ZoneShape } from './ZoneShape';

/**
 * THE SEAT MAP — the organizer's own floor plan, on a phone.
 *
 * What the buyer sees is the room as it was drawn in the Venue Studio: the
 * stage and the bars where they are, every table in its shape and turn, every
 * seat where the website puts it (src/seating/model.ts imports the website's
 * geometry rather than copying it). Seats are coloured by ticket type when
 * there is more than one, as the website's legend reads.
 *
 * MOVING AROUND. Pan with one finger, pinch with two; + and − zoom about the
 * centre; ⤢ fits the whole room again, which is how it opens. While a gesture
 * runs the map is moved as a picture on the UI thread (smooth); when it ends,
 * the picture is redrawn crisp at the new zoom (a new viewBox) — an SVG
 * scaled as a bitmap is blurry at 4×, which is exactly when a buyer is
 * reading seat numbers.
 *
 * CHOOSING. A tap is converted to the room's own units and hit-tested against
 * the seats and the tables (`hitTest`): one gesture recogniser for the whole
 * map, not a touch handler on each of two thousand circles. The finger's reach
 * is ~20 pt on screen whatever the zoom, so a seat is as easy to hit fitted as
 * zoomed in. Seat numbers appear once seats are big enough to read them.
 */
type Props = {
  model: MapModel;
  currency: string;
  selectedSeatIds?: Set<string>;
  selectedTableId?: string | null;
  /** Ticket types picked out in the legend; the rest are dimmed, never disabled. */
  focusTiers?: Set<string> | null;
  hideTaken?: boolean;
  canPickTables?: boolean;
  onSeat?: (seat: MapSeat) => void;
  onTable?: (table: MapTable) => void;
  /** False for the event page's preview: no gestures, no controls. */
  interactive?: boolean;
  style?: ViewStyle;
};

const FINGER = 20; // points
const TAKEN = '#c4c4cc';

export function SeatMapView({
  model, currency, selectedSeatIds, selectedTableId = null, focusTiers = null, hideTaken = false,
  canPickTables = true, onSeat, onTable, interactive = true, style,
}: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<Box | null>(null);
  const [fittedFor, setFittedFor] = useState({ size: '', bounds: '' });
  // Whether the person has moved the map since it was last fitted.
  const [moved, setMoved] = useState(false);

  // Open fitted, and follow the box when it changes size (rotation, split
  // view, the selection bar growing under it). Adjusted during render, React's
  // pattern for state that follows a prop — no extra frame of a wrong view.
  //
  // THE MAP MOVES ONLY WHEN THE PERSON MOVES IT (owner, 2026-11-19). Until
  // they have, a new size is fitted afresh; after they have zoomed in on
  // their row, a new size keeps their zoom and their centre — it never jumps
  // back out to the whole room. A different map (new bounds) is fitted.
  const sizeKey = `${Math.round(size.w)}x${Math.round(size.h)}`;
  const boundsKey = `${model.bounds.x},${model.bounds.y},${model.bounds.width},${model.bounds.height}`;
  if (size.w > 0 && (sizeKey !== fittedFor.size || boundsKey !== fittedFor.bounds)) {
    const before = Number(fittedFor.size.split('x')[0]) || 0;
    setFittedFor({ size: sizeKey, bounds: boundsKey });
    if (moved && view && before > 0 && boundsKey === fittedFor.bounds) {
      setView(keepView(view, before, size.w, size.h, model.bounds));
    } else {
      setView(fitView(model.bounds, size.w, size.h));
      if (moved) setMoved(false);
    }
  }

  // ── the live gesture, as a transform on the UI thread ──
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sc = useSharedValue(1);
  const active = useSharedValue(0);
  const minS = useSharedValue(0.5);
  const maxS = useSharedValue(4);
  const cx = useSharedValue(0);
  const cy = useSharedValue(0);
  const resetPending = useRef(false);
  // The gesture callbacks are handed to the native recogniser and may outlive
  // a render: they read the view, the size and the handlers through refs, so a
  // pinch that ends after a re-render still lands on the current view.
  const live = useRef({ view, size, onSeat, onTable, canPickTables });
  useLayoutEffect(() => { live.current = { view, size, onSeat, onTable, canPickTables }; });

  // How far the zoom can go from here, so a pinch stops where clampView would.
  useLayoutEffect(() => {
    if (!view || !size.w) return;
    const fit = fitView(model.bounds, size.w, size.h);
    const minW = Math.min(fit.width, SEAT_RADIUS * 2 * 9);
    minS.value = view.width / (fit.width * 1.25);
    maxS.value = view.width / minW;
    cx.value = size.w / 2;
    cy.value = size.h / 2;
    if (resetPending.current) {
      resetPending.current = false;
      tx.value = 0;
      ty.value = 0;
      sc.value = 1;
    }
  }, [view, size, model.bounds, minS, maxS, cx, cy, tx, ty, sc]);

  /** The gesture ended: redraw at the new view, then drop the transform. */
  const commit = (s: number, x: number, y: number) => {
    const { view, size } = live.current;
    if (!view || !size.w || (s === 1 && x === 0 && y === 0)) return;
    const k = view.width / size.w; // world units per point
    const halfW = size.w / 2;
    const halfH = size.h / 2;
    // The content point now at the screen's top-left corner.
    const qx = (-halfW - x) / s + halfW;
    const qy = (-halfH - y) / s + halfH;
    resetPending.current = true;
    setMoved(true);
    setView(clampView({ x: view.x + qx * k, y: view.y + qy * k, width: view.width / s, height: view.height / s }, model.bounds, size.w / size.h));
  };

  const handleTap = (px: number, py: number) => {
    const { view, size, onSeat, onTable, canPickTables } = live.current;
    if (!view || !size.w) return;
    const k = view.width / size.w;
    const hit = hitTest(model, view.x + px * k, view.y + py * k, FINGER * k);
    if (!hit) return;
    if (hit.kind === 'seat') {
      if (hit.placed.seat) onSeat?.(hit.placed.seat);
    } else if (canPickTables) {
      onTable?.(hit.table.table);
    }
  };

  // Shared values are read and written with get()/set() here — the form the
  // React Compiler accepts inside callbacks (Reanimated 4).
  const pan = usePanGesture({
    enabled: interactive,
    maxPointers: 2,
    onBegin: () => { 'worklet'; active.set(active.get() + 1); },
    onUpdate: (e) => { 'worklet'; tx.set(tx.get() + e.changeX); ty.set(ty.get() + e.changeY); },
    onFinalize: () => {
      'worklet';
      active.set(Math.max(0, active.get() - 1));
      if (active.get() === 0) scheduleOnRN(commit, sc.get(), tx.get(), ty.get());
    },
  });
  const pinch = usePinchGesture({
    enabled: interactive,
    onBegin: () => { 'worklet'; active.set(active.get() + 1); },
    onUpdate: (e) => {
      'worklet';
      const s = sc.get();
      const next = Math.min(maxS.get(), Math.max(minS.get(), s * e.scaleChange));
      const k = next / s;
      // Keep the point between the fingers where it is.
      tx.set(e.focalX - cx.get() - (e.focalX - cx.get() - tx.get()) * k);
      ty.set(e.focalY - cy.get() - (e.focalY - cy.get() - ty.get()) * k);
      sc.set(next);
    },
    onFinalize: () => {
      'worklet';
      active.set(Math.max(0, active.get() - 1));
      if (active.get() === 0) scheduleOnRN(commit, sc.get(), tx.get(), ty.get());
    },
  });
  const tap = useTapGesture({
    enabled: interactive,
    maxDistance: 12,
    onActivate: (e) => { 'worklet'; scheduleOnRN(handleTap, e.x, e.y); },
  });
  const gesture = useSimultaneousGestures(pan, pinch, tap);

  const moving = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sc.value }],
  }));

  /** + and −: an animated zoom about the centre, then the crisp redraw. */
  const zoomBy = (f: number) => {
    const target = Math.min(maxS.get(), Math.max(minS.get(), f));
    sc.set(withTiming(target, { duration: 220 }, (done) => {
      'worklet';
      if (done) scheduleOnRN(commit, target, 0, 0);
    }));
  };
  const fitAll = () => {
    if (!size.w) return;
    setMoved(false);
    setView(fitView(model.bounds, size.w, size.h));
  };

  // ── the drawing ──
  const floor = model.look?.floor || '#f4f4f7';
  const scenery = useMemo(() => (
    <>
      {model.plates.map((p) => (
        <Path key={p.key} d={p.d} fill={p.color} fillOpacity={0.12} stroke={p.color} strokeOpacity={0.35} strokeWidth={2} strokeLinejoin="round" />
      ))}
      {model.zones.map((z) => <ZoneShape key={z.id} zone={z} world={model.world} floor={floor} />)}
    </>
  ), [model, floor]);

  const tables = useMemo(() => model.tables.map((t) => (
    <TableBody key={t.table.id} t={t} selected={selectedTableId === t.table.id} bookable={canPickTables && t.table.canBookWhole} />
  )), [model, selectedTableId, canPickTables]);

  const seatPaint = useMemo(() => new Map(model.tables.map((t) => [t.table.id, t.paint.seat])), [model]);
  const seats = useMemo(() => model.seats.map((p, i) => {
    const s = p.seat;
    const tableChosen = selectedTableId !== null && p.tableId === selectedTableId;
    const chosen = tableChosen || Boolean(s && selectedSeatIds?.has(s.id));
    const open = Boolean(s?.available);
    const own = seatPaint.get(p.tableId);
    const fill = chosen ? colors.accent
      : !open ? TAKEN
        : own || (model.byTier && s?.tierId ? model.palette.get(s.tierId) : null) || model.look?.seat || OPEN_SEAT;
    const dim = !chosen && focusTiers && s ? !focusTiers.has(s.tierId ?? '') : false;
    const opacity = chosen ? 1 : !open ? (hideTaken ? 0.12 : 0.55) : dim ? 0.22 : 1;
    return (
      <G key={s?.id ?? `${p.tableId}-${i}`}>
        {chosen ? <Circle cx={p.x} cy={p.y} r={p.r * 1.6} fill="none" stroke={colors.accent} strokeWidth={1.6} strokeOpacity={0.35} /> : null}
        <Circle cx={p.x} cy={p.y} r={p.r} fill={fill} opacity={opacity} stroke={chosen ? '#ffffff' : 'none'} strokeWidth={chosen ? 2 : 0} />
      </G>
    );
  }), [model, seatPaint, selectedSeatIds, selectedTableId, focusTiers, hideTaken]);

  // Seat numbers, once a seat is drawn at least ~11 pt across — and only for
  // the seats on screen, so a zoomed-in stadium does not lay out 30,000 labels.
  const pxPerUnit = view && size.w ? size.w / view.width : 0;
  const numbers = useMemo(() => {
    if (!view || SEAT_RADIUS * pxPerUnit < 9) return null;
    const pad = SEAT_RADIUS * 2;
    return model.seats.filter((p) => p.x > view.x - pad && p.x < view.x + view.width + pad && p.y > view.y - pad && p.y < view.y + view.height + pad)
      .map((p, i) => {
        const chosen = (selectedTableId !== null && p.tableId === selectedTableId) || Boolean(p.seat && selectedSeatIds?.has(p.seat.id));
        return (
          <SvgText key={`${p.seat?.id ?? i}-n`} x={p.x} y={p.y + p.r * 0.36} fontSize={p.r * 0.95} fontFamily={fonts.bold}
            textAnchor="middle" fill={chosen || p.seat?.available ? '#ffffff' : '#6b6b75'}>
            {p.number}
          </SvgText>
        );
      });
  }, [model, view, pxPerUnit, selectedSeatIds, selectedTableId]);

  const zoomPct = view ? Math.round((fitView(model.bounds, size.w || 1, size.h || 1).width / view.width) * 100) : 100;

  return (
    <View
      style={[styles.box, { backgroundColor: floor }, style]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      pointerEvents={interactive ? 'auto' : 'none'}
      accessibilityLabel={interactive ? 'Seat map. Pinch to zoom, tap a seat to choose it.' : 'Seat map preview'}
    >
      {view && size.w ? (
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            <Animated.View style={[StyleSheet.absoluteFill, moving]}>
              <Svg width={size.w} height={size.h} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}>
                {scenery}
                {tables}
                {seats}
                {model.tables.map((t) => <TableLabel key={`${t.table.id}-l`} t={t} bookable={canPickTables && t.table.canBookWhole} currency={currency} />)}
                {numbers}
              </Svg>
            </Animated.View>
          </View>
        </GestureDetector>
      ) : null}

      {interactive ? (
        <View style={styles.controls}>
          <View style={[styles.pill, shadow.card]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" onPress={() => zoomBy(1 / 1.6)} hitSlop={6} style={styles.ctl}>
              <Icon name="minus" size={18} />
            </Pressable>
            <Text variant="caption" weight="semibold" style={styles.pct} align="center" accessibilityLiveRegion="polite">{zoomPct}%</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" onPress={() => zoomBy(1.6)} hitSlop={6} style={styles.ctl}>
              <Icon name="plus" size={18} />
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Show the whole map" onPress={fitAll} style={[styles.fit, shadow.card]}>
            <Icon name="grid" size={18} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function TableBody({ t, selected, bookable }: { t: PlacedTable; selected: boolean; bookable: boolean }) {
  const { body, paint } = t;
  if (body.kind === 'none') return null;
  const fill = selected ? colors.coral50 : paint.fill || '#ffffff';
  const stroke = selected ? colors.accent : paint.stroke || (bookable ? colors.coral300 : '#b8b8c0');
  const strokeWidth = selected ? 3 : paint.strokeWidth ?? (bookable ? 1.8 : 1.4);
  const common = { fill, stroke, strokeWidth, strokeDasharray: bookable && !selected ? '5 3' : undefined };
  return (
    <G transform={`translate(${t.x} ${t.y}) rotate(${t.rotation}) scale(${t.scale})`}>
      {body.kind === 'ellipse' ? <Ellipse rx={body.width / 2} ry={body.height / 2} {...common} />
        : body.kind === 'path' && body.d ? <Path d={body.d} {...common} />
          : <Rect x={-body.width / 2} y={-body.height / 2} width={body.width} height={body.height} rx={body.rx || 0} {...common} />}
    </G>
  );
}

/** The table's name, upright however the table is turned, and its whole-table price when it can be booked whole. */
function TableLabel({ t, bookable, currency }: { t: PlacedTable; bookable: boolean; currency: string }) {
  const { body } = t;
  if (body.kind === 'none') return null;
  const price = bookable && t.table.priceCents !== null && body.width >= 44 && body.height >= 36
    ? (t.table.priceCents === 0 ? 'Free' : money(t.table.priceCents, currency)) : null;
  const ink = t.paint.label || '#111018';
  return (
    <G transform={`translate(${t.x} ${t.y}) rotate(${t.rotation}) scale(${t.scale})`}>
      <G transform={`translate(0 ${body.labelY || 0}) rotate(${-t.rotation})`}>
        <SvgText y={price ? -1 : 4} textAnchor="middle" fontSize={t.labelSize} fontFamily={fonts.bold} fill={ink}>{t.table.label}</SvgText>
        {price ? <SvgText y={12} textAnchor="middle" fontSize={9} fontFamily={fonts.bold} fill={colors.accent}>{price}</SvgText> : null}
      </G>
    </G>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', borderRadius: radius.lg },
  controls: { position: 'absolute', top: 12, right: 12, flexDirection: 'row', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 4 },
  ctl: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  pct: { width: 44 },
  fit: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
});

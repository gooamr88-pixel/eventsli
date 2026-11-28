/**
 * A small stand-in for react-native-reanimated in screen tests.
 *
 * Reanimated 4's own mock pulls in react-native-worklets' native module and
 * fails to load under Jest here. Screen tests only need the app's views to
 * draw and its buttons to work, so animations become plain views and values.
 * Only what src/ uses is covered; add to it when a screen needs more.
 */
import { forwardRef, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

/** FadeIn.delay(100).duration(300).springify()… — every builder returns itself. */
function builder(): unknown {
  const b: Record<string, unknown> = {};
  for (const k of ['delay', 'duration', 'springify', 'damping', 'stiffness', 'easing', 'withInitialValues', 'reduceMotion']) {
    b[k] = () => b;
  }
  return b;
}

const AnimatedView = forwardRef<View, { children?: ReactNode; entering?: unknown; exiting?: unknown; layout?: unknown }>(
  function AnimatedView({ entering: _e, exiting: _x, layout: _l, ...rest }, ref) {
    return <View ref={ref} {...rest} />;
  },
);

const Animated = {
  View: AnimatedView,
  Text,
  ScrollView,
  createAnimatedComponent: <T,>(c: T) => c,
};

export default Animated;
export const FadeIn = builder();
export const FadeInDown = builder();
export const FadeOut = builder();
export const ZoomIn = builder();
export const Easing = { out: (f: unknown) => f, in: (f: unknown) => f, inOut: (f: unknown) => f, cubic: 0, quad: 0, linear: 0, ease: 0 };
export const useSharedValue = <T,>(v: T) => ({ value: v });
export const useAnimatedStyle = (fn: () => object) => fn();
export const useAnimatedScrollHandler = () => () => undefined;
export const useReducedMotion = () => true;
export const withTiming = <T,>(v: T) => v;
export const withSpring = <T,>(v: T) => v;
export const withRepeat = <T,>(v: T) => v;
export const withSequence = <T,>(...v: T[]) => v[v.length - 1];
export const interpolate = (_v: number, _i: number[], out: number[]) => out[0];

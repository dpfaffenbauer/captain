import React, { createContext, useContext, useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View } from './rn';
import { colors } from './theme';

/** Screen headers hard-code room for a status bar of up to this height. */
const STATUS_BAR_CLEARANCE = 62;
/** A side inset this wide is the iPhone Duo system rail, not a landscape notch. */
const MIN_RAIL_WIDTH = 60;

type SetRailContent = (content: React.ReactNode) => void;

const RailContentContext = createContext<SetRailContent | null>(null);

/**
 * Keeps every screen clear of the system UI of iPhone Duo: the vertical rail on
 * its left or right edge, and the status capsule that can sit lower than a
 * regular status bar.
 *
 * The rail's free space below the system controls is a slot for app controls.
 * It lives here rather than in the screens because touches outside the padded
 * area never reach views nested inside the navigators.
 */
export function SystemSafeArea({ children }: { children: React.ReactNode }) {
  const { top, left, right } = useSafeAreaInsets();
  const [railContent, setRailContent] = useState<React.ReactNode>(null);
  const railOnLeft = left >= MIN_RAIL_WIDTH;

  return (
    <RailContentContext.Provider value={setRailContent}>
      <View
        style={{
          flex: 1,
          paddingTop: Math.max(0, top - STATUS_BAR_CLEARANCE),
          paddingLeft: left,
          paddingRight: right,
          backgroundColor: colors.background,
        }}
      >
        {children}
      </View>
      {railContent ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            [railOnLeft ? 'left' : 'right']: 0,
            width: railOnLeft ? left : right,
          }}
        >
          {railContent}
        </View>
      ) : null}
    </RailContentContext.Provider>
  );
}

/** Whether the window currently has a system rail that can host app controls. */
export function useHasSystemRail(): boolean {
  const { left, right } = useSafeAreaInsets();
  return Math.max(left, right) >= MIN_RAIL_WIDTH;
}

/** Shows `content` in the system rail for as long as the caller is mounted. */
export function useRailContent(content: React.ReactNode) {
  const setRailContent = useContext(RailContentContext);
  useEffect(() => {
    setRailContent?.(content);
    return () => setRailContent?.(null);
  }, [content, setRailContent]);
}

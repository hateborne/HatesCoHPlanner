import type { CSSProperties } from 'react';
import { pressKeys } from '../press.ts';

/**
 * The totals' on/off switch: a round button with a blue rim, lit green while what it stands for
 * counts. The overview has one beside each power, the pet pane one beside each pet power that can
 * move a stat.
 *
 * @param props.on Whether it counts.
 * @param props.size Its inner diameter in stage px (the rim adds 2 px each side).
 * @param props.onToggle Flip it.
 * @param props.label Its name for screen readers and the keyboard (Enter or Space flips it).
 * @param props.title Its hover text.
 * @param props.glow How far its light reaches, in stage px.
 * @param props.extra Further handlers (the overview's long press on a phone).
 * @param props.style Where it goes.
 */
export function OnSwitch({
  on,
  size,
  onToggle,
  label,
  title,
  glow = 8,
  className,
  testId,
  extra,
  style,
}: {
  on: boolean;
  size: number;
  onToggle: () => void;
  label: string;
  title: string;
  glow?: number;
  className?: string;
  testId?: string;
  extra?: Record<string, unknown>;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      data-testid={testId}
      title={title}
      onClick={onToggle}
      {...pressKeys(onToggle, undefined, label)}
      aria-pressed={on}
      {...extra}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        cursor: 'pointer',
        border: '2px solid #4f94ff',
        background: on ? 'radial-gradient(#7fff7f, #00a020)' : '#111',
        boxShadow: on ? `0 0 ${glow}px #3f3` : 'none',
        ...style,
      }}
    />
  );
}

import type { KeyboardEvent, PointerEvent } from 'react';

/**
 * Touch and keyboard access for the planner's clickable game chrome: press-and-hold on a touch
 * screen (the phone's stand-in for hovering), and Enter / Space / Delete for keyboard users.
 */

// how long a finger must rest on an element before it counts as a long press, and how far it may drift
const LONG_MS = 450;
const DRIFT_PX = 10;

// the pointer type of the last press anywhere (Android turns a long touch into a contextmenu event)
let lastPointer = 'mouse';
// the running press: its timer and where it started
let press: { timer: number; x: number; y: number } | null = null;
// a long press fired: swallow the click its release produces
let fired = false;
let swallowUntil = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (lastPointer = e.pointerType), true);
  window.addEventListener(
    'pointerup',
    () => {
      if (fired) swallowUntil = performance.now() + 400;
      fired = false;
    },
    true,
  );
  window.addEventListener(
    'click',
    (e) => {
      if (performance.now() < swallowUntil) {
        swallowUntil = 0;
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
}

/** @return Whether the last press came from a finger or pen (a contextmenu then is a long touch, not a right-click). */
export function touchPress(): boolean {
  return lastPointer === 'touch' || lastPointer === 'pen';
}

function cancel(): void {
  if (press) window.clearTimeout(press.timer);
  press = null;
}

/**
 * Handlers that call `onLong` when a finger rests on the element for LONG_MS without drifting
 * (scrolling cancels it). The click its release would produce is swallowed, so a long press on a
 * power never also opens its level. Mouse presses are ignored: the mouse has hover.
 *
 * @param onLong Called with the press point in window px.
 * @return Pointer handlers to spread onto the element (none when `onLong` is undefined).
 */
export function longPress(onLong?: (pt: { x: number; y: number }) => void) {
  if (!onLong) return {};
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      cancel();
      const pt = { x: e.clientX, y: e.clientY };
      press = {
        x: pt.x,
        y: pt.y,
        timer: window.setTimeout(() => {
          press = null;
          fired = true;
          navigator.vibrate?.(12);
          onLong(pt);
        }, LONG_MS),
      };
    },
    onPointerMove: (e: PointerEvent) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRIFT_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}

/**
 * Keyboard access for a clickable element: it takes focus, Enter or Space presses it, and
 * Delete or Backspace runs `onDelete` (the right-click action, such as removing an enhancement).
 *
 * @param onPress The click action.
 * @param onDelete The right-click action, if any.
 * @param label Accessible name when the element's text is drawn as sprites or split glyphs.
 * @return Props to spread onto the element (none when it does nothing).
 */
export function pressKeys(onPress?: () => void, onDelete?: () => void, label?: string) {
  if (!onPress && !onDelete) return {};
  return {
    tabIndex: 0,
    role: 'button',
    'aria-label': label,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if ((e.key === 'Enter' || e.key === ' ') && onPress) {
        e.preventDefault();
        onPress();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && onDelete) {
        e.preventDefault();
        onDelete();
      }
    },
  };
}

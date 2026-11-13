import { useEffect, useRef } from 'react';
import { getDevPx, S, SX, SY, vs } from '../skin/metrics.ts';
import { ui, type Skin } from '../skin/skin.ts';
import { flashOver, flashStart, tickStep } from '../electric.ts';

// electric_display's textures (uiFx.c): three broken electric rings (82 x 82) and the Next button's
// glow halves (35 x 56 each)
const SPARK_TEX = [1, 2, 3].map((i) => `hud/common/special_effects/enhnc_spark0${i}`);
const GLOW_L_TEX = 'creation/common/nextbuttons/next_glowkit_l';
const GLOW_R_TEX = 'creation/common/nextbuttons/next_glowkit_r';
const SPARK_PX = 82;
const GLOW_W = 35;
const GLOW_H = 56;

const BURST_SPARKS = 10; // electric_display: sparks per burst frame
const GLOW_SCALE = 1.2; // electric_display: the glow halves at 1.2x the spark's scale
// drawPowerAndEnhancements' electric_init scale: MIN(1, .8 x scale x screenScale), scale 1
const SC = Math.min(1, 0.8 * S);
// electric_display's own screenScale: the mean of the x and y screen scales
const AVG = (SX + SY) / 2;
// SlotRing's desktop size (EnhncTray_Ring 70 x 70 at scale .5): the effect is sized for it
const RING = vs(35);
// half the canvas, desktop: the larger of a rotated spark's half-diagonal and a burst spark's
// (scale up to .9, stretched by SX x SY); the glow halves fit inside both
const HALF = Math.ceil(
  Math.max(SPARK_PX * SC * AVG * Math.SQRT1_2, (0.9 * SPARK_PX * Math.hypot(SX, SY)) / 2, GLOW_W * GLOW_SCALE * SC * AVG, (GLOW_H / 2) * GLOW_SCALE * SC * AVG),
);

const images = new Map<string, HTMLImageElement>();
/** @return The texture's image, loading it on first use (draw it only once complete). */
function texture(url: string): HTMLImageElement {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  return img;
}
const ready = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

/**
 * Start loading the effect's textures, so the first slot added flashes with them.
 *
 * @param skin UI skin (the textures' v_ / p_ variants).
 */
export function preloadElectricFlash(skin?: Skin): void {
  for (const t of [...SPARK_TEX, GLOW_L_TEX, GLOW_R_TEX]) texture(ui(t, skin));
}

const glows = new Map<string, HTMLCanvasElement>();
/**
 * The Next button's glow, its two halves joined into one image.
 *
 * The client draws the halves edge to edge; drawn apart and scaled, a join that lands on half a
 * device pixel is only partly covered by each half, and shows as a dark line through the glow.
 *
 * @param l The left half (loaded or not).
 * @param r The right half.
 * @return The joined glow, or undefined until both halves have loaded.
 */
function glowImage(l: HTMLImageElement, r: HTMLImageElement): HTMLCanvasElement | undefined {
  if (!ready(l) || !ready(r)) return undefined;
  const key = `${l.src}|${r.src}`;
  let c = glows.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = l.naturalWidth + r.naturalWidth;
    c.height = Math.max(l.naturalHeight, r.naturalHeight);
    const ctx = c.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(l, 0, 0);
    ctx.drawImage(r, l.naturalWidth, 0);
    glows.set(key, c);
  }
  return c;
}

/** C's rand() % n. */
const rand = (n: number) => Math.floor(Math.random() * n);
const randAngle = () => (rand(360) / 360) * 2 * Math.PI;

/** One of ElectricFlash's three sparks (its sc / scspeed stay fixed for a non-light flash). */
interface Spark {
  timer: number; // ticks into the current on (counting up) or off (counting down) phase
  total: number; // > 0: length of the on phase; <= 0: minus the length of the off phase
  angle: number; // radians, clockwise on screen
  speed: number; // radians per tick
}

/** @return electric_initEx's sparks for a non-light flash. */
function initSparks(): Spark[] {
  return [0, 1, 2].map(() => ({ timer: 0, total: rand(10) - 5, angle: randAngle(), speed: rand(10) * 0.002 }));
}

/**
 * Draw a texture centered on the origin, rotated clockwise by `angle`.
 *
 * @param ctx Canvas context with the origin at the effect's center.
 * @param img Loaded texture.
 * @param w Width in stage px.
 * @param h Height in stage px.
 * @param angle Radians.
 */
function drawRotated(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, angle: number): void {
  ctx.save();
  ctx.rotate(angle);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/**
 * The electric crackle the client draws on a newly added enhancement slot: electric_initEx and
 * electric_display (uiFx.c), as drawPowerAndEnhancements (uiLevelSpec.c) starts it.
 *
 * 1. A burst: for 5 drawn frames, 10 copies of Enhnc_Spark01 at random sizes and angles.
 * 2. Three sparks (Enhnc_Spark01..03), each flickering on its own: on for 5-9 ticks with alpha
 *    255 x sin(pi t), each time at a new random angle and turning slowly, then off for 5-9 ticks.
 *    An "on" spark also draws the white Next-button glow behind it, in the same alpha.
 * 3. It lasts `duration` ticks, electric_init's argument (the slot screen passes the live
 *    client's 45, SLOT_FLASH_TICKS); the slot screen unmounts it sooner (Finish, Cancel, the slot
 *    removed). Mounted again after it ended (a phone tab switched back), it draws nothing.
 *
 * The client draws the sparks additively (GL_SRC_ALPHA, GL_ONE) and the glows with plain alpha,
 * so they sit on two canvases: the sparks' with 'lighter' and mix-blend-mode plus-lighter. The
 * per-frame state lives in the animation loop, never in React state. Pointer events pass through.
 *
 * @param x Center x (the new slot ring's center), in the parent's stage px.
 * @param y Center y.
 * @param ring Size of the slot ring it sits on: phones' larger rings scale the effect with them.
 * @param born performance.now() of the click that added the slot.
 * @param duration How long it lasts, in ticks (30 a second).
 * @param skin UI skin (addAtlasTex's v_ / p_ texture variants).
 */
export function ElectricFlash({ x, y, ring = RING, born, duration, skin }: { x: number; y: number; ring?: number; born: number; duration: number; skin?: Skin }) {
  const glowRef = useRef<HTMLCanvasElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const k = ring / RING;
  const half = HALF * k;

  useEffect(() => {
    const gc = glowRef.current?.getContext('2d');
    const sc = sparkRef.current?.getContext('2d');
    if (!gc || !sc) return;
    const sparks = SPARK_TEX.map((t) => texture(ui(t, skin)));
    const glowL = texture(ui(GLOW_L_TEX, skin));
    const glowR = texture(ui(GLOW_R_TEX, skin));
    const fx = initSparks();
    let last = performance.now();
    const start = flashStart(born, last, duration);
    let age = start?.age ?? 0; // ef->totalDuration
    let burst = start?.burst ?? 0;
    let glow: HTMLCanvasElement | undefined; // the joined glow, once its halves have loaded
    let raf = 0;

    // backing store in device pixels, but never finer than the textures' own texels (finer only
    // re-samples the same 82 px art, and a respec can keep dozens of these alive on a phone);
    // drawing is in stage px with the origin at the center
    const prepare = (ctx: CanvasRenderingContext2D) => {
      const px = Math.max(getDevPx(), SC * AVG * k);
      const size = Math.round((2 * half) / px);
      if (ctx.canvas.width !== size) ctx.canvas.width = ctx.canvas.height = size;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, size, size);
      ctx.setTransform(1 / px, 0, 0, 1 / px, size / 2, size / 2);
    };
    if (!start) {
      // over already: clear anything an earlier run drew before it was stopped (frames paused in
      // a background tab, then the ring resized)
      prepare(gc);
      prepare(sc);
      return;
    }

    const frame = (now: number) => {
      const step = tickStep(last, now); // TIMESTEP
      last = now;
      prepare(gc);
      prepare(sc);
      sc.globalCompositeOperation = 'lighter';
      const sparkW = SPARK_PX * SC * AVG * k;
      const glowW = GLOW_W * GLOW_SCALE * SC * AVG * k;
      const glowH = GLOW_H * GLOW_SCALE * SC * AVG * k;
      glow ??= glowImage(glowL, glowR);
      fx.forEach((f, i) => {
        if (f.total > 0 && f.total > f.timer) {
          // color 0xffffff00 | (int)(255 sin(pi (T - t) / T))
          const a = Math.trunc(255 * Math.sin((Math.PI * (f.total - f.timer)) / f.total)) / 255;
          gc.globalAlpha = a;
          if (glow) gc.drawImage(glow, -glowW, -glowH / 2, 2 * glowW, glowH);
          sc.globalAlpha = a;
          if (ready(sparks[i]!)) drawRotated(sc, sparks[i]!, sparkW, sparkW, f.angle);
          f.timer += step;
          if (f.timer > f.total) {
            f.timer = 0;
            f.total = -(rand(5) + 5);
          }
        } else {
          f.timer -= step;
          if (f.timer < f.total) {
            f.timer = 0;
            f.angle = randAngle();
            f.total = rand(5) + 5;
            f.speed = rand(10) * 0.001;
          }
        }
        f.angle += step * f.speed;
      });
      if (burst > 0) {
        // Enhnc_Spark01 at sc = (rand() % 10) x .1, screen-scaled by (sx, sy) like any shell sprite
        sc.globalAlpha = 1;
        for (let n = 0; n < BURST_SPARKS; n++) {
          const r = rand(10) * 0.1;
          if (r > 0 && ready(sparks[0]!)) drawRotated(sc, sparks[0]!, SPARK_PX * r * SX * k, SPARK_PX * r * SY * k, randAngle());
        }
        burst--;
      }
      age += step;
      if (flashOver(age, duration)) {
        prepare(gc);
        prepare(sc);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [born, duration, half, k, skin]);

  const box = { left: x - half, top: y - half, width: 2 * half, height: 2 * half };
  // z 9: over the slot rings (8) and bars, as the client's z + 190 is over the new slot's ring
  // (drawMenuEnhancement, z + 100); under "FULL!" (z + 250). The
  // z-index sits on the canvases, not the wrapper: a stacking context there would hide the page
  // from the sparks' blend.
  const layer = { left: 0, top: 0, width: '100%', height: '100%', zIndex: 9 } as const;
  return (
    <div className="abs" style={{ ...box, pointerEvents: 'none' }}>
      <canvas ref={glowRef} className="abs" style={layer} />
      <canvas ref={sparkRef} className="abs" style={{ ...layer, mixBlendMode: 'plus-lighter' }} />
    </div>
  );
}

import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { LiquidSquare } from "./LiquidSquare";
import { WORDMARK_BOX, WORDMARK_PATH } from "./wordmark";

// Promo end card: ① empty → ② the liquid square enters (slide or fill)
// → ③ it settles to the left while the "corpus" wordmark unfolds right.
// The liquid texture keeps flowing for the whole duration.

const BG = "#0e0e14";
const WORD_FILL = "#f0eff7"; // from banner-dark.svg

const SQUARE = 340;
const GAP = 84;
const WORD_HEIGHT = 118;
const WORD_WIDTH = (WORDMARK_BOX.width / WORDMARK_BOX.height) * WORD_HEIGHT;
const GROUP_WIDTH = SQUARE + GAP + WORD_WIDTH;

// Timeline (30 fps)
const ENTER_START = 12;
const FILL_END = 58;
const SHIFT_START = 72;
const WORD_START = 80;
const WORD_DUR = 34;

export const LogoEndCard: React.FC<{ entrance: "slide" | "fill" }> = ({
  entrance,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const time = frame / fps;

  // ② entrance
  let enterY = 0;
  let enterOpacity = 1;
  let fill = 1;
  if (entrance === "slide") {
    const s = spring({
      frame: frame - ENTER_START,
      fps,
      config: { damping: 16, mass: 1.1 },
    });
    enterY = 260 * (1 - s);
    enterOpacity = interpolate(frame, [ENTER_START, ENTER_START + 12], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  } else {
    fill = interpolate(frame, [ENTER_START, FILL_END], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    });
  }

  // ③ shift left + wordmark unfold
  const shift = spring({
    frame: frame - SHIFT_START,
    fps,
    config: { damping: 200 },
    durationInFrames: 40,
  });
  const squareCenterFinal = width / 2 - GROUP_WIDTH / 2 + SQUARE / 2;
  const squareX = width / 2 + (squareCenterFinal - width / 2) * shift;

  const wordReveal = interpolate(
    frame,
    [WORD_START, WORD_START + WORD_DUR],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );
  const wordLeft = squareCenterFinal + SQUARE / 2 + GAP;

  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      {/* square logo mark */}
      <div
        style={{
          position: "absolute",
          left: squareX - SQUARE / 2,
          top: height / 2 - SQUARE / 2 + enterY,
          opacity: enterOpacity,
        }}
      >
        <LiquidSquare
          size={SQUARE}
          time={time}
          fill={fill}
          cornerRadius={SQUARE * 0.06}
        />
      </div>

      {/* wordmark, revealed left-to-right by an expanding clip window */}
      <div
        style={{
          position: "absolute",
          left: wordLeft,
          top: height / 2 - WORD_HEIGHT / 2,
          width: WORD_WIDTH * wordReveal,
          height: WORD_HEIGHT,
          overflow: "hidden",
          opacity: wordReveal === 0 ? 0 : 1,
        }}
      >
        <svg
          width={WORD_WIDTH}
          height={WORD_HEIGHT}
          viewBox={`${WORDMARK_BOX.x} ${WORDMARK_BOX.y} ${WORDMARK_BOX.width} ${WORDMARK_BOX.height}`}
          style={{
            display: "block",
            transform: `translateX(${-24 * (1 - wordReveal)}px)`,
          }}
        >
          <path d={WORDMARK_PATH} fill={WORD_FILL} />
        </svg>
      </div>
    </AbsoluteFill>
  );
};

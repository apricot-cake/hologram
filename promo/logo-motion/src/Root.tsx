import { Composition } from "remotion";
import { LogoEndCard } from "./LogoEndCard";

const FPS = 30;
const DURATION = 150; // 5s

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="LogoSlide"
        component={LogoEndCard}
        durationInFrames={DURATION}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ entrance: "slide" as const }}
      />
      <Composition
        id="LogoFill"
        component={LogoEndCard}
        durationInFrames={DURATION}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ entrance: "fill" as const }}
      />
    </>
  );
};

import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// WebGL (liquid shader) needs a real GL backend in headless Chrome
Config.setChromiumOpenGlRenderer("angle");

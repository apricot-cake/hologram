import { startCapture } from '../utils/capture.ts';

export default defineUnlistedScript({
  main() {
    void startCapture();
  },
});

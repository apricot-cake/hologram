import { startCapture } from '../utils/capture';

export default defineUnlistedScript({
  main() {
    void startCapture();
  },
});

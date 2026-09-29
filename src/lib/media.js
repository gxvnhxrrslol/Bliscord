import { native } from './api';
import { getState } from './store';
import { voice } from './voice';
import { openModal, toast } from './actions';

export async function toggleCamera() {
  try {
    if (voice.cameraStream) voice.stopCamera();
    else await voice.startCamera();
  } catch (err) {
    toast(err?.name === 'NotAllowedError' ? 'Camera access was blocked' : 'Could not start your camera', 'error');
  }
}

export async function toggleScreen() {
  if (voice.screenStream) { voice.stopScreen(); return; }
  if (native?.screen) { openModal('screenPicker'); return; }
  try {
    await voice.startScreen({ quality: getState().settings.screenQuality, audio: true });
  } catch (err) {
    if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') toast('Could not share your screen', 'error');
  }
}

export async function goLive({ sourceId, quality, audio }) {
  try {
    await native.screen.select({ id: sourceId, audio });
    await voice.startScreen({ quality, audio });
  } catch (err) {
    if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') toast('Could not share your screen', 'error');
  }
}

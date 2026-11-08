import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';

import { useSettings } from '../lib/settings';
import type { Tone } from '../ui/theme';

/**
 * What the door HEARS and FEELS, chosen from the outcome's tone — never from a
 * branch per result — so a new result cannot arrive with a colour and no sound.
 *
 * Sound matters more than haptics here: iOS silences the Taptic Engine while
 * the camera is running, and a door is loud. The sounds play with the silent
 * switch on, because a scanner that goes quiet when a phone is muted is a
 * scanner that lets the wrong person in.
 */

let players: Partial<Record<'admit' | 'refuse' | 'warn', AudioPlayer>> = {};
let ready = false;

export async function primeFeedback() {
  if (ready) return;
  ready = true;
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
    players = {
      admit: createAudioPlayer(require('../../assets/sounds/admit.wav')),
      refuse: createAudioPlayer(require('../../assets/sounds/refuse.wav')),
      warn: createAudioPlayer(require('../../assets/sounds/warn.wav')),
    };
  } catch {
    // No audio is not a reason to stop scanning; the screen still says it.
    ready = false;
  }
}

function play(which: 'admit' | 'refuse' | 'warn') {
  const p = players[which];
  if (!p) return;
  try {
    p.seekTo(0);
    p.play();
  } catch {
    // Ignore: feedback is a courtesy, the screen is the answer.
  }
}

export function signal(tone: Tone) {
  const { sound, haptics } = useSettings.getState();
  if (sound) {
    if (tone === 'admit') play('admit');
    else if (tone === 'refuse') play('refuse');
    else if (tone === 'warn') play('warn');
  }
  if (haptics) {
    const type = tone === 'admit'
      ? Haptics.NotificationFeedbackType.Success
      : tone === 'refuse'
        ? Haptics.NotificationFeedbackType.Error
        : Haptics.NotificationFeedbackType.Warning;
    Haptics.notificationAsync(type).catch(() => undefined);
  }
}

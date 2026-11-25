/**
 * The note patterns of Eventsli music (stageSound.js plays them). Pure data and
 * scheduling: no Web Audio here, so the test plays them into a recording kit.
 */
/**
 * THE FOUR LOOPS: four bars of sixteenths each. `play(step, t, kit, spb)` is
 * called once per sixteenth, a little ahead of time; `step` counts from 0 for
 * ever. Exported for the test, which plays them into a recording kit.
 */
export const PATTERNS = Object.freeze({
  // A minor, 118 BPM: four on the floor, off-beat hats, a syncopated bass.
  arena: {
    bpm: 118,
    chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
    roots: [33, 29, 36, 31],
    play(step, t, kit, spb) {
      const bar = Math.floor(step / 16) % 4;
      const s = step % 16;
      const ch = this.chords[bar];
      if (s % 4 === 0) kit.kick(t, 0.85);
      if (s % 4 === 2) kit.hat(t, 0.16, 0.07);
      else if (s % 2 === 1) kit.hat(t, 0.06, 0.03);
      if (s === 4 || s === 12) kit.clap(t, 0.2);
      if ([0, 3, 6, 8, 11, 14].includes(s)) kit.bass(this.roots[bar], t, spb * 1.6, 0.3);
      if (s === 0) kit.pad(ch, t, spb * 16, 0.045, 0.35);
      if (s % 2 === 0) kit.pluck(ch[(s / 2) % 3] + 12, t, 0.045);
    },
  },
  // ii–V–I in C, 84 BPM: warm keys, brushes on two and four, a walking bass.
  lounge: {
    bpm: 84,
    chords: [[53, 57, 60, 64], [53, 59, 64], [52, 55, 59, 62], [55, 61, 64]],
    roots: [38, 43, 36, 45],
    play(step, t, kit, spb) {
      const bar = Math.floor(step / 16) % 4;
      const s = step % 16;
      const ch = this.chords[bar];
      const root = this.roots[bar];
      if (s === 0) kit.keys(ch, t, spb * 7, 0.09);
      if (s === 7) kit.keys(ch, t, spb * 3, 0.06);
      if (s === 10) kit.keys(ch, t, spb * 5, 0.05);
      if (s === 4 || s === 12) kit.brush(t, 0.09);
      if (s % 4 === 2) kit.hat(t, 0.04, 0.05);
      if (s % 4 === 0) kit.bass([root, root + 7, root + 12, root + 10][s / 4], t, spb * 3.6, 0.26);
      if (s === 0) kit.kick(t, 0.3);
      if (s === 10) kit.kick(t, 0.18);
    },
  },
  // C minor, 70 BPM: long swells, a deep drum on the ones, light above.
  cinematic: {
    bpm: 70,
    chords: [[48, 55, 63], [44, 51, 60], [51, 55, 58], [46, 53, 58]],
    drone: 36,
    play(step, t, kit, spb) {
      const bar = Math.floor(step / 16) % 4;
      const s = step % 16;
      const ch = this.chords[bar];
      if (s === 0) {
        kit.pad(ch, t, spb * 16, 0.06, 1.4);
        kit.pad(ch.map((m) => m + 12), t, spb * 16, 0.02, 2);
      }
      if (s === 0 && bar % 2 === 0) kit.boom(t, 0.55);
      if (s === 12 && bar === 3) kit.boom(t, 0.4);
      if (s === 0 || s === 6 || s === 10) kit.shimmer(ch[(step >> 1) % ch.length] + 24, t, 0.03);
      if (s % 2 === 0) kit.hat(t, 0.02, 0.03);
    },
  },
  // F major, 96 BPM: an arpeggio of plucks, a soft kick, a shaker.
  chill: {
    bpm: 96,
    chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]],
    roots: [41, 40, 38, 36],
    arp: [0, 2, 1, 3, 2, 1, 3, 2],
    play(step, t, kit, spb) {
      const bar = Math.floor(step / 16) % 4;
      const s = step % 16;
      const ch = this.chords[bar];
      if (s === 0) kit.pad(ch, t, spb * 16, 0.03, 0.6);
      if (s % 2 === 0) kit.pluck(ch[this.arp[s / 2]] + 12, t, 0.075);
      if (s === 0 || s === 8) kit.kick(t, 0.55);
      kit.shaker(t, s % 4 === 2 ? 0.055 : 0.025);
      if (s === 4 || s === 12) kit.clap(t, 0.09);
      if (s === 0 || s === 6 || s === 8) kit.bass(this.roots[bar], t, spb * 2, 0.26);
    },
  },
});

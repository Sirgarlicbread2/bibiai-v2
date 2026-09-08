import { it, expect, vi } from 'vitest';
import { Voice } from '../src/voice.js';
import { Configuration } from '../src/config.js';

it('rejects a second playback without stopping the active operation', async () => {
  const voice = new Voice(new Configuration());
  let fail!: (error: Error) => void;
  vi.spyOn(voice as any, 'connect').mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
  const leave = vi.spyOn(voice, 'leave');
  const first = voice.play({} as any, 'test.mp3');
  const rejected = expect(first).rejects.toThrow('Connection failed');
  await expect(voice.play({} as any, 'other.mp3')).rejects.toThrow('busy');
  expect(leave).not.toHaveBeenCalled();
  fail(new Error('Connection failed'));
  await rejected;
  expect(leave).toHaveBeenCalledTimes(1);
});

it('does not let completion of a cancelled operation stop a newer one', async () => {
  const cfg = new Configuration(); cfg.value.discord.voiceCooldownSeconds = 0;
  const voice = new Voice(cfg);
  const failures: Array<(error: Error) => void> = [];
  vi.spyOn(voice as any, 'connect').mockImplementation(() => new Promise((_resolve, reject) => { failures.push(reject); }));
  const first = voice.play({} as any, 'test.mp3');
  const firstResult = expect(first).rejects.toThrow('Cancelled');
  voice.leave();
  const second = voice.play({} as any, 'second.mp3');
  const secondResult = expect(second).rejects.toThrow('Finished');
  failures[0](new Error('Cancelled')); await firstResult;
  expect((voice as any).busy).toBe(true);
  failures[1](new Error('Finished')); await secondResult;
  expect((voice as any).busy).toBe(false);
});

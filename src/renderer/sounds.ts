import pingUrl from './assets/sounds/ping.wav';

export const NOTIFICATION_SOUNDS = ['off', 'ping'] as const;
export type NotificationSound = (typeof NOTIFICATION_SOUNDS)[number];

export const SOUND_LABELS: Record<NotificationSound, string> = {
  off: 'Off',
  ping: 'Ping',
};

const cache = new Map<string, HTMLAudioElement>();

function playUrl(url: string): void {
  let audio = cache.get(url);
  if (!audio) {
    audio = new Audio(url);
    cache.set(url, audio);
  }
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playNotificationSound(sound: NotificationSound): void {
  if (sound === 'off') return;
  playUrl(pingUrl);
}

import { cancelCosyVoiceLibraryInstall, cosyVoiceLibraryStatus, startCosyVoiceLibraryInstall } from '../src/tts/cosyvoice-voice-library.mjs';
import { getSettings, saveSettings } from '../src/database/db.mjs';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const started = startCosyVoiceLibraryInstall({
  onProfile: async (profile) => {
    const current = getSettings();
    const profiles = Array.isArray(current.cosyVoiceProfiles) ? [...current.cosyVoiceProfiles] : [];
    const registered = {
      id: profile.id, name: profile.name, referenceText: profile.referenceText,
      automatic: true, source: profile.source, gender: profile.gender, genderLabel: profile.genderLabel,
      speakerId: profile.speakerId, recordId: profile.recordId, language: profile.language,
      sampleRate: profile.sampleRate, durationSeconds: profile.durationSeconds, license: profile.license, ready: true
    };
    const index = profiles.findIndex((item) => item.id === profile.id);
    if (index >= 0) profiles[index] = { ...profiles[index], ...registered };
    else profiles.push(registered);
    saveSettings({ cosyVoiceProfiles: profiles });
    process.stdout.write(`Đã đăng ký ${profile.name} · ${profile.genderLabel} · speaker ${profile.speakerId} · ${profile.durationSeconds}s\n`);
  }
});

if (!started.started) {
  process.stderr.write('Một lượt cài thư viện CosyVoice đang chạy trong tiến trình này.\n');
  process.exitCode = 1;
} else {
  process.once('SIGINT', () => { cancelCosyVoiceLibraryInstall(); });
  let lastMessage = '';
  while (cosyVoiceLibraryStatus().job.running) {
    await sleep(700);
    const job = cosyVoiceLibraryStatus().job;
    if (job.message && job.message !== lastMessage) {
      process.stdout.write(`${job.message} (${job.installed}/${job.total})\n`);
      lastMessage = job.message;
    }
  }
  const status = cosyVoiceLibraryStatus();
  process.stdout.write(`Hoàn tất: ${status.installed}/${status.expected} giọng AISHELL-3 hợp lệ.\n`);
  for (const failure of status.job.failed || []) process.stderr.write(`${failure.name || failure.stage}: ${failure.message}\n`);
}

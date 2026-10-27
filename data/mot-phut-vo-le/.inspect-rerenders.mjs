import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { FFMPEG_BIN, FFPROBE_BIN } from '../../src/config.mjs';
const { videos } = await (await fetch('http://127.0.0.1:3001/api/mot-phut-vo-le/videos?limit=10')).json();
for (const video of videos) {
  const probe = spawnSync(FFPROBE_BIN, ['-v','error','-show_entries','format=duration:stream=index,codec_type,width,height','-of','json',video.videoPath], { encoding:'utf8', windowsHide:true });
  if (probe.status !== 0) throw new Error('ffprobe failed: ' + (probe.error?.message || probe.stderr));
  const media = JSON.parse(probe.stdout);
  const imageName = video.id.startsWith('ad6') ? 'rerender-thang-qa.png' : 'rerender-piano-qa.png';
  const imagePath = 'data/mot-phut-vo-le/' + imageName;
  const frame = spawnSync(FFMPEG_BIN, ['-hide_banner','-loglevel','error','-y','-ss','5','-i',video.videoPath,'-frames:v','1',imagePath], { encoding:'utf8', windowsHide:true });
  if (frame.status !== 0) throw new Error('frame extraction failed: ' + (frame.error?.message || frame.stderr));
  console.log(JSON.stringify({title:video.title,designVersion:video.visualDesign.schemaVersion,durationSeconds:Number(media.format.duration),streams:media.streams.map(({codec_type,width,height})=>({codec_type,width,height})),framePath:imagePath,videoBytes:fs.statSync(video.videoPath).size}));
}

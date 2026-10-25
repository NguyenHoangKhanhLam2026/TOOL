import '../fontconfig-env.mjs';

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

try {
  const input = await readInput();
  const mode = process.argv[2];
  if (mode === 'preview') {
    const { buildEnglishShadowingVisualDesignPreviewPng } = await import('./renderer.mjs');
    const png = await buildEnglishShadowingVisualDesignPreviewPng(input);
    process.stdout.write(png);
  } else if (mode === 'video-job') {
    const { createEnglishShadowingVideoJob } = await import('./create-video.mjs');
    const result = await createEnglishShadowingVideoJob(input);
    process.stdout.write(JSON.stringify(result));
  } else {
    throw new TypeError(`Unsupported English Shadowing font task: ${mode}`);
  }
} catch (error) {
  process.stderr.write(String(error?.stack || error?.message || error));
  process.exitCode = 1;
}

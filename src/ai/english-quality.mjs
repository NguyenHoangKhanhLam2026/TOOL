export function buildEnglishReviewPrompt(script) {
  const reviewData = {
    topic: script.topic,
    title: script.title,
    hook: script.hook,
    presentationStyle: script.presentationStyle,
    dialogues: (script.dialogues || []).map(({ vietnamese, english, term, meaningVi, vocabularyCards }) => ({
      vietnamese, english, term, meaningVi,
      vocabularyCards: Array.isArray(vocabularyCards) ? vocabularyCards.map(({ sourceVi, term: cardTerm, meaningVi: cardMeaning }) => ({
        sourceVi, term: cardTerm, meaningVi: cardMeaning
      })) : vocabularyCards
    })),
    caption: script.caption,
    speechSegments: (script.speechSegments || []).map(({ segmentId, language, state, text, target }) => ({
      segmentId, language, state, text, target: { layerId: target?.layerId, dialogueIndex: target?.dialogueIndex, vocabularyIndex: target?.vocabularyIndex }
    }))
  };
  return `Review this Vietnamese–English learning-video script as a strict native English editor and Vietnamese–English translator. Treat it as a fresh draft; do not assume it is correct because an AI generated it. Check every sentence, vocabulary card, translation, and spoken segment.\n` +
    `Fail if any English sentence is unnatural, ungrammatical, overly literal, or has an incorrect article, tense, preposition, or collocation. Independently check that each Vietnamese line faithfully matches its English line. Verify every target phrase occurs exactly in its English sentence and that its Vietnamese meaning and usage fit that sentence. Check that the selected presentation style is complete, logically ordered, and contains no repeated or redundant learning point. Check that captions and titles do not claim anything unsupported. The speech sequence must follow the visual order: Vietnamese source, English sentence, then only the phrase and explanation cards belonging to that lesson. Do not permit extra spoken headings, stage directions, or a follow/subscribe CTA in lesson speech. If uncertain, fail and name the exact lesson and field.\n` +
    `Return only JSON in this exact shape: {"approved":true,"issues":[]} when every check passes, or {"approved":false,"issues":["lesson 1 english: ..."]} when any check fails. Do not rewrite the draft, provide praise, or list optional suggestions.\n` +
    `Draft: ${JSON.stringify(reviewData)}`;
}

export function assertEnglishReviewResponse(value) {
  let response = value;
  if (typeof value === 'string') {
    const clean = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('Lượt rà soát tiếng Anh không trả về JSON hợp lệ.');
    try { response = JSON.parse(clean.slice(start, end + 1)); }
    catch { throw new Error('Lượt rà soát tiếng Anh không trả về JSON hợp lệ.'); }
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)
    || typeof response.approved !== 'boolean' || !Array.isArray(response.issues)
    || response.issues.some((issue) => typeof issue !== 'string')
    || Object.keys(response).some((key) => !['approved', 'issues'].includes(key))) {
    throw new Error('Lượt rà soát tiếng Anh trả sai cấu trúc; job bị chặn để tránh render nội dung chưa kiểm định.');
  }
  const issues = response.issues.map((issue) => issue.trim()).filter(Boolean);
  if (!response.approved || issues.length) {
    throw new Error(`Rà soát tiếng Anh chưa đạt: ${issues.join(' | ') || 'người rà soát không xác nhận nội dung đạt chuẩn.'}`);
  }
  return { approved: true, issues: [] };
}

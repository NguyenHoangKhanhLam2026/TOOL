const CONTENT_ID = 'things-you-didnt-know';
const selector = document.querySelector('#editor-language-select');
const workspace = document.querySelector('#things-visual-workspace');
const topbar = document.querySelector('.topbar');
const title = document.querySelector('#editor-title');
const subtitle = document.querySelector('#template-language-label');

function setThingsEditor(active) {
  document.body.classList.toggle('things-editor-mode', active);
  document.body.classList.toggle('things-design-open', false);
  if (workspace) workspace.hidden = !active;
  if (topbar) topbar.classList.toggle('things-editor-topbar', active);
  if (title) title.textContent = active ? 'Visual Editor V2' : 'Visual Editor';
  if (subtitle) subtitle.textContent = active ? "Things You Didn't Know · English · 1080 × 1920" : 'Branded Dialogue V2 · 1080 × 1920';
  if (active) window.dispatchEvent(new Event('things-visual-editor:activate'));
}

selector?.addEventListener('change', (event) => {
  const active = event.currentTarget.value === CONTENT_ID;
  setThingsEditor(active);
  if (active) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

if (new URLSearchParams(location.search).get('scope') === CONTENT_ID || selector?.value === CONTENT_ID) {
  if (selector) selector.value = CONTENT_ID;
  setThingsEditor(true);
}
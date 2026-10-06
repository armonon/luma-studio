// Every frame is an actual app capture. Navigation never changes the app itself.
document.querySelectorAll('[data-after-hours]').forEach(root => {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = [...root.querySelectorAll('[role="tabpanel"]')];
  const dialog = root.querySelector('dialog');
  const expand = root.querySelector('[data-ah-expand]');
  const counter = root.querySelector('[data-ah-count]');
  let current = 0;
  function select(index, focus = false) {
    current = (index + tabs.length) % tabs.length;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === current));
      tab.tabIndex = i === current ? 0 : -1;
      panels[i].hidden = i !== current;
    });
    counter.textContent = `Chapter ${current + 1} of ${tabs.length}`;
    if (focus) tabs[current].focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', event => {
      const moves = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 };
      if (event.key in moves) { event.preventDefault(); select(moves[event.key], true); }
    });
  });
  expand.addEventListener('click', () => {
    const source = panels[current].querySelector('img');
    const target = dialog.querySelector('img');
    target.src = source.src;
    target.alt = source.alt;
    dialog.querySelector('[data-ah-dialog-title]').textContent = tabs[current].textContent.trim();
    dialog.showModal();
  });
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => expand.focus());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  const compareButton = root.querySelector('[data-ah-toggle-compare]');
  const comparison = root.querySelector('[data-ah-comparison]');
  if (compareButton && comparison) {
    const range = comparison.querySelector('input[type="range"]');
    const stage = comparison.querySelector('.ah-compare');
    const output = comparison.querySelector('output');
    range.addEventListener('input', () => {
      stage.style.setProperty('--split', `${range.value}%`);
      output.value = `${range.value}%`;
    });
    compareButton.addEventListener('click', () => {
      comparison.hidden = !comparison.hidden;
      compareButton.setAttribute('aria-expanded', String(!comparison.hidden));
      if (!comparison.hidden) range.focus({ preventScroll: true });
    });
  }
  // A manually started preview stops when another preview starts.
  root.querySelectorAll('audio,video').forEach(media => {
    media.addEventListener('play', () => document.querySelectorAll('.ah audio,.ah video').forEach(other => {
      if (other !== media) other.pause();
    }));
  });
  select(0);
});

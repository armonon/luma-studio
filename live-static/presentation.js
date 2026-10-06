// These controls switch verified photographs and app captures, never simulated UI.
document.querySelectorAll('[data-product-hero]').forEach(root => {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = [...root.querySelectorAll('[role="tabpanel"]')];
  if (!tabs.length) return;
  let selected = 0;
  function select(index, focus = false) {
    selected = (index + tabs.length) % tabs.length;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === selected));
      tab.tabIndex = i === selected ? 0 : -1;
      panels[i].hidden = i !== selected;
    });
    if (focus) tabs[selected].focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', event => {
      const moves = { ArrowRight: selected + 1, ArrowLeft: selected - 1, Home: 0, End: tabs.length - 1 };
      if (event.key in moves) { event.preventDefault(); select(moves[event.key], true); }
    });
  });
  select(0);
});

// Simple search: hide sections that don't mention the query.
const input = document.querySelector('.hero .search');
const cards = [...document.querySelectorAll('section.card')];
input.addEventListener('input', () => {
  const qv = input.value.trim().toLowerCase();
  for (const c of cards) c.classList.toggle('hidden-by-search', !!qv && !c.textContent.toLowerCase().includes(qv));
});

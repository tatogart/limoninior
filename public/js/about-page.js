// Sections below the first screen get a soft entrance when they scroll into view.
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('pop'); io.unobserve(e.target); } }), { threshold: 0.12 }) : null;
if (io) document.querySelectorAll('.reveal').forEach((el) => { if (el.getBoundingClientRect().top > innerHeight) io.observe(el); });

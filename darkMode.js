document.addEventListener('DOMContentLoaded', () => {

  const toggle = document.getElementById('darkModeToggle');

  if (!toggle) return;

  const html = document.documentElement;

  function updateButton() {

    const isDark = html.getAttribute('data-theme') === 'dark';

    const icon = toggle.querySelector('i');
    const text = toggle.querySelector('span');

    if (isDark) {
      icon.className = 'bi bi-sun-fill';
      text.textContent = 'Light Mode';
    } else {
      icon.className = 'bi bi-moon-fill';
      text.textContent = 'Dark Mode';
    }
  }

  toggle.addEventListener('click', () => {

    const isDark = html.getAttribute('data-theme') === 'dark';

    if (isDark) {
      html.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    } else {
      html.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    }

    updateButton();
  });

  updateButton();

});
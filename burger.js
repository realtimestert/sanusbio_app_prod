const menuButton = document.getElementById("menu-toggle");
const menuItems = document.querySelector(".menu");

menuButton.addEventListener("click", function () {
    menuItems.classList.toggle("open");
    menuButton.classList.toggle("open");

    if (menuButton.classList.contains("open")) {
        menuButton.textContent = "✖";
    } else {
        menuButton.textContent = "☰";
    }
})
document.addEventListener("DOMContentLoaded", () => {
  const buttons = document.querySelectorAll(".button");

  buttons.forEach((button) => {
    button.addEventListener("mouseenter", () => {
      button.style.transform = "translateY(-2px)";
    });

    button.addEventListener("mouseleave", () => {
      button.style.transform = "translateY(0)";
    });
  });

  const heroTitle = document.querySelector(".hero-copy h1");
  if (heroTitle) {
    heroTitle.addEventListener("click", () => {
      heroTitle.style.filter = "drop-shadow(0 0 18px rgba(94, 234, 212, 0.4))";
    });
  }
});

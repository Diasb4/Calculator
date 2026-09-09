// Animations and event initialization
document.addEventListener('DOMContentLoaded', function () {
    const cards = document.querySelectorAll('.option-card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(16px)';

        setTimeout(() => {
            card.style.transition = 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, index * 120);
    });
});

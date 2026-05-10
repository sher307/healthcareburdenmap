(function () {
    const header = document.querySelector(".header");
    const btn = document.querySelector(".mobile-menu-btn");
    const nav = header && header.querySelector(".nav");
    if (!btn || !nav) return;

    function setOpen(open) {
        nav.classList.toggle("nav--open", open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
    }

    btn.addEventListener("click", function (e) {
        e.stopPropagation();
        setOpen(!nav.classList.contains("nav--open"));
    });

    nav.querySelectorAll("a").forEach(function (link) {
        link.addEventListener("click", function () {
            setOpen(false);
        });
    });

    document.addEventListener("click", function (e) {
        if (!nav.classList.contains("nav--open")) return;
        if (!e.target.closest(".header")) setOpen(false);
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") setOpen(false);
    });
})();

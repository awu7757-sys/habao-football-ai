(() => {
  "use strict";

  const STYLE_ID = "habaoBackToTopPolishStyle";
  const BUTTON_ID = "habaoBackToTop";

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;

    style.textContent = `
#${BUTTON_ID}{
  position:fixed !important;
  right:14px !important;
  bottom:88px !important;

  width:44px !important;
  height:44px !important;
  min-width:44px !important;
  min-height:44px !important;

  display:flex !important;
  align-items:center !important;
  justify-content:center !important;

  padding:0 !important;
  margin:0 !important;

  border:1px solid rgba(244,195,75,.48) !important;
  border-radius:50% !important;

  background:
    radial-gradient(
      circle at 35% 25%,
      rgba(255,223,116,.13),
      transparent 36%
    ),
    linear-gradient(
      145deg,
      rgba(18,34,43,.98),
      rgba(7,18,27,.98)
    ) !important;

  color:#f5c451 !important;

  box-shadow:
    0 10px 28px rgba(0,0,0,.38),
    0 0 0 1px rgba(255,255,255,.025) inset,
    0 0 18px rgba(244,195,75,.11) !important;

  cursor:pointer !important;
  z-index:99998 !important;

  opacity:0 !important;
  visibility:hidden !important;

  transform:translateY(10px) scale(.96) !important;

  transition:
    opacity .18s ease,
    transform .18s ease,
    border-color .18s ease,
    box-shadow .18s ease,
    background .18s ease !important;

  -webkit-tap-highlight-color:transparent !important;
  appearance:none !important;
  -webkit-appearance:none !important;
}

#${BUTTON_ID}.show{
  opacity:1 !important;
  visibility:visible !important;
  transform:translateY(0) scale(1) !important;
}

#${BUTTON_ID}:hover{
  border-color:rgba(255,211,84,.78) !important;

  box-shadow:
    0 12px 30px rgba(0,0,0,.42),
    0 0 0 1px rgba(255,255,255,.035) inset,
    0 0 22px rgba(244,195,75,.18) !important;
}

#${BUTTON_ID}:active{
  transform:translateY(0) scale(.92) !important;
}

#${BUTTON_ID} svg{
  width:18px !important;
  height:18px !important;

  display:block !important;

  fill:none !important;
  stroke:currentColor !important;
  stroke-width:2.15 !important;
  stroke-linecap:round !important;
  stroke-linejoin:round !important;

  pointer-events:none !important;

  filter:
    drop-shadow(
      0 1px 4px rgba(245,196,81,.18)
    );
}

@media(min-width:601px){
  #${BUTTON_ID}{
    right:18px !important;
    bottom:92px !important;

    width:46px !important;
    height:46px !important;
    min-width:46px !important;
    min-height:46px !important;
  }

  #${BUTTON_ID} svg{
    width:19px !important;
    height:19px !important;
  }
}

@media(prefers-reduced-motion:reduce){
  #${BUTTON_ID}{
    transition:none !important;
  }
}
    `;

    document.head.appendChild(style);
  }

  let button =
    document.getElementById(
      BUTTON_ID
    );

  if (!button) {
    button =
      document.createElement(
        "button"
      );

    button.id =
      BUTTON_ID;

    button.type =
      "button";

    document.body.appendChild(
      button
    );
  }

  button.type =
    "button";

  button.setAttribute(
    "aria-label",
    "回到頂部"
  );

  button.setAttribute(
    "title",
    "回到頂部"
  );

  button.innerHTML = `
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M6.5 14.5 12 9l5.5 5.5"
      ></path>
    </svg>
  `;

  function updateVisibility() {
    button.classList.toggle(
      "show",
      window.scrollY > 280
    );
  }

  if (
    button.dataset
      .habaoTopPolishBound !== "1"
  ) {
    button.dataset
      .habaoTopPolishBound = "1";

    button.addEventListener(
      "click",
      () => {
        window.scrollTo(
          0,
          0
        );

        document.documentElement
          .scrollTop = 0;

        document.body
          .scrollTop = 0;
      }
    );

    window.addEventListener(
      "scroll",
      updateVisibility,
      {
        passive: true
      }
    );
  }

  updateVisibility();
})();

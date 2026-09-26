/* =========================================================
   HABAO GLOBAL I18N
   繁體中文 / 简体中文 / English
========================================================= */

(() => {
  "use strict";

  const STORAGE_KEY = "habao_language";

  const SUPPORTED_LANGS = {
    "zh-Hant": {
      label: "🇹🇼 繁體中文",
      htmlLang: "zh-Hant"
    },

    "zh-Hans": {
      label: "🇨🇳 简体中文",
      htmlLang: "zh-Hans"
    },

    "en": {
      label: "🇺🇸 English",
      htmlLang: "en"
    }
  };


  /* =========================================================
     取得目前語言
  ========================================================= */

  function getLanguage() {
    const saved =
      localStorage.getItem(STORAGE_KEY);

    if (SUPPORTED_LANGS[saved]) {
      return saved;
    }

    return "zh-Hant";
  }


  /* =========================================================
     設定語言
  ========================================================= */

  function setLanguage(lang) {
    if (!SUPPORTED_LANGS[lang]) {
      return;
    }

    localStorage.setItem(
      STORAGE_KEY,
      lang
    );

    document.documentElement.lang =
      SUPPORTED_LANGS[lang].htmlLang;

    window.dispatchEvent(
      new CustomEvent(
        "habao:languagechange",
        {
          detail: {
            language: lang
          }
        }
      )
    );
  }


  /* =========================================================
     翻譯字典
  ========================================================= */

  const translations = {
    "zh-Hant": {},
    "zh-Hans": {},
    "en": {}
  };


  /* =========================================================
     加入頁面翻譯
  ========================================================= */

  function registerTranslations(
    pageTranslations = {}
  ) {
    Object.keys(
      translations
    ).forEach(lang => {
      Object.assign(
        translations[lang],
        pageTranslations[lang] || {}
      );
    });

    applyTranslations();
  }


  /* =========================================================
     取得翻譯文字
  ========================================================= */

  function t(
    key,
    fallback = ""
  ) {
    const lang =
      getLanguage();

    return (
      translations[lang]?.[key] ??
      translations["zh-Hant"]?.[key] ??
      fallback ??
      key
    );
  }


  /* =========================================================
     套用 data-i18n
  ========================================================= */

  function applyTranslations() {
    const lang =
      getLanguage();

    document.documentElement.lang =
      SUPPORTED_LANGS[lang].htmlLang;


    document
      .querySelectorAll("[data-i18n]")
      .forEach(element => {
        const key =
          element.dataset.i18n;

        const value =
          t(
            key,
            element.textContent
          );

        if (value !== undefined) {
          element.textContent =
            value;
        }
      });


    document
      .querySelectorAll(
        "[data-i18n-placeholder]"
      )
      .forEach(element => {
        const key =
          element.dataset
            .i18nPlaceholder;

        const value =
          t(
            key,
            element.getAttribute(
              "placeholder"
            ) || ""
          );

        if (value !== undefined) {
          element.setAttribute(
            "placeholder",
            value
          );
        }
      });


    document
      .querySelectorAll(
        "[data-i18n-aria-label]"
      )
      .forEach(element => {
        const key =
          element.dataset
            .i18nAriaLabel;

        const value =
          t(
            key,
            element.getAttribute(
              "aria-label"
            ) || ""
          );

        if (value !== undefined) {
          element.setAttribute(
            "aria-label",
            value
          );
        }
      });


    document
      .querySelectorAll(
        "[data-i18n-title]"
      )
      .forEach(element => {
        const key =
          element.dataset.i18nTitle;

        const value =
          t(
            key,
            element.getAttribute(
              "title"
            ) || ""
          );

        if (value !== undefined) {
          element.setAttribute(
            "title",
            value
          );
        }
      );


    document
      .querySelectorAll(
        "[data-habao-language-select]"
      )
      .forEach(select => {
        select.value = lang;
      });


    window.dispatchEvent(
      new CustomEvent(
        "habao:translationsapplied",
        {
          detail: {
            language: lang
          }
        }
      )
    );
  }


  /* =========================================================
     建立共用語言選單
  ========================================================= */

  function createLanguageSelector() {
    const wrapper =
      document.createElement("div");

    wrapper.className =
      "habao-language-selector";


    const select =
      document.createElement("select");

    select.setAttribute(
      "data-habao-language-select",
      ""
    );

    select.setAttribute(
      "aria-label",
      "Language"
    );


    Object.entries(
      SUPPORTED_LANGS
    ).forEach(
      ([value, config]) => {
        const option =
          document.createElement(
            "option"
          );

        option.value =
          value;

        option.textContent =
          config.label;

        select.appendChild(
          option
        );
      }
    );


    select.value =
      getLanguage();


    select.addEventListener(
      "change",
      event => {
        setLanguage(
          event.target.value
        );

        applyTranslations();
      }
    );


    wrapper.appendChild(
      select
    );

    return wrapper;
  }


  /* =========================================================
     初始化
  ========================================================= */

  function init() {
    const lang =
      getLanguage();

    document.documentElement.lang =
      SUPPORTED_LANGS[lang].htmlLang;

    applyTranslations();
  }


  /* =========================================================
     對外提供
  ========================================================= */

  window.HabaoI18n = {
    getLanguage,
    setLanguage,
    registerTranslations,
    applyTranslations,
    createLanguageSelector,
    t,

    languages:
      SUPPORTED_LANGS
  };


  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

})();

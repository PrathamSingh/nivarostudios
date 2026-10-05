/*
 * Amount picker for the support page.
 *
 * The page works without this file. The preset amounts are real links whose
 * href this script fills in, and a browser with JavaScript off still gets a
 * working path to Razorpay through the <noscript> block — it just has to
 * type the amount on Razorpay's own page instead of here.
 *
 * Nothing here handles money. It builds a URL; Razorpay shows the amount and
 * takes the payment on their page. That is deliberate: the figure the donor
 * confirms is always Razorpay's, never this script's, so a bug here can
 * annoy somebody but cannot overcharge them.
 */
(function () {
  'use strict';

  /* ----------------------------------------------------------- configure */

  /**
   * One Razorpay Payment Page per currency — a Payment Page is fixed to a
   * single currency, so these cannot be the same link.
   *
   * Use the pages.razorpay.com form, never the rzp.io short link: the short
   * link discards the query string when it redirects, so an amount sent
   * through it silently arrives as nothing.
   *
   * USD needs Razorpay's International Payments activation and a second
   * Payment Page. Until that URL is set, USD is hidden rather than offered
   * as a button that cannot work.
   */
  var PAGES = {
    USD: 'RAZORPAY_USD_PAGE_URL',
    INR: 'https://pages.razorpay.com/nivarostudios'
  };

  /**
   * Whole units, not paise. Verified against the live page on 6 Oct 2026:
   * `?amount=500` renders "₹500" in the amount field and "Pay ₹500.00" on
   * the button. If a future Razorpay change breaks that, this is the only
   * number to touch.
   */
  var UNIT_MULTIPLIER = 1;

  var LIMITS = {
    USD: { min: 1, max: 5000, symbol: '$', code: 'USD' },
    INR: { min: 50, max: 200000, symbol: '₹', code: 'INR' }
  };

  /* --------------------------------------------------------------- state */

  var root = document.querySelector('[data-support]');
  if (!root) return;

  var currency = 'USD';

  var els = {
    tabs: root.querySelectorAll('[data-currency]'),
    panels: root.querySelectorAll('[data-panel]'),
    presets: root.querySelectorAll('[data-amount]'),
    input: root.querySelector('[data-custom-input]'),
    custom: root.querySelector('[data-custom-link]'),
    error: root.querySelector('[data-error]'),
    usdNote: root.querySelector('[data-usd-note]'),
    picker: root.querySelector('[data-picker]'),
    unavailable: root.querySelector('[data-unavailable]')
  };

  var configured = function (code) {
    var url = PAGES[code];
    return typeof url === 'string' && url.indexOf('http') === 0;
  };

  /* --------------------------------------------------------------- build */

  /**
   * The payment URL for an amount.
   *
   * `encodeURIComponent` on a number that has already been through
   * `Number.isFinite` is belt and braces, but the alternative is a page
   * where a crafted "amount" could append anything it liked to the query.
   */
  function urlFor(code, amount) {
    var base = PAGES[code];
    var join = base.indexOf('?') === -1 ? '?' : '&';
    return base + join + 'amount=' + encodeURIComponent(String(amount * UNIT_MULTIPLIER));
  }

  function show(code) {
    currency = code;
    els.tabs.forEach(function (tab) {
      var on = tab.getAttribute('data-currency') === code;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.setAttribute('tabindex', on ? '0' : '-1');
    });
    els.panels.forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-panel') !== code;
    });
    if (els.input) {
      els.input.value = '';
      els.input.setAttribute('placeholder', LIMITS[code].symbol + ' other amount');
      els.input.setAttribute('min', String(LIMITS[code].min));
      els.input.setAttribute('max', String(LIMITS[code].max));
    }
    validate();
  }

  /**
   * Checks the typed amount and either enables the button or says why not.
   *
   * The button is a link, so "disabled" means removing its href — a disabled
   * attribute does nothing to an anchor, and a dead-looking button that
   * still navigates is worse than no button.
   */
  function validate() {
    if (!els.input || !els.custom) return;
    var raw = els.input.value.trim();
    var limit = LIMITS[currency];
    var problem = '';

    if (raw === '') {
      problem = '';
    } else if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      problem = 'Numbers only, please.';
    } else {
      var n = Number(raw);
      if (!isFinite(n) || n <= 0) problem = 'Enter an amount above zero.';
      else if (n < limit.min) problem = 'The smallest is ' + limit.symbol + limit.min + ' — below that the card fee eats most of it.';
      else if (n > limit.max) problem = 'That is above ' + limit.symbol + limit.max.toLocaleString('en') + '. Lovely, but please email me first so I can check it is not a typo.';
    }

    var ok = raw !== '' && problem === '';
    if (ok) {
      els.custom.setAttribute('href', urlFor(currency, Number(raw)));
      els.custom.removeAttribute('aria-disabled');
      els.custom.textContent = 'Give ' + limit.symbol + Number(raw).toLocaleString('en') + ' →';
    } else {
      els.custom.removeAttribute('href');
      els.custom.setAttribute('aria-disabled', 'true');
      els.custom.textContent = 'Give this amount →';
    }

    if (els.error) {
      els.error.textContent = problem;
      els.error.hidden = problem === '';
    }
  }

  /* ---------------------------------------------------------------- wire */

  // Fill in every preset link from the one place the URLs are configured.
  els.presets.forEach(function (link) {
    var code = link.getAttribute('data-panel-currency');
    var amount = Number(link.getAttribute('data-amount'));
    if (!configured(code) || !isFinite(amount)) return;
    link.setAttribute('href', urlFor(code, amount));
  });

  els.tabs.forEach(function (tab) {
    var code = tab.getAttribute('data-currency');
    tab.hidden = !configured(code);
    tab.addEventListener('click', function () { show(code); });
    // Arrow keys move between tabs, as a tablist is expected to.
    tab.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      var codes = ['USD', 'INR'].filter(configured);
      if (codes.length < 2) return;
      var next = codes[(codes.indexOf(currency) + 1) % codes.length];
      show(next);
      root.querySelector('[data-currency="' + next + '"]').focus();
    });
  });

  if (els.input) {
    els.input.addEventListener('input', validate);
    // Enter should submit the way a form would, rather than doing nothing.
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && els.custom && els.custom.getAttribute('href')) {
        e.preventDefault();
        els.custom.click();
      }
    });
  }

  if (els.custom) {
    els.custom.addEventListener('click', function (e) {
      if (!els.custom.getAttribute('href')) {
        e.preventDefault();
        if (els.input) els.input.focus();
      }
    });
  }

  /* --------------------------------------------------------------- start */

  var available = ['USD', 'INR'].filter(configured);
  if (available.length === 0) {
    // Nothing is set up yet: say so plainly rather than offering dead buttons.
    if (els.picker) els.picker.hidden = true;
    if (els.unavailable) els.unavailable.hidden = false;
    return;
  }
  if (els.picker) els.picker.hidden = false;
  // A currency switcher with one currency on it is furniture, not a choice.
  var tablist = root.querySelector('.cur');
  if (tablist) tablist.hidden = available.length < 2;
  // The note about USD settling in rupees is only true if USD is on offer.
  if (els.usdNote) els.usdNote.hidden = available.indexOf('USD') === -1;
  // USD by default where it is available, because most readers are not in India.
  show(available.indexOf('USD') !== -1 ? 'USD' : available[0]);
}());

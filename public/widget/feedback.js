/**
 * Reflectt Feedback Widget — embeddable, self-contained
 * Usage: <script src="/widget/feedback.js" data-token="..." data-theme="auto"></script>
 */
(function() {
  'use strict';

  var script = document.currentScript;
  var token = (script && script.getAttribute('data-token')) || '';
  var theme = (script && script.getAttribute('data-theme')) || 'auto';
  var position = (script && script.getAttribute('data-position')) || 'bottom-right';
  var label = (script && script.getAttribute('data-label')) || 'Feedback';
  var apiBase = (script && script.src) ? new URL(script.src).origin : '';

  // Create host element
  var host = document.createElement('div');
  host.id = 'reflectt-feedback-widget';
  document.body.appendChild(host);

  var shadow = host.attachShadow({ mode: 'closed' });

  // Detect dark mode
  var isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var css = '\
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }\
    * { box-sizing: border-box; }\
    .fb-trigger {\
      position: fixed; ' + (position === 'bottom-left' ? 'left: 24px;' : 'right: 24px;') + ' bottom: 24px;\
      z-index: 999990; padding: 10px 18px; border-radius: 24px; border: none;\
      cursor: pointer; font-size: 14px; font-weight: 600;\
      background: ' + (isDark ? '#2a2a3e' : '#fff') + ';\
      color: ' + (isDark ? '#e0e0e0' : '#333') + ';\
      box-shadow: 0 2px 12px rgba(0,0,0,0.15); transition: ' + (reduceMotion ? 'none' : 'transform 0.15s ease') + ';\
    }\
    .fb-trigger:hover { transform: ' + (reduceMotion ? 'none' : 'translateY(-2px)') + '; }\
    .fb-panel {\
      position: fixed; ' + (position === 'bottom-left' ? 'left: 24px;' : 'right: 24px;') + ' bottom: 80px;\
      z-index: 999991; width: 320px; border-radius: 12px;\
      background: ' + (isDark ? '#1e1e2e' : '#fff') + ';\
      color: ' + (isDark ? '#e0e0e0' : '#333') + ';\
      box-shadow: 0 4px 24px rgba(0,0,0,0.2); overflow: hidden;\
      ' + (reduceMotion ? '' : 'animation: fb-slide-up 0.2s ease-out;') + '\
    }\
    @keyframes fb-slide-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }\
    .fb-header {\
      display: flex; justify-content: space-between; align-items: center;\
      padding: 12px 16px; border-bottom: 1px solid ' + (isDark ? '#333' : '#eee') + ';\
      font-weight: 600; font-size: 14px;\
    }\
    .fb-close { background: none; border: none; cursor: pointer; font-size: 18px; color: ' + (isDark ? '#888' : '#999') + '; padding: 0 4px; }\
    .fb-body { padding: 16px; }\
    .fb-label { font-size: 12px; font-weight: 600; margin-bottom: 6px; color: ' + (isDark ? '#aaa' : '#666') + '; }\
    .fb-radio-group { display: flex; gap: 8px; margin-bottom: 14px; }\
    .fb-radio { display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 13px; }\
    .fb-radio input { margin: 0; }\
    .fb-textarea {\
      width: 100%; min-height: 80px; border-radius: 8px; border: 1px solid ' + (isDark ? '#444' : '#ddd') + ';\
      padding: 10px; font-size: 13px; font-family: inherit; resize: vertical;\
      background: ' + (isDark ? '#2a2a3e' : '#fafafa') + '; color: ' + (isDark ? '#e0e0e0' : '#333') + ';\
    }\
    .fb-textarea:focus { outline: 2px solid #6c63ff; border-color: #6c63ff; }\
    .fb-charcount { font-size: 10px; color: ' + (isDark ? '#666' : '#999') + '; text-align: right; margin-top: 2px; }\
    .fb-input {\
      width: 100%; border-radius: 8px; border: 1px solid ' + (isDark ? '#444' : '#ddd') + ';\
      padding: 8px 10px; font-size: 13px; font-family: inherit; margin-top: 10px;\
      background: ' + (isDark ? '#2a2a3e' : '#fafafa') + '; color: ' + (isDark ? '#e0e0e0' : '#333') + ';\
    }\
    .fb-submit {\
      width: 100%; padding: 10px; border: none; border-radius: 8px; margin-top: 14px;\
      font-size: 14px; font-weight: 600; cursor: pointer;\
      background: #6c63ff; color: #fff; transition: ' + (reduceMotion ? 'none' : 'opacity 0.15s') + ';\
    }\
    .fb-submit:hover { opacity: 0.9; }\
    .fb-submit[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }\
    .fb-success { text-align: center; padding: 24px 16px; font-size: 14px; color: ' + (isDark ? '#8f8' : '#2a7') + '; }\
    .fb-error { text-align: center; padding: 16px; font-size: 13px; color: #e55; }\
    .hidden { display: none; }\
  ';

  var style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);

  var container = document.createElement('div');
  shadow.appendChild(container);

  var state = 'idle'; // idle, open, submitting, success, error

  function render() {
    if (state === 'idle') {
      container.innerHTML = '<button class="fb-trigger" role="button" aria-label="Open feedback panel">💬 ' + escHtml(label) + '</button>';
      container.querySelector('.fb-trigger').addEventListener('click', function() { state = 'open'; render(); });
    } else if (state === 'open') {
      container.innerHTML = '\
        <div class="fb-panel" role="dialog" aria-modal="true" aria-label="Send Feedback">\
          <div class="fb-header"><span>💬 Send Feedback</span><button class="fb-close" aria-label="Close">✕</button></div>\
          <div class="fb-body">\
            <div class="fb-label" id="fb-cat-label">What type?</div>\
            <div class="fb-radio-group" role="radiogroup" aria-labelledby="fb-cat-label">\
              <label class="fb-radio"><input type="radio" name="fb-cat" value="bug" checked> 🐛 Bug</label>\
              <label class="fb-radio"><input type="radio" name="fb-cat" value="feature"> ✨ Feature</label>\
              <label class="fb-radio"><input type="radio" name="fb-cat" value="general"> 💬 Other</label>\
            </div>\
            <textarea class="fb-textarea" placeholder="Describe the issue…" aria-required="true" aria-describedby="fb-chars" maxlength="1000"></textarea>\
            <div class="fb-charcount" id="fb-chars">0 / 1000</div>\
            <input class="fb-input" type="email" placeholder="Email (optional)">\
            <button class="fb-submit" aria-disabled="true">Submit</button>\
          </div>\
        </div>';
      var panel = container.querySelector('.fb-panel');
      var close = container.querySelector('.fb-close');
      var textarea = container.querySelector('.fb-textarea');
      var charcount = container.querySelector('.fb-charcount');
      var emailInput = container.querySelector('.fb-input');
      var submitBtn = container.querySelector('.fb-submit');

      close.addEventListener('click', function() { state = 'idle'; render(); if (previousFocus && previousFocus.focus) previousFocus.focus(); });
      textarea.addEventListener('input', function() {
        charcount.textContent = textarea.value.length + ' / 1000';
        submitBtn.setAttribute('aria-disabled', textarea.value.trim().length < 10 ? 'true' : 'false');
      });
      textarea.focus();

      // Focus trap + Escape to close
      var previousFocus = shadow.activeElement || document.activeElement;
      panel.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { state = 'idle'; render(); if (previousFocus && previousFocus.focus) previousFocus.focus(); return; }
        if (e.key === 'Tab') {
          var focusable = panel.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])');
          if (focusable.length === 0) return;
          var first = focusable[0];
          var last = focusable[focusable.length - 1];
          if (e.shiftKey) {
            if (shadow.activeElement === first || document.activeElement === first) { e.preventDefault(); last.focus(); }
          } else {
            if (shadow.activeElement === last || document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }
      });

      submitBtn.addEventListener('click', function() {
        if (submitBtn.getAttribute('aria-disabled') === 'true') return;
        var cat = container.querySelector('input[name="fb-cat"]:checked');
        doSubmit(cat ? cat.value : 'bug', textarea.value.trim(), emailInput.value.trim());
      });
    } else if (state === 'success') {
      container.innerHTML = '\
        <div class="fb-panel"><div class="fb-success">✅ Thanks! We got it.</div></div>';
      setTimeout(function() { state = 'idle'; render(); }, 3000);
    } else if (state === 'error') {
      container.innerHTML = '\
        <div class="fb-panel"><div class="fb-error">Something went wrong. <a href="#" style="color:#6c63ff">Try again.</a></div></div>';
      container.querySelector('a').addEventListener('click', function(e) { e.preventDefault(); state = 'open'; render(); });
    }
  }

  function doSubmit(category, message, email) {
    state = 'submitting';
    var submitBtn = container.querySelector('.fb-submit');
    if (submitBtn) { submitBtn.setAttribute('aria-disabled', 'true'); submitBtn.textContent = 'Submitting…'; }

    var body = {
      category: category,
      message: message,
      siteToken: token,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: Date.now()
    };
    if (email) body.email = email;

    fetch(apiBase + '/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(res) {
      if (res.ok) { state = 'success'; } else { state = 'error'; }
      render();
    }).catch(function() {
      state = 'error';
      render();
    });
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  render();
})();

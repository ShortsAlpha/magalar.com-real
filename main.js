/* ==========================================================================
   Magalar — main.js
   Vanilla JS. GSAP + ScrollTrigger are optional enhancements: if the CDN
   fails, every section still renders and works.
   ========================================================================== */
(function () {
  'use strict';

  window.__magalarBooted = true;

  var html = document.documentElement;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var hasIO = 'IntersectionObserver' in window;
  var easeOutExpo = function (t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); };
  var easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };

  function safe(name, fn) {
    try { fn(); } catch (err) {
      html.classList.add('reveal-all');
      if (window.console && console.warn) console.warn('[magalar] ' + name + ' disabled:', err);
    }
  }

  /* ------------------------------------------------------------------------
     Preloader — draws the mark, counts to 100, wipes away. Never sticks.
     ------------------------------------------------------------------------ */
  var onLoadedQueue = [];
  function whenLoaded(fn) { if (html.classList.contains('is-loaded')) fn(); else onLoadedQueue.push(fn); }

  function initPreloader() {
    var pl = $('#preloader');
    var num = $('#preloader-num');
    var start = performance.now();
    var done = false;

    if (num && !reduced) {
      (function tick() {
        if (done) return;
        var p = Math.min(1, (performance.now() - start) / 1150);
        num.textContent = String(Math.round(easeOutCubic(p) * 100)).padStart(2, '0');
        if (p < 1) requestAnimationFrame(tick);
      })();
    }

    function finish() {
      if (done) return;
      done = true;
      if (num) num.textContent = '100';
      html.classList.add('is-loaded');
      if (pl) {
        pl.classList.add('is-done');
        setTimeout(function () { if (pl.parentNode) pl.parentNode.removeChild(pl); }, 1000);
      }
      onLoadedQueue.splice(0).forEach(function (fn) { safe('loaded-cb', fn); });
    }

    setTimeout(finish, reduced ? 150 : 1300);
    window.addEventListener('load', function () {
      setTimeout(finish, Math.max(0, 900 - (performance.now() - start)));
    });
    setTimeout(finish, 2200); // absolute safety
  }

  /* ------------------------------------------------------------------------
     Text splitting
     ------------------------------------------------------------------------ */
  function splitHeroChars() {
    var line = $('.hero-title [data-chars]');
    if (!line) return;
    var text = line.textContent;
    var title = line.closest('h1');
    if (title) title.setAttribute('aria-label', title.textContent.replace(/\s+/g, ' ').trim());
    line.textContent = '';
    line.setAttribute('aria-hidden', 'true');
    var frag = document.createDocumentFragment();
    Array.prototype.forEach.call(text, function (ch, i) {
      var s = document.createElement('span');
      s.className = 'char';
      s.style.setProperty('--i', i);
      s.textContent = ch;
      frag.appendChild(s);
    });
    line.appendChild(frag);
    if (title) { var l2 = $('.ht-line-2', title); if (l2) l2.setAttribute('aria-hidden', 'true'); }
  }

  function splitHeadings() {
    $$('[data-split]').forEach(function (el) {
      var counter = 0;
      el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());

      function wrap(contentNode) {
        var w = document.createElement('span'); w.className = 'w'; w.setAttribute('aria-hidden', 'true');
        var wi = document.createElement('span'); wi.className = 'wi'; wi.style.setProperty('--i', counter++);
        w.appendChild(wi); wi.appendChild(contentNode);
        return w;
      }
      function process(node) {
        Array.prototype.slice.call(node.childNodes).forEach(function (child) {
          if (child.nodeType === 3) {
            var parts = child.nodeValue.split(/(\s+)/);
            var frag = document.createDocumentFragment();
            parts.forEach(function (part) {
              if (!part) return;
              if (/^\s+$/.test(part)) frag.appendChild(document.createTextNode(' '));
              else frag.appendChild(wrap(document.createTextNode(part)));
            });
            node.replaceChild(frag, child);
          } else if (child.nodeType === 1 && child.tagName !== 'BR') {
            // keep inline elements (em, gradients) whole so styling stays continuous
            var placeholder = document.createTextNode('');
            node.replaceChild(placeholder, child);
            node.replaceChild(wrap(child), placeholder);
          }
        });
      }
      process(el);
      el.classList.add('is-split');
    });
  }

  /* ------------------------------------------------------------------------
     Reveal on scroll
     ------------------------------------------------------------------------ */
  function initReveals() {
    // sibling stagger
    $$('[data-reveal]').forEach(function (el) {
      var sibs = Array.prototype.filter.call(el.parentElement.children, function (c) { return c.hasAttribute('data-reveal'); });
      var idx = sibs.indexOf(el);
      if (sibs.length > 2 && idx > 0) el.style.setProperty('--rd', Math.min(idx * 0.08, 0.48) + 's');
    });

    var targets = $$('[data-reveal], [data-split], .tour-card');
    if (!hasIO || reduced) { targets.forEach(function (el) { el.classList.add('is-in'); }); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    targets.forEach(function (el) { io.observe(el); });
  }

  /* ------------------------------------------------------------------------
     Nav: glass on scroll, hide on scroll-down, active link, mobile menu
     ------------------------------------------------------------------------ */
  function initNav() {
    var nav = $('#nav');
    var burger = $('.burger');
    var menu = $('#mobile-menu');
    var progress = $('.scroll-progress span');
    var toTop = $('.to-top');
    var lastY = window.scrollY;
    var ticking = false;

    function onScroll() {
      var y = window.scrollY;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      nav.classList.toggle('is-scrolled', y > 30);
      if (!html.classList.contains('menu-open')) nav.classList.toggle('is-hidden', y > 700 && y > lastY + 2);
      if (y < lastY - 2) nav.classList.remove('is-hidden');
      lastY = y;
      if (progress) progress.style.transform = 'scaleX(' + p + ')';
      if (toTop) {
        toTop.classList.toggle('is-visible', y > 800);
        toTop.style.setProperty('--p', String(1 - p));
      }
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    onScroll();

    // Mobile menu
    function setMenu(open) {
      html.classList.toggle('menu-open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      menu.setAttribute('aria-hidden', String(!open));
      if (open) nav.classList.remove('is-hidden');
    }
    burger.addEventListener('click', function () { setMenu(!html.classList.contains('menu-open')); });
    $$('a', menu).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && html.classList.contains('menu-open')) { setMenu(false); burger.focus(); } });
    window.addEventListener('resize', function () { if (window.innerWidth > 1000 && html.classList.contains('menu-open')) setMenu(false); });

    // Active link
    if (hasIO) {
      var links = $$('.nav-links a');
      var map = {};
      links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          var a = map[e.target.id];
          if (a && e.isIntersecting) {
            links.forEach(function (l) { l.classList.remove('is-active'); l.removeAttribute('aria-current'); });
            a.classList.add('is-active'); a.setAttribute('aria-current', 'true');
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
    }
  }

  /* ------------------------------------------------------------------------
     Custom cursor (fine pointers only)
     ------------------------------------------------------------------------ */
  function initCursor() {
    if (!finePointer || reduced) return;
    var dot = $('.cursor-dot'), ring = $('.cursor-ring'), label = $('.cursor-label');
    if (!dot || !ring) return;
    html.classList.add('has-cursor');
    var mx = -100, my = -100, rx = -100, ry = -100, moved = false;

    window.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      if (!moved) { rx = mx; ry = my; moved = true; }
      dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)';
    }, { passive: true });

    document.addEventListener('mouseover', function (e) {
      var t = e.target.closest ? e.target.closest('a, button, [data-cursor], input, .tilt, [role="switch"]') : null;
      var labelTarget = e.target.closest ? e.target.closest('[data-cursor]') : null;
      ring.classList.toggle('is-hover', !!t && !labelTarget);
      ring.classList.toggle('is-label', !!labelTarget);
      label.textContent = labelTarget ? labelTarget.getAttribute('data-cursor') : '';
    });
    document.addEventListener('mouseleave', function () { dot.classList.add('is-hidden'); ring.classList.add('is-hidden'); });
    document.addEventListener('mouseenter', function () { dot.classList.remove('is-hidden'); ring.classList.remove('is-hidden'); });
    document.addEventListener('mousedown', function () { ring.style.scale = '0.85'; });
    document.addEventListener('mouseup', function () { ring.style.scale = ''; });

    (function loop() {
      rx += (mx - rx) * 0.17;
      ry += (my - ry) * 0.17;
      ring.style.transform = 'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0)';
      requestAnimationFrame(loop);
    })();
  }

  /* ------------------------------------------------------------------------
     Hero canvas — flow-field particles with a cursor vortex
     ------------------------------------------------------------------------ */
  function initHeroCanvas() {
    var canvas = $('.hero-canvas');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var hero = $('.hero');
    var small = window.matchMedia('(max-width: 700px)').matches || !finePointer;
    var palette = ['123,92,255', '255,93,115', '255,184,77', '244,239,230'];
    var weights = [0.38, 0.3, 0.2, 0.12];
    var W = 0, H = 0, dpr = 1, particles = [], t = 0;
    var running = false, inView = true, raf = 0;
    var mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };

    function pickColor() {
      var r = Math.random(), acc = 0;
      for (var i = 0; i < weights.length; i++) { acc += weights[i]; if (r <= acc) return i; }
      return 0;
    }
    function spawn(p, initial) {
      p.x = Math.random() * W;
      p.y = Math.random() * H;
      p.px = p.x; p.py = p.y;
      p.life = initial ? Math.floor(Math.random() * 200) : 0;
      p.max = 160 + Math.random() * 260;
      p.speed = 0.45 + Math.random() * 1.1;
      p.c = pickColor();
      p.w = Math.random() < 0.08 ? 1.6 : 0.8;
      return p;
    }
    function resize() {
      var rect = canvas.getBoundingClientRect();
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var target = small ? 240 : Math.min(950, Math.round((W * H) / 1500));
      particles.length = 0;
      for (var i = 0; i < target; i++) particles.push(spawn({}, true));
    }
    function field(x, y) {
      var s = 0.0019;
      return (Math.sin(x * s + t * 0.55) + Math.cos(y * s * 1.35 - t * 0.42) + Math.sin((x - y) * s * 0.6 + t * 0.27)) * 1.15;
    }

    // buckets: color x alpha level
    var LEVELS = 5;
    var buckets = [];
    for (var c = 0; c < palette.length; c++) { buckets[c] = []; for (var l = 0; l < LEVELS; l++) buckets[c][l] = []; }

    function step() {
      t += 0.004;
      mouse.x += (mouse.tx - mouse.x) * 0.08;
      mouse.y += (mouse.ty - mouse.y) * 0.08;

      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.075)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      var R = small ? 140 : 220, R2 = R * R;
      for (var ci = 0; ci < palette.length; ci++) for (var li = 0; li < LEVELS; li++) buckets[ci][li].length = 0;

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var a = field(p.x, p.y);
        var vx = Math.cos(a) * p.speed, vy = Math.sin(a) * p.speed;
        var dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 1) {
          var d = Math.sqrt(d2), f = (1 - d / R);
          f = f * f * 3.2;
          vx += (-dy / d) * f + (dx / d) * f * 0.35;
          vy += (dx / d) * f + (dy / d) * f * 0.35;
        }
        p.px = p.x; p.py = p.y;
        p.x += vx; p.y += vy;
        p.life++;
        if (p.life > p.max || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) { spawn(p, false); continue; }
        var alpha = Math.sin(Math.PI * p.life / p.max);
        var lvl = Math.min(LEVELS - 1, Math.floor(alpha * LEVELS));
        buckets[p.c][lvl].push(p);
      }

      for (var c2 = 0; c2 < palette.length; c2++) {
        for (var l2 = 0; l2 < LEVELS; l2++) {
          var list = buckets[c2][l2];
          if (!list.length) continue;
          ctx.strokeStyle = 'rgba(' + palette[c2] + ',' + (0.12 + (l2 / LEVELS) * 0.5).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (var k = 0; k < list.length; k++) { var q = list[k]; ctx.moveTo(q.px, q.py); ctx.lineTo(q.x, q.y); }
          ctx.stroke();
        }
      }
    }
    function loop() {
      if (!running) return;
      step();
      raf = requestAnimationFrame(loop);
    }
    function start() { if (running || reduced) return; running = true; raf = requestAnimationFrame(loop); }
    function stop() { running = false; cancelAnimationFrame(raf); }
    function update() { if (inView && !document.hidden) start(); else stop(); }

    resize();
    if (reduced) {
      // a single still composition
      for (var n = 0; n < 140; n++) step();
      return;
    }
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resize, 200); });
    hero.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect();
      mouse.tx = e.clientX - r.left; mouse.ty = e.clientY - r.top;
      if (mouse.x < -1000) { mouse.x = mouse.tx; mouse.y = mouse.ty; }
    }, { passive: true });
    hero.addEventListener('pointerleave', function () { mouse.tx = -9999; mouse.ty = -9999; mouse.x = -9999; mouse.y = -9999; });
    document.addEventListener('visibilitychange', update);
    if (hasIO) new IntersectionObserver(function (e) { inView = e[0].isIntersecting; update(); }).observe(hero);
    update();
  }

  /* ------------------------------------------------------------------------
     Hero mockup — publishing loop + pointer parallax
     ------------------------------------------------------------------------ */
  function initMockup() {
    var status = $('.mock-status'), text = $('.ms-text');
    var chips = $$('.mock-channels .chip.is-on');
    var stage = $('.mock-stage'), hero = $('.hero');
    if (!status || !text) return;

    var labels = { ready: 'Scheduled for Thu 9:41 AM', publishing: 'Publishing…', done: 'Published to 4 channels' };
    function set(state) { status.setAttribute('data-state', state); text.textContent = labels[state]; }

    if (!reduced) {
      var timers = [];
      var later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };
      (function cycle() {
        timers.forEach(clearTimeout); timers = [];
        if (document.hidden) { later(cycle, 1000); return; }
        chips.forEach(function (c) { c.classList.remove('is-sent'); });
        set('ready');
        later(function () {
          set('publishing');
          chips.forEach(function (c, i) { later(function () { c.classList.add('is-sent'); }, 350 + i * 380); });
        }, 1600);
        later(function () { set('done'); }, 3600);
        later(cycle, 6600);
      })();
    } else {
      set('done');
      chips.forEach(function (c) { c.classList.add('is-sent'); });
    }

    // Pointer parallax across depth layers
    if (!finePointer || reduced || !stage || !hero) return;
    var layers = $$('[data-depth]', stage).map(function (el) { return { el: el, d: parseFloat(el.dataset.depth) || 1, main: el.classList.contains('mock-main') }; });
    var tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, active = false;
    function render() {
      cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
      layers.forEach(function (l) {
        var x = (cx * l.d * 14).toFixed(2), y = (cy * l.d * 10).toFixed(2);
        l.el.style.transform = l.main
          ? 'translate3d(' + x + 'px,' + y + 'px,0) rotateY(' + (-7 + cx * 7).toFixed(2) + 'deg) rotateX(' + (4 - cy * 5).toFixed(2) + 'deg)'
          : 'translate3d(' + x + 'px,' + y + 'px,0)';
      });
      if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) raf = requestAnimationFrame(render); else active = false;
    }
    hero.addEventListener('pointermove', function (e) {
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
      if (!active) { active = true; raf = requestAnimationFrame(render); }
    }, { passive: true });
    hero.addEventListener('pointerleave', function () { tx = 0; ty = 0; if (!active) { active = true; raf = requestAnimationFrame(render); } });
  }

  /* ------------------------------------------------------------------------
     Automation recipe — nodes light up in sequence
     ------------------------------------------------------------------------ */
  function initRecipe() {
    var root = $('.recipe'), statusEl = $('#rc-status');
    if (!root || !statusEl) return;
    var nodes = $$('.rc-node', root);
    var steps = ['Product launched · Spring Drop', 'Studio drafted 6 posts', 'Approved in #marketing by Leah', 'Queued for Thu 9:41 AM · best time'];
    if (reduced) return; // static, fully-lit state from the markup

    var inView = false, running = false, timer = 0;
    function reset() {
      nodes.forEach(function (n) { n.classList.remove('is-lit'); });
      statusEl.classList.remove('is-done');
      statusEl.textContent = 'Waiting for trigger…';
    }
    function run(i) {
      if (!inView || document.hidden) { running = false; return; }
      if (i < nodes.length) {
        nodes[i].classList.add('is-lit');
        statusEl.textContent = steps[i];
        timer = setTimeout(function () { run(i + 1); }, 1150);
      } else {
        statusEl.textContent = 'Run complete · 6 posts scheduled';
        statusEl.classList.add('is-done');
        timer = setTimeout(function () { reset(); timer = setTimeout(function () { run(0); }, 900); }, 2800);
      }
    }
    function start() { if (running) return; running = true; clearTimeout(timer); reset(); timer = setTimeout(function () { run(0); }, 600); }

    if (!hasIO) return;
    new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting;
      if (inView) start();
    }, { threshold: 0.35 }).observe(root);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && inView) start(); });
  }

  /* ------------------------------------------------------------------------
     Product cards — tilt + cursor-following glow
     ------------------------------------------------------------------------ */
  function initTilt() {
    if (!finePointer || reduced) return;
    $$('.tilt').forEach(function (card) {
      var raf = 0;
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function () {
          card.classList.add('is-tilting');
          card.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
          card.style.setProperty('--my', (y * 100).toFixed(1) + '%');
          card.style.setProperty('--rx', ((0.5 - y) * 9).toFixed(2) + 'deg');
          card.style.setProperty('--ry', ((x - 0.5) * 11).toFixed(2) + 'deg');
        });
      });
      card.addEventListener('pointerleave', function () {
        cancelAnimationFrame(raf);
        card.classList.remove('is-tilting');
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ------------------------------------------------------------------------
     Count-up stats
     ------------------------------------------------------------------------ */
  function initCounters() {
    var els = $$('.count');
    if (!hasIO || reduced) return; // final values are already in the markup
    els.forEach(function (el) { el.textContent = (0).toFixed(+el.dataset.decimals || 0); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var el = e.target, to = parseFloat(el.dataset.to), dec = +el.dataset.decimals || 0;
        var start = performance.now(), dur = 2200;
        (function tick(now) {
          var p = Math.min(1, (now - start) / dur);
          el.textContent = (to * easeOutExpo(p)).toFixed(dec);
          if (p < 1) requestAnimationFrame(tick); else el.textContent = to.toFixed(dec);
        })(start);
      });
    }, { threshold: 0.5 });
    els.forEach(function (el) { io.observe(el); });
    // Safety: never leave zeros on screen
    setTimeout(function () {
      els.forEach(function (el) { if (parseFloat(el.textContent) === 0 && el.getBoundingClientRect().top < window.innerHeight) el.textContent = parseFloat(el.dataset.to).toFixed(+el.dataset.decimals || 0); });
    }, 8000);
  }

  /* ------------------------------------------------------------------------
     GSAP: pinned horizontal workflow tour + subtle parallax
     ------------------------------------------------------------------------ */
  function initGsap() {
    var gsap = window.gsap, ST = window.ScrollTrigger;
    if (!gsap || !ST || reduced) return;
    gsap.registerPlugin(ST);
    html.classList.add('has-gsap');

    var track = $('.tour-track'), pin = $('.tour-pin'), bar = $('.tour-progress span');
    var mm = gsap.matchMedia();
    mm.add('(min-width: 900px)', function () {
      var dist = function () { return Math.max(0, track.scrollWidth - window.innerWidth); };
      gsap.to(track, {
        x: function () { return -dist(); },
        ease: 'none',
        scrollTrigger: {
          trigger: pin,
          start: 'top top',
          end: function () { return '+=' + dist(); },
          pin: true,
          scrub: 0.8,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: function (self) { if (bar) bar.style.transform = 'scaleX(' + self.progress.toFixed(4) + ')'; }
        }
      });
      gsap.fromTo('.tour-orb', { scale: 0.7 }, { scale: 1.25, ease: 'none', scrollTrigger: { trigger: pin, start: 'top top', end: function () { return '+=' + dist(); }, scrub: true } });
    });

    gsap.to('.mock-stage', { y: -70, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.hero-inner', { yPercent: -10, opacity: 0.25, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.fromTo('.footer-word', { yPercent: 40 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: true } });
    gsap.fromTo('.stats-kicker', { x: -30 }, { x: 30, ease: 'none', scrollTrigger: { trigger: '.stats', start: 'top bottom', end: 'bottom top', scrub: true } });

    var refresh = function () { ST.refresh(); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
    window.addEventListener('load', refresh);
    whenLoaded(function () { setTimeout(refresh, 300); });
  }

  /* ------------------------------------------------------------------------
     Generated team avatars (seeded, deterministic)
     ------------------------------------------------------------------------ */
  function initAvatars() {
    var colors = ['#7b5cff', '#ff5d73', '#ffb84d', '#46e3b7', '#4fd1ff', '#f4efe6'];
    function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    $$('.avatar[data-seed]').forEach(function (el) {
      var seed = +el.dataset.seed, r = rng(seed * 9973);
      var c1 = colors[Math.floor(r() * 5)], c2 = colors[(colors.indexOf(c1) + 1 + Math.floor(r() * 3)) % 5], c3 = colors[Math.floor(r() * colors.length)];
      var id = 'av' + seed;
      var ang = Math.floor(r() * 360);
      var sunX = 20 + r() * 60, sunY = 14 + r() * 30, sunR = 10 + r() * 16;
      var headR = 13 + r() * 4, headX = 46 + r() * 8, headY = 44 + r() * 4;
      var rings = '';
      var nr = 2 + Math.floor(r() * 3);
      for (var i = 0; i < nr; i++) rings += '<circle cx="' + sunX.toFixed(1) + '" cy="' + sunY.toFixed(1) + '" r="' + (sunR + 6 + i * 7).toFixed(1) + '" fill="none" stroke="rgba(255,255,255,' + (0.28 - i * 0.06).toFixed(2) + ')" stroke-width=".7"/>';
      var stripes = '';
      if (r() > 0.5) for (var s = 0; s < 6; s++) stripes += '<path d="M0 ' + (70 + s * 6) + 'H100" stroke="rgba(255,255,255,.08)" stroke-width="1"/>';
      el.innerHTML =
        '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><linearGradient id="' + id + 'g" gradientTransform="rotate(' + ang + ' .5 .5)"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient>' +
        '<radialGradient id="' + id + 's"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".5" stop-color="' + c3 + '" stop-opacity=".6"/><stop offset="1" stop-color="' + c3 + '" stop-opacity="0"/></radialGradient>' +
        '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121219"/><stop offset="1" stop-color="#07070a"/></linearGradient></defs>' +
        '<rect width="100" height="100" fill="url(#' + id + 'g)"/>' + stripes +
        '<circle cx="' + sunX.toFixed(1) + '" cy="' + sunY.toFixed(1) + '" r="' + sunR.toFixed(1) + '" fill="url(#' + id + 's)"/>' + rings +
        '<path d="M' + (headX - 36).toFixed(1) + ' 104C' + (headX - 34).toFixed(1) + ' 76 ' + (headX - 18).toFixed(1) + ' 66 ' + headX.toFixed(1) + ' 66S' + (headX + 34).toFixed(1) + ' 76 ' + (headX + 36).toFixed(1) + ' 104Z" fill="url(#' + id + 'b)"/>' +
        '<circle cx="' + headX.toFixed(1) + '" cy="' + headY.toFixed(1) + '" r="' + headR.toFixed(1) + '" fill="url(#' + id + 'b)"/>' +
        '<circle cx="' + headX.toFixed(1) + '" cy="' + headY.toFixed(1) + '" r="' + (headR + 0.6).toFixed(1) + '" fill="none" stroke="' + c2 + '" stroke-opacity=".7" stroke-width=".8"/>' +
        '</svg>';
    });
  }

  /* ------------------------------------------------------------------------
     Testimonials carousel
     ------------------------------------------------------------------------ */
  function initCarousel() {
    var root = $('.carousel');
    if (!root) return;
    var slides = $$('.slide', root), dots = $$('.carousel-dots button', root);
    var DUR = 6500, idx = 0, timer = 0, startedAt = 0, remaining = DUR, paused = false;
    root.style.setProperty('--dur', DUR + 'ms');

    function go(i) {
      idx = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.classList.toggle('is-active', k === idx); s.setAttribute('aria-hidden', String(k !== idx)); });
      dots.forEach(function (d, k) { d.setAttribute('aria-selected', 'false'); if (k === idx) { void d.offsetWidth; d.setAttribute('aria-selected', 'true'); } });
      remaining = DUR;
      schedule();
    }
    function schedule() {
      clearTimeout(timer);
      if (paused || reduced) return;
      startedAt = performance.now();
      timer = setTimeout(function () { go(idx + 1); }, remaining);
    }
    function pause() { if (paused) return; paused = true; clearTimeout(timer); remaining = Math.max(400, remaining - (performance.now() - startedAt)); root.classList.add('is-paused'); }
    function resume() { if (!paused) return; paused = false; root.classList.remove('is-paused'); schedule(); }

    dots.forEach(function (d, k) { d.addEventListener('click', function () { go(k); }); });
    $('.c-prev', root).addEventListener('click', function () { go(idx - 1); });
    $('.c-next', root).addEventListener('click', function () { go(idx + 1); });
    root.addEventListener('mouseenter', pause);
    root.addEventListener('mouseleave', resume);
    root.addEventListener('focusin', pause);
    root.addEventListener('focusout', function (e) { if (!root.contains(e.relatedTarget)) resume(); });
    root.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') go(idx + 1); if (e.key === 'ArrowLeft') go(idx - 1); });
    var sx = null;
    root.addEventListener('pointerdown', function (e) { sx = e.clientX; });
    root.addEventListener('pointerup', function (e) { if (sx === null) return; var dx = e.clientX - sx; if (Math.abs(dx) > 50) go(idx + (dx < 0 ? 1 : -1)); sx = null; });
    document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); else if (!root.matches(':hover')) resume(); });
    if (reduced) root.classList.add('is-paused');
    go(0);
  }

  /* ------------------------------------------------------------------------
     Pricing toggle
     ------------------------------------------------------------------------ */
  function initPricing() {
    var sw = $('.switch');
    if (!sw) return;
    var labels = $$('.billing-label');
    sw.addEventListener('click', function () {
      var yearly = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(yearly));
      labels.forEach(function (l) { l.classList.toggle('is-on', (l.dataset.for === 'yearly') === yearly); });
      $$('.plan .amt').forEach(function (el) {
        var from = parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0;
        var to = parseFloat(yearly ? el.dataset.yearly : el.dataset.monthly);
        if (from === to) return;
        el.classList.add('is-swapping');
        var start = performance.now(), dur = reduced ? 1 : 650;
        (function tick(now) {
          var p = Math.min(1, (now - start) / dur);
          el.textContent = Math.round(from + (to - from) * easeOutCubic(p));
          if (p > 0.35) el.classList.remove('is-swapping');
          if (p < 1) requestAnimationFrame(tick);
        })(start);
      });
      $$('.plan .billed[data-monthly]').forEach(function (b) { b.textContent = yearly ? b.dataset.yearly : b.dataset.monthly; });
    });
  }

  /* ------------------------------------------------------------------------
     Magnetic buttons
     ------------------------------------------------------------------------ */
  function initMagnetic() {
    if (!finePointer || reduced) return;
    var items = $$('.magnetic, .magnetic-sm').map(function (el) {
      return { el: el, text: $('.btn-text', el), strong: el.classList.contains('magnetic'), active: false };
    });
    var raf = 0, mx = 0, my = 0;
    window.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        items.forEach(function (it) {
          var r = it.el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) return;
          var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          var dx = mx - cx, dy = my - cy;
          var reach = it.strong ? Math.max(r.width, r.height) * 0.9 + 60 : Math.max(r.width, r.height) * 0.6;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < reach) {
            var k = it.strong ? 0.38 : 0.2;
            it.el.style.transform = 'translate(' + (dx * k).toFixed(1) + 'px,' + (dy * k * 1.1).toFixed(1) + 'px)';
            if (it.text) it.text.style.transform = 'translate(' + (dx * 0.12).toFixed(1) + 'px,' + (dy * 0.12).toFixed(1) + 'px)';
            it.active = true;
          } else if (it.active) {
            it.el.style.transform = ''; if (it.text) it.text.style.transform = ''; it.active = false;
          }
        });
      });
    }, { passive: true });
  }

  /* ------------------------------------------------------------------------
     Forms — inline validation + success state
     ------------------------------------------------------------------------ */
  function initForms() {
    var re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    var check = '<span class="ok-icon"><svg width="14" height="14" aria-hidden="true"><use href="#check"/></svg></span>';
    $$('form[data-form]').forEach(function (form) {
      var input = $('input[type="email"]', form), msg = $('.form-msg', form);
      var isNews = form.classList.contains('newsletter');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = input.value.trim();
        if (!re.test(v)) {
          msg.className = 'form-msg is-error';
          msg.textContent = v ? 'That email looks a little off — try again?' : 'Add your email and we\'ll save you a seat.';
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        input.removeAttribute('aria-invalid');
        form.classList.add('is-success-state');
        msg.className = 'form-msg is-success';
        msg.innerHTML = check + (isNews ? 'Subscribed. The next Monday Brief lands in your inbox this week.' : 'You\'re in. Check ' + v.replace(/[<>&"]/g, '') + ' for your workspace link — your 14-day trial starts now.');
        input.value = '';
        var btnText = $('.btn-text', form);
        if (btnText) btnText.textContent = 'Check your inbox';
      });
      input.addEventListener('input', function () {
        if (msg.classList.contains('is-error')) { msg.textContent = ''; msg.className = 'form-msg'; input.removeAttribute('aria-invalid'); }
      });
    });
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */
  safe('preloader', initPreloader);
  safe('hero-split', splitHeroChars);
  safe('split', splitHeadings);
  safe('reveal', initReveals);
  safe('nav', initNav);
  safe('cursor', initCursor);
  safe('canvas', initHeroCanvas);
  safe('mockup', initMockup);
  safe('tilt', initTilt);
  safe('counters', initCounters);
  safe('avatars', initAvatars);
  safe('gsap', initGsap);
  safe('recipe', initRecipe);
  safe('carousel', initCarousel);
  safe('pricing', initPricing);
  safe('magnetic', initMagnetic);
  safe('forms', initForms);
})();

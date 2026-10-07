# Magalar — magalar.com (social media & marketing automation SaaS)
Run locally: double-click `start.bat` (Windows), or `python3 -m http.server 8000` / `npx serve` in this folder, then open http://localhost:8000
Files: `index.html` (markup + content), `styles.css` (design tokens at the top, then sections), `main.js` (all interactions), `favicon.svg` (logo mark).
No build step. GSAP + ScrollTrigger load from cdnjs as an optional enhancement; everything still works if the CDN fails.
To rebrand, edit the color/font variables in `:root` at the top of `styles.css`.

# LFG Design Playbook, for Claude Code

How to make LFG posters, social graphics, and announcements that look like a real agency made them, not AI slop.

**How to install this:** drop this file in your project root as `CLAUDE.md` (Claude Code reads it automatically), or keep the name and start every design task with: "Read LFG-DESIGN-PLAYBOOK.md first, then…". Follow it every time.

---

## 0. The one rule that fixes 90% of the slop

**Never let an AI image generator produce the final artwork when it contains text or a logo.**

AI generators (Higgsfield, Midjourney, DALL·E, etc.) garble dates, misspell words, and redraw logos wrong. That is the #1 reason a poster looks cheap. Instead:

1. Lay the design out in **HTML/CSS** so you control every pixel of type and spacing.
2. Drop in the **real photo** and the **real logo files** (PNG/SVG with transparency).
3. **Render it to an image** with headless Chrome/Edge (command below).

AI is allowed for ONE thing only: generating a **background texture or photographic backdrop** when you have no photo. Even then, you composite the real text and logos on top in HTML. The AI never writes the words.

---

## 1. The slop tells (if your design has these, it's slop, kill them)

- Generic purple/blue gradients, or a rainbow of colors. Real brands use 2-3 colors, max.
- Everything centered. Centered everything reads amateur. Use a left-aligned grid with one focal point.
- Default fonts: Inter, Poppins, Montserrat, Roboto. Overused = invisible. Use the brand fonts below.
- Garbled or fake text baked into an AI image. Instant giveaway.
- A logo that's "close but wrong" (redrawn by AI). Always use the real logo file.
- Drop shadows and glows on everything. One subtle shadow for separation, that's it.
- Emoji as design elements. No.
- Stock-looking AI faces. Use real member photos.
- No hierarchy: five things all the same size. There must be ONE biggest thing.
- No breathing room: edge-to-edge clutter. Negative space is what makes it look expensive.

---

## 2. The method (every poster / social graphic)

1. **Gather real assets.** The photo (high-res), and every logo as a transparent PNG or SVG. Confirm what they actually are by opening them.
2. **Look at references first, don't design from memory.** Search "running club poster", "event poster design", or the relevant genre on the web / Pinterest / Behance. Open 3-4 strong ones. Note their layout, type scale, color restraint, and treatment. Your mental image of "good design" is the same average everyone's AI ships, beat it by looking at real award-level work.
3. **Build it in HTML/CSS** using the template in section 7. Real photo as background, real logos placed crisply, exact text.
4. **Render to PNG at 2× resolution** (section 6).
5. **Critique and fix** against the rubric (section 5). Screenshot it, actually look at it, score it /10, fix anything under 9, re-render. Two or three passes. Never ship the first render.

---

## 3. LFG brand system (use these exact values)

**Colors**
- Ink / background: `#0A0A0A`
- Off-white / text: `#F4F1E9`
- Olive accent (the brand green): `#999966`. On a dark photo, brighten it to `#C2C28A` so it stays legible.
- That's it. No gold. No purple. The "premium" look comes from restraint + contrast + spacing, not from adding colors.

**Type**
- Display / headlines: **Barlow Condensed**, weights 800-900, UPPERCASE, tight letter-spacing (`-0.01em` to `-0.02em` on big sizes). This is the athletic, condensed look.
- Body / small labels: **Barlow**, 400-600. Labels in uppercase with wide tracking (`0.2em-0.32em`).
- Load from Google Fonts. Max 2 type families on one design.

**Logos**
- Use the white LFG crest file. Keep clear space around it. Never stretch, recolor, or add effects to it.
- Partner logos (PUMA, Culture Deli, etc.) go in a consistent footer/lockup, at a size that visually balances with the LFG mark.

**Voice (any words on the design)**
- Short, punchy, confident. No filler, no adverbs, no em dashes. "All levels", "Run or jog", "Every Wednesday". Not "Come join our amazing community for an incredible run!"

**Photography**
- Real LFG members, motion, real Dubai locations. Grade it cinematic (see section 4). Never stock, never AI faces.

---

## 4. The "designer feel" recipe (cinematic photo + type)

This is what turns a flat photo into a poster. All of it is CSS over the real photo:

- **Full-bleed photo:** `object-fit: cover` with `object-position` tuned so the subject sits where you want.
- **Grade:** `filter: contrast(1.07) saturate(0.9) brightness(0.9);`, slightly moody, never over-saturated.
- **Scrims (gradients for legibility):** a soft dark gradient at the top for the logo, a strong dark gradient at the bottom for the text block. Text must sit on a dark area to be readable.
- **Vignette:** a radial gradient darkening the edges, pulls the eye to center.
- **Film grain:** an SVG noise overlay at ~12-15% opacity, `mix-blend-mode: overlay`. Adds the analog, premium texture.
- **Keyline frame:** a 1px hairline border inset ~34px from the edges. Editorial, magazine feel.

**Type hierarchy on the poster:**
- One tiny eyebrow label (olive, uppercase, wide tracking).
- One GIANT hero element (the date, the hook, or the venue), this is the only big thing.
- One supporting line (time / day) in the accent color.
- One spec line (distance, pace, "all levels") in muted text with dot separators.
- A footer lockup with logos + the website / handle.

---

## 5. QA rubric, score before you ship (target 9/10)

Render it, screenshot it, look at it, and score honestly:

1. **Hierarchy**, is there one obvious biggest thing your eye hits first?
2. **Type**, only 2 fonts? Condensed display used? No default Inter/Poppins?
3. **Palette**, 2-3 colors only, disciplined? No random gradients?
4. **Spacing**, generous margins, aligned to a grid, real negative space?
5. **Legibility**, every word readable over its background (scrims doing their job)?
6. **Signature element**, one memorable thing (the grain, the frame, the giant date)?
7. **Brand fit**, looks unmistakably LFG (dark, olive, condensed, cinematic)?
8. **No slop tells** (section 1), none present?

Below 9? Fix the weakest item and re-render. Repeat. The difference between slop and 10/10 is almost always these 2-3 fix passes.

---

## 6. Render command (HTML → high-res PNG, no special tools)

Headless Edge or Chrome renders your `poster.html` to a crisp 2× image. Set window-size to your canvas size; `--force-device-scale-factor=2` doubles the output resolution.

**Windows (Edge), in PowerShell.** Use `Start-Process -Wait` so it blocks until the file is written. Calling the .exe directly (`& msedge ...`) often returns before the screenshot finishes and you get no file, that is the most common reason "it didn't work":
```
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
Start-Process -FilePath $edge -NoNewWindow -Wait -ArgumentList @(
  '--headless=new','--disable-gpu','--hide-scrollbars',
  '--force-device-scale-factor=2','--window-size=1080,1350',
  '--virtual-time-budget=12000','--allow-file-access-from-files',
  '--screenshot=C:\FULL\PATH\TO\poster.png','file:///C:/FULL/PATH/TO/poster.html'
)
```

**Mac/Linux (Chrome).** The direct call blocks until done, so it works as-is:
```
/path/to/chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=1080,1350 --virtual-time-budget=12000 --allow-file-access-from-files --screenshot=/FULL/PATH/TO/poster.png "file:///FULL/PATH/TO/poster.html"
```

Use absolute paths for the `--screenshot` output and the `file://` URL so the image lands where you expect (a relative output path can save to the wrong folder). Fonts load from Google Fonts at render time, so you need internet when you render (or install Barlow + Barlow Condensed locally); `--virtual-time-budget` gives them time to load.

- `--window-size=1080,1350` = Instagram feed (4:5). Story = `1080,1920`. Output is 2× (2160×2700 etc.).
- `--virtual-time-budget=12000` gives fonts + images time to load before the shot.
- Put `poster.html` in the same folder as the photo + logo files and reference them by filename.

---

## 7. Copy-paste starter template (`poster.html`)

Fill in the photo, logos, and text. This is the exact structure behind the good LFG posters.

```html
<!DOCTYPE html><html><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--ink:#0A0A0A;--paper:#F4F1E9;--olive:#C2C28A;--muted:rgba(244,241,233,.62);--fh:'Barlow Condensed',Impact,sans-serif;--fb:'Barlow',Arial,sans-serif}
  html,body{width:1080px;height:1350px}
  .poster{position:relative;width:1080px;height:1350px;overflow:hidden;background:var(--ink)}
  .bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 20%;filter:contrast(1.07) saturate(.9) brightness(.9)}
  .scrim-top{position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,7,9,.66),rgba(6,7,9,.1) 22%,transparent 38%)}
  .scrim-bot{position:absolute;inset:0;background:linear-gradient(0deg,rgba(5,6,8,.97),rgba(5,6,8,.88) 26%,rgba(5,6,8,.36) 48%,transparent 64%)}
  .vignette{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 38%,transparent 52%,rgba(0,0,0,.5))}
  .grain{position:absolute;inset:-50%;width:200%;height:200%;opacity:.15;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
  .frame{position:absolute;inset:34px;border:1px solid rgba(244,241,233,.22)}
  .wrap{position:absolute;inset:34px;display:flex;flex-direction:column;justify-content:space-between;padding:54px 56px}
  .top{display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:14px}.brand img{height:52px}
  .brand .bn{font-family:var(--fh);font-weight:700;font-size:21px;letter-spacing:.22em;color:var(--paper);text-transform:uppercase}
  .top .rc{font-family:var(--fh);font-weight:700;font-size:15px;letter-spacing:.34em;color:var(--olive);text-transform:uppercase}
  .eyebrow{font-family:var(--fh);font-weight:700;font-size:21px;letter-spacing:.34em;color:var(--olive);text-transform:uppercase;margin-bottom:16px}
  .hero{font-family:var(--fh);font-weight:900;font-size:188px;line-height:.8;letter-spacing:-.02em;color:var(--paper);text-transform:uppercase}
  .sub{font-family:var(--fh);font-weight:700;font-size:44px;letter-spacing:.06em;color:var(--paper);text-transform:uppercase;margin-top:14px}.sub b{color:var(--olive)}
  .spec{display:flex;align-items:center;gap:16px;font-family:var(--fh);font-weight:600;font-size:27px;letter-spacing:.1em;color:var(--muted);text-transform:uppercase;margin-top:18px}
  .spec .d{width:5px;height:5px;border-radius:50%;background:var(--olive)}.spec strong{color:var(--paper);font-weight:700}
  .rule{height:1px;background:rgba(244,241,233,.18);margin:30px 0 22px}
  .venue{display:flex;align-items:center;gap:22px}
  .venue .lbl{font-family:var(--fb);font-weight:600;font-size:14px;letter-spacing:.3em;color:var(--muted);text-transform:uppercase;max-width:120px;line-height:1.4}
  .venue img{height:82px}
  .foot{display:flex;justify-content:space-between;margin-top:30px;font-family:var(--fh);font-weight:700;font-size:16px;letter-spacing:.26em;color:var(--muted);text-transform:uppercase}.foot .r{color:var(--olive)}
</style></head><body>
  <div class="poster">
    <img class="bg" src="photo.png">
    <div class="scrim-top"></div><div class="scrim-bot"></div><div class="vignette"></div><div class="grain"></div><div class="frame"></div>
    <div class="wrap">
      <div class="top"><div class="brand"><img src="lfg.png"><span class="bn">LFG Dubai</span></div><div class="rc">Run Club</div></div>
      <div>
        <div class="eyebrow">New Run Location</div>
        <div class="hero">1 July</div>
        <div class="sub">Wednesday <b>·</b> 7:30 PM</div>
        <div class="spec"><strong>5 KM / 30 MIN</strong><span class="d"></span>Run or Jog<span class="d"></span>All Levels</div>
        <div class="rule"></div>
        <div class="venue"><span class="lbl">Now Meeting At</span><img src="culture.png"></div>
        <div class="foot"><span>lfgdubai.com</span><span class="r">@lfg_squad</span></div>
      </div>
    </div>
  </div>
</body></html>
```

Swap `photo.png` / `lfg.png` / `culture.png` and the text, retune `object-position` and `--hero font-size`, render, critique, fix. That loop is the whole game.

---

## TL;DR for the owner
1. Don't generate posters with AI. Build them in HTML/CSS with the real photo + real logos, render with the command above.
2. Stick to the brand: `#0A0A0A`, `#F4F1E9`, `#999966`, Barlow Condensed. 2 fonts, 3 colors.
3. One giant focal element, lots of space, grain + scrims + a keyline frame.
4. Render, look at it, score it /10, fix until it's a 9+. Never ship the first try.

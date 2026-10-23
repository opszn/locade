from pathlib import Path


OUT = Path(__file__).resolve().parents[1] / 'design' / 'brand'
OUT.mkdir(parents=True, exist_ok=True)

INK = '#252722'
PAPER = '#F4F1E9'
ORANGE = '#F35B35'


def button(color, x=96, y=77, radius=34):
    # The raised counter makes the lower rim read as an arcade button.
    r = radius
    inner = r * 21 / 34
    cy = y - r * 4 / 34
    return f'<path fill="{color}" fill-rule="evenodd" d="M{x-r} {y}a{r} {r} 0 1 0 {2*r} 0a{r} {r} 0 1 0 {-2*r} 0 M{x-inner} {cy}a{inner} {inner} 0 1 0 {2*inner} 0a{inner} {inner} 0 1 0 {-2*inner} 0"/>'


def wordmark(ink=INK, accent=ORANGE):
    return f'''<g fill="none" stroke="{ink}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
  <path d="M18 21V87Q18 105 36 105H40"/>
  <path d="M201 57C177 37 150 49 150 77S177 117 201 97"/>
  <circle cx="251" cy="77" r="28"/><path d="M279 49V105"/>
  <circle cx="333" cy="77" r="28"/><path d="M361 21V105"/>
  <path d="M443 96C432 110 411 111 398 99C380 82 389 49 414 49C433 49 446 62 446 77H390"/>
</g>{button(accent)}'''


def svg(body, viewbox, label):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" role="img" aria-label="{label}">
<title>{label}</title>{body}</svg>'''


assets = {
    'locade-wordmark.svg': svg(wordmark(), '0 0 466 132', 'Locade'),
    'locade-wordmark-dark.svg': svg(wordmark(PAPER), '0 0 466 132', 'Locade, light lettering'),
    'locade-wordmark-mono.svg': svg(wordmark(INK, INK), '0 0 466 132', 'Locade, monochrome'),
    'locade-icon.svg': svg(button(ORANGE, 64, 64, 48), '0 0 128 128', 'Locade button icon'),
    'locade-app-icon.svg': svg(f'<rect width="128" height="128" rx="30" fill="{INK}"/>' + button(ORANGE, 64, 64, 40), '0 0 128 128', 'Locade app icon'),
    'locade-icon-mono.svg': svg(button(INK, 64, 64, 48), '0 0 128 128', 'Locade monochrome button icon'),
    'favicon.svg': svg(f'<rect width="32" height="32" rx="8" fill="{INK}"/>' + button(ORANGE, 16, 16, 11), '0 0 32 32', 'Locade favicon'),
}
for name, content in assets.items():
    (OUT / name).write_text(content)

(OUT / 'index.html').write_text('''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Locade / Identity 001</title><link rel="icon" href="favicon.svg">
<style>
@font-face{font-family:Board;src:local("Avenir Next");font-weight:100 900}
@font-face{font-family:Editorial;src:local("Baskerville")}
:root{--paper:#f4f1e9;--ink:#252722;--accent:#f35b35;--muted:#76786d;--line:#d9d7cc}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Board,"Trebuchet MS",sans-serif}
main{max-width:1440px;margin:auto;padding:38px 64px 32px}
header{display:flex;align-items:center;justify-content:space-between;font-size:11px;letter-spacing:2px;font-weight:600;padding-bottom:26px;border-bottom:1px solid var(--line)}
.id{display:flex;align-items:center;gap:10px}.dot{width:8px;height:8px;background:var(--accent);border-radius:50%}
.hero{position:relative;padding:70px 0 55px;display:flex;flex-direction:column;align-items:center;overflow:hidden}
.hero:before{content:"";position:absolute;inset:16px 0 0;background-image:radial-gradient(#aaa99c 0.7px,transparent 0.7px);background-size:15px 15px;opacity:.18;mask-image:radial-gradient(ellipse at center,#000,transparent 68%);pointer-events:none}
.eyebrow{font-size:10px;letter-spacing:3px;color:var(--muted);margin:0 0 18px}.hero>img{width:min(600px,86%);z-index:1}
h1{font-family:Editorial,Georgia,serif;font-size:30px;font-weight:400;letter-spacing:-.5px;margin:20px 0 7px}.intro{font-size:12px;color:var(--muted);margin:0}
.grid{display:grid;grid-template-columns:1.35fr 1fr 1fr;border:1px solid var(--line);border-radius:18px;overflow:hidden}
.panel{min-height:247px;padding:23px 26px;position:relative}.panel+.panel{border-left:1px solid var(--line)}
.label{font-size:9px;letter-spacing:1.8px;font-weight:600;color:var(--muted)}.sub{position:absolute;left:26px;bottom:19px;font-size:10px;color:var(--muted)}
.dark{background:var(--ink);color:var(--paper)}.dark .label,.dark .sub{color:#b1b3a5}.dark>img{display:block;width:90%;max-width:300px;margin:35px auto 0}
.sizes{height:155px;display:flex;align-items:center;justify-content:center;gap:25px}.size{display:flex;flex-direction:column;align-items:center;gap:12px}.size span{font-family:monospace;font-size:9px;color:var(--muted)}
.mono{display:flex;align-items:center;justify-content:center;height:155px}.mono img{width:95%;max-width:270px}
.lower{display:grid;grid-template-columns:1.35fr 1fr 1fr;margin-top:18px;gap:18px}.note{padding:17px 0}.note h2{font-size:16px;font-weight:500;margin:0 0 9px}.note p{font-size:12px;line-height:1.7;color:var(--muted);max-width:340px;margin:0}
.browser{border:1px solid var(--line);border-radius:12px;background:#faf8f2;overflow:hidden;align-self:start}.browser-top{display:flex;align-items:center;gap:5px;padding:10px 12px;border-bottom:1px solid var(--line)}.browser-top i{width:5px;height:5px;border-radius:50%;background:#cecec4}.tab{margin-left:8px;display:flex;align-items:center;gap:6px;font-size:9px}.tab img{width:14px;height:14px}.browser-body{padding:17px}.browser-body img{width:91px}.projects{display:flex;gap:8px;margin-top:14px}.project{height:42px;border:1px solid #dddcd0;border-radius:5px;flex:1;background:linear-gradient(135deg,#e8ecdf,#f2f1e7)}.project:nth-child(2){background:linear-gradient(135deg,#f1d2bd,#f4e5d5)}.project:nth-child(3){background:linear-gradient(135deg,#cbd7d6,#e5ece6)}
.palette{display:flex;gap:7px;margin-top:15px}.swatch{height:43px;flex:1;border-radius:7px;border:1px solid #00000010;display:flex;align-items:end;padding:7px;font:8px monospace}
footer{margin-top:27px;border-top:1px solid var(--line);padding-top:16px;display:flex;justify-content:space-between;font-size:9px;color:var(--muted);letter-spacing:1px}
.download{color:var(--ink);text-underline-offset:3px;text-decoration-color:var(--muted)}
@media(prefers-reduced-motion:no-preference){.hero>img{animation:reveal .65s ease-out both}@keyframes reveal{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}}
@media(max-width:760px){main{padding:24px}header{font-size:9px;letter-spacing:1px}.hero{padding:54px 0 40px}h1{font-size:25px}.intro{font-size:10px;text-align:center}.grid,.lower{grid-template-columns:1fr}.panel+.panel{border-left:0;border-top:1px solid var(--line)}.panel{min-height:220px}.lower{gap:5px}.note{padding:18px 0}.browser{margin-bottom:12px}footer{gap:14px;line-height:1.6}}
</style>
</head>
<body><main>
<header><div class="id"><span class="dot"></span> LOCADE / IDENTITY EXPLORATION</div><span>CONCEPT 001 &nbsp; / &nbsp; THE BUTTON</span></header>
<section class="hero"><p class="eyebrow">A LITTLE LESS WORK. A LITTLE MORE PLAY.</p><img src="locade-wordmark.svg" alt="Locade custom wordmark with an orange button o"><h1>Your localhost, ready to play.</h1><p class="intro">An arcade for the things you build.</p></section>
<section class="grid" aria-label="Logo variations">
<article class="panel dark"><div class="label">01 / AFTER HOURS</div><img src="locade-wordmark-dark.svg" alt="Locade on dark background"><div class="sub">Same identity. Lights out.</div></article>
<article class="panel"><div class="label">02 / SMALL, BUT STILL PLAYFUL</div><div class="sizes"><div class="size"><img src="locade-app-icon.svg" width="72" height="72" alt="72 pixel app icon"><span>72 px</span></div><div class="size"><img src="locade-app-icon.svg" width="32" height="32" alt="32 pixel app icon"><span>32 px</span></div><div class="size"><img src="favicon.svg" width="16" height="16" alt="16 pixel favicon"><span>16 px</span></div></div><div class="sub">The letter becomes the launcher.</div></article>
<article class="panel"><div class="label">03 / NO COLOR REQUIRED</div><div class="mono"><img src="locade-wordmark-mono.svg" alt="Monochrome wordmark"></div><div class="sub">One ink. No gradients. All vector.</div></article>
</section>
<section class="lower">
<article class="note"><h2>One button. Many possibilities.</h2><p>Soft geometric lettering, with a raised arcade button hiding in the o. Familiar enough for a developer tool. Playful enough for a side project.</p></article>
<article class="browser" aria-label="Browser application mockup"><div class="browser-top"><i></i><i></i><i></i><span class="tab"><img src="favicon.svg" alt="">Locade &middot; Your projects</span></div><div class="browser-body"><img src="locade-wordmark.svg" alt="Locade"><div class="projects"><div class="project"></div><div class="project"></div><div class="project"></div></div></div></article>
<article class="note"><div class="label">THE STARTER PALETTE</div><div class="palette"><div class="swatch" style="background:#252722;color:#f4f1e9">#252722</div><div class="swatch" style="background:#f4f1e9">#F4F1E9</div><div class="swatch" style="background:#f35b35;color:#252722">#F35B35</div></div><p style="margin-top:9px">Charcoal / Warm paper / Insert coin</p></article>
</section>
<footer><span>LOCADE &nbsp; / &nbsp; ORIGINAL VECTOR LETTERING</span><a class="download" href="locade-wordmark.svg" download>WORDMARK SVG &darr;</a><span>DIRECTION STUDY &nbsp; / &nbsp; V0.1</span></footer>
</main></body></html>''')

(OUT / 'README.md').write_text('''# Locade identity - direction 001

First concept: custom lowercase geometric lettering with an offset-counter
arcade button as the letter o. All logo assets are vector paths, with no font
dependencies. The HTML specimen uses optional local fonts with fallbacks.

## Files

- `index.html`: responsive identity specimen.
- `locade-wordmark.svg`: charcoal lettering, orange button, transparent background.
- `locade-wordmark-dark.svg`: warm-paper lettering for dark backgrounds.
- `locade-wordmark-mono.svg`: single-color lettering.
- `locade-icon.svg`: standalone transparent button.
- `locade-app-icon.svg`: button on a charcoal rounded-square tile.
- `locade-icon-mono.svg`: monochrome standalone button.
- `favicon.svg`: dedicated small-size favicon.
- `preview.png`: rendered desktop specimen.

Palette: charcoal #252722, paper #F4F1E9, orange #F35B35.
This is a design draft, not a trademark or name-availability clearance.
No repository or open-source license is initialized in this draft folder.
''')
print(OUT)

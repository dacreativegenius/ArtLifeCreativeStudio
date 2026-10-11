import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Printer, X } from "lucide-react";
import { ArtLifeLogo } from "./ArtLifeLogo";

/**
 * v1.0.7 Feature Guide — a printable breakdown of every tool and setting.
 * Opens over the studio (the drawing stays open underneath). "Save as PDF" uses the system print
 * dialog: choose "Save as PDF" / "Microsoft Print to PDF" as the printer.
 */

type Row = { name: string; key: string; text: string };

const TOOLS: Row[] = [
  { name: "Selection", key: "V", text: "Tap any object to select it and drag to move. Corner handles scale, the top handle rotates. Tapping a pencil stroke selects the whole sketch on that layer." },
  { name: "Direct Selection", key: "A", text: "Edit single anchor points and bezier handles. Drag the little corner circle to round a sharp corner live. Tap two path ends, then Join (Ctrl J) to connect them." },
  { name: "Move", key: "M", text: "Drags the selection or, with nothing selected, the whole active layer." },
  { name: "Transform", key: "T", text: "Scale and rotate with large touch-friendly handles. Shift snaps rotation to 15° steps." },
  { name: "Freeform Select", key: "Q", text: "Lasso any shape. On a pencil layer it lifts only the part you circled into its own piece, so you can move, scale or rotate it while the rest of the sketch stays put." },
  { name: "Brush", key: "B", text: "Draws with the active brush. Pencil brushes go on pencil layers and vector brushes on vector layers. The right layer type is picked or created for you." },
  { name: "Eraser", key: "E", text: "Rubs out pencil grain. On vector art it cuts through shapes and splits them into separate pieces." },
  { name: "Live Paint Bucket", key: "G", text: "Fills any enclosed area, even one made from several overlapping strokes, with a real vector shape. Tolerance is adjustable." },
  { name: "Eyedropper", key: "I", text: "Picks a colour from the canvas into Stroke or Fill. Hold Alt with the Brush or Bucket for a quick pick." },
  { name: "Pen", key: "P", text: "Illustrator-style bezier paths. Click for corners and drag for curves. Click an anchor again to cut its outgoing handle. Click the end of any open path to keep drawing it, or the end of another path to join them." },
  { name: "Add / Delete Anchor", key: "+ / −", text: "Add a point anywhere on a path or remove one without breaking the shape." },
  { name: "Anchor Point", key: "Shift C", text: "Toggles an anchor between smooth and corner, or pulls a single handle out on one side only." },
  { name: "Line · Rectangle · Ellipse", key: "L · U · O", text: "Clean vector shapes with optional stroke and fill. Shift keeps them straight, square or round." },
  { name: "Hand · Zoom", key: "H · Z", text: "Pan and zoom the canvas. On touch screens, one finger pans and two fingers pinch-zoom and rotate the view." },
];

const BRUSHES: Row[] = [
  { name: "Sketch Pencil", key: "1", text: "Pressure-sensitive graphite grain. Width and darkness follow your stylus, with soft tapered ends. Settled grain is cached, so even very long strokes stay smooth." },
  { name: "Tech Pencil", key: "2", text: "An even, technical line with a crisp graphite core under the grain. Good for construction lines and clean sketching." },
  { name: "Pressure Ink", key: "3", text: "A true vector brush that turns your stroke into a filled, tapered shape. Edges are smoothed against stylus jitter and export to SVG as clean outlines." },
  { name: "Mono Liner", key: "4", text: "A fixed-width vector line with light stabilising. It keeps the corners you draw and ends exactly where you lift the pen." },
];

const SHORTCUTS: Row[] = [
  { name: "Undo · Redo", key: "Ctrl Z · Ctrl Shift Z", text: "" },
  { name: "Cut · Copy · Paste", key: "Ctrl X · C · V", text: "" },
  { name: "Select all on layer · Deselect", key: "Ctrl A · Ctrl D", text: "" },
  { name: "Group · Ungroup", key: "Ctrl G · Ctrl Shift G", text: "" },
  { name: "Join end anchors", key: "Ctrl J", text: "" },
  { name: "Bring forward · to front", key: "Ctrl ] · Ctrl Shift ]", text: "" },
  { name: "Save .dtm · Export SVG", key: "Ctrl S · Ctrl Shift S", text: "" },
  { name: "Open file · New project", key: "Ctrl O · Ctrl Alt N", text: "" },
  { name: "Fit canvas · Zoom in / out", key: "Ctrl 0 · Ctrl + / −", text: "" },
  { name: "Brush size", key: "[ · ]", text: "" },
  { name: "Stroke ⇄ Fill target · Swap colours", key: "X · Shift X", text: "" },
  { name: "Default colours", key: "D", text: "" },
  { name: "Nudge selection", key: "Arrows (Shift = 10 px)", text: "" },
  { name: "Delete selection", key: "Delete", text: "" },
];

export function GuideButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Feature guide · save it as a PDF"
        className="inline-flex h-8 items-center gap-ds-xs rounded-md px-ds-sm text-label text-muted-foreground hover:bg-secondary hover:text-foreground" data-oid="fb98f26225">
        <BookOpen className="h-4 w-4" data-oid="79e9d37a68" />
        <span className="max-lg:hidden" data-oid="58bdaf04b6">Guide</span>
      </button>
      {open && createPortal(<Guide onClose={() => setOpen(false)} />, document.body)}
    </>);
}

function Guide({ onClose }: {onClose: () => void;}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Art Life feature guide"
      className="fixed inset-0 z-[100] overflow-y-auto bg-background text-foreground print:static print:overflow-visible"
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }} data-oid="bef474b40d" data-oid-component-root="true">
      <div className="pointer-events-none fixed -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-primary/10 blur-3xl print:hidden" data-oid="3932c5bfb0" />

      <div className="sticky top-0 z-10 flex items-center justify-end gap-ds-sm border-b border-border bg-card px-ds-lg py-ds-sm print:hidden" data-oid="7906007a6d">
        <p className="mr-auto type-caption text-muted-foreground" data-oid="caa1b548f3">TIP · CHOOSE “SAVE AS PDF” IN THE PRINT WINDOW</p>
        <button type="button" onClick={() => window.print()} className="ds-button ds-button-primary inline-flex items-center gap-ds-xs" data-oid="38ac922ed3">
          <Printer className="h-4 w-4" data-oid="3b845f4117" /> Save as PDF
        </button>
        <button type="button" onClick={onClose} aria-label="Close guide" className="ds-button ds-button-secondary inline-flex items-center gap-ds-xs" data-oid="aec490038f">
          <X className="h-4 w-4" data-oid="d601ce3a78" /> Close
        </button>
      </div>

      <article className="relative mx-auto max-w-4xl px-ds-xl py-ds-3xl print:max-w-none print:px-ds-lg print:py-ds-lg" data-oid="9d07638327">
        <header className="mb-ds-3xl border-b border-border pb-ds-2xl" data-oid="61dc4c87fe">
          <div className="mb-ds-lg flex items-center gap-ds-md" data-oid="af93686abe">
            <ArtLifeLogo className="h-10 w-10 text-primary" strokeWidth={32} />
            <p className="type-caption text-primary" data-oid="538a03ed80">ART LIFE CREATIVE STUDIO · v1.0.7 FEATURE GUIDE</p>
          </div>
          <h1 className="font-display text-[3.25rem] font-bold leading-[1.05] tracking-[-0.03em] text-foreground" data-oid="5936b52305">A sketchbook and a vector studio in one app.</h1>
          <p className="mt-ds-lg max-w-2xl text-[1.0625rem] font-light leading-relaxed text-muted-foreground" data-oid="77c069127b">
            Art Life puts pressure-sensitive pencil sketching and real vector tools side by side, built for stylus and touch first. One file format works on every device: Windows, Android tablets, iPad and the web.
          </p>
          <ul className="mt-ds-xl grid grid-cols-2 gap-ds-sm md:grid-cols-4" data-oid="d65abd1ec2">
            <li className="rounded-lg border border-border bg-card p-ds-md" data-oid="562a9fa737">
              <p className="type-caption text-primary" data-oid="d5dd7f01f1">WINDOWS</p>
              <p className="mt-ds-xs type-label text-foreground" data-oid="4d66a46098">Portable .exe, no install</p>
            </li>
            <li className="rounded-lg border border-border bg-card p-ds-md" data-oid="b6c020f886">
              <p className="type-caption text-primary" data-oid="25dd5d02fa">ANDROID</p>
              <p className="mt-ds-xs type-label text-foreground" data-oid="1ec77b4338">Native APK, S Pen + Wacom</p>
            </li>
            <li className="rounded-lg border border-border bg-card p-ds-md" data-oid="8b6398ad5f">
              <p className="type-caption text-primary" data-oid="ec8397cb1a">IPAD · WEB</p>
              <p className="mt-ds-xs type-label text-foreground" data-oid="67935a3eac">Apple Pencil tuned, works offline</p>
            </li>
            <li className="rounded-lg border border-border bg-card p-ds-md" data-oid="fd70b29a45">
              <p className="type-caption text-primary" data-oid="1b16869ba8">.DTM FILES</p>
              <p className="mt-ds-xs type-label text-foreground" data-oid="cdec583c2c">Open on any device</p>
            </li>
          </ul>
        </header>

        <section className="mb-ds-3xl" data-oid="6d5fc827da">
          <p className="type-caption text-accent" data-oid="292ececd0a">01</p>
          <h2 className="mt-ds-xs text-[1.75rem] font-bold tracking-[-0.02em] text-foreground" data-oid="317509f2c1">What makes Art Life special</h2>
          <ol className="mt-ds-lg grid gap-ds-md md:grid-cols-2" data-oid="c623ec7846">
            <li className="break-inside-avoid rounded-lg border-l-2 border-primary bg-card p-ds-lg" data-oid="95b3066e01">
              <h3 className="type-heading text-foreground" data-oid="25dfdf01b1">Pencil + vector in one file</h3>
              <p className="mt-ds-xs type-body text-muted-foreground" data-oid="22b8697726">Pencil layers keep grain for sketching, and vector layers hold editable ink, shapes and paths. Every new mark goes to the right layer type automatically.</p>
            </li>
            <li className="break-inside-avoid rounded-lg border-l-2 border-primary bg-card p-ds-lg" data-oid="7931d280db">
              <h3 className="type-heading text-foreground" data-oid="7ae79c8abe">Hold-to-shape</h3>
              <p className="mt-ds-xs type-body text-muted-foreground" data-oid="1e92a4439a">Draw a line, circle, ellipse, square or curve and hold the pen still for 1 second. It snaps to a clean shape and keeps your brush, colour and size. Lines lock to 0°, 45° and 90° when close.</p>
            </li>
            <li className="break-inside-avoid rounded-lg border-l-2 border-primary bg-card p-ds-lg" data-oid="4b5fe48b01">
              <h3 className="type-heading text-foreground" data-oid="add583c3b3">Lag-free long sessions</h3>
              <p className="mt-ds-xs type-body text-muted-foreground" data-oid="e5412050c0">Stroke prediction, once-per-frame input batching, viewport culling and incremental layer caching keep drawing smooth after hours of work, even on large canvases.</p>
            </li>
            <li className="break-inside-avoid rounded-lg border-l-2 border-primary bg-card p-ds-lg" data-oid="daaa839ec0">
              <h3 className="type-heading text-foreground" data-oid="15f28e9fcc">Illustrator-friendly export</h3>
              <p className="mt-ds-xs type-body text-muted-foreground" data-oid="eebb424f56">SVG export keeps layers as groups and writes brush strokes with a slimmed set of anchor points, so artwork opens clean in Adobe Illustrator.</p>
            </li>
            <li className="break-inside-avoid rounded-lg border-l-2 border-accent bg-card p-ds-lg" data-oid="9cd6e13956">
              <h3 className="type-heading text-foreground" data-oid="35516a7e30">Tuned for every stylus</h3>
              <p className="mt-ds-xs type-body text-muted-foreground" data-oid="ee26f0101c">Pressure filtering for Wacom, S Pen, Surface Pen and Apple Pencil. On iPad the Pencil draws while fingers pan and pinch, and the pencil grain is reinforced so strokes never break into dots.</p>
            </li>
            <li className="break-inside-avoid rounded-lg border-l-2 border-accent bg-card p-ds-lg" data-oid="b2b6cd99d5">
              <h3 className="type-heading text-foreground" data-oid="be73c495ae">No keyboard needed</h3>
              <p className="mt-ds-xs type-body text-muted-foreground" data-oid="e4c0ac6d37">Multi-select, Group / Ungroup, Join, Cut, Delete, Nest and Merge are all on-screen buttons, so tablets have the full workflow.</p>
            </li>
          </ol>
        </section>

        <section className="mb-ds-3xl" data-oid="44f2691eb1">
          <p className="type-caption text-accent" data-oid="527de817bf">02</p>
          <h2 className="mt-ds-xs text-[1.75rem] font-bold tracking-[-0.02em] text-foreground" data-oid="8a70cb40f1">Tools</h2>
          <dl className="mt-ds-lg divide-y divide-border rounded-lg border border-border bg-card" data-oid="a31d2e9594">
            {TOOLS.map((t, index) =>
            <div key={t.name} data-index={index} className="grid break-inside-avoid grid-cols-[180px_1fr] gap-ds-lg p-ds-md max-md:grid-cols-1 max-md:gap-ds-xs" data-oid="b7a2fb382c" data-oid-shared="true">
                <dt className="type-heading text-foreground" data-oid="4452bd7ff8" data-oid-shared="true" data-oid-text-editable="false" data-oid-text-source="expression:bede8de6c620|element:kbd">
                  {t.name} <kbd className="ml-ds-xs rounded-sm border border-border bg-background px-ds-xs type-caption text-primary" data-oid="bb0d4b2105" data-oid-shared="true">{t.key}</kbd>
                </dt>
                <dd className="type-body text-muted-foreground" data-oid="f8d10de105" data-oid-shared="true">{t.text}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="mb-ds-3xl" data-oid="de2ea6df23">
          <p className="type-caption text-accent" data-oid="e173b3a55d">03</p>
          <h2 className="mt-ds-xs text-[1.75rem] font-bold tracking-[-0.02em] text-foreground" data-oid="235b294e62">Brushes &amp; brush settings</h2>
          <ul className="mt-ds-lg grid gap-ds-md md:grid-cols-2" data-oid="27bcc5733f">
            {BRUSHES.map((b, index) =>
            <li key={b.name} data-index={index} className="break-inside-avoid rounded-lg border border-border bg-card p-ds-lg" data-oid="ec65f9782f" data-oid-shared="true">
                <p className="type-caption text-primary" data-oid="9e618a1b31" data-oid-shared="true" data-oid-text-editable="false" data-oid-text-source="text|expression:a154b0872206">KEY {b.key}</p>
                <h3 className="mt-ds-xs type-heading text-foreground" data-oid="694da0cfb6" data-oid-shared="true">{b.name}</h3>
                <p className="mt-ds-xs type-body text-muted-foreground" data-oid="559f65255d" data-oid-shared="true">{b.text}</p>
              </li>
            )}
          </ul>
          <ul className="mt-ds-lg list-disc space-y-ds-xs pl-ds-xl type-body text-muted-foreground" data-oid="6795b6c24f">
            <li data-oid="cb239e96c3"><strong className="font-semibold text-foreground" data-oid="801954d966">Size &amp; opacity:</strong> set for each brush separately, with exact number readouts.</li>
            <li data-oid="67e02e3573"><strong className="font-semibold text-foreground" data-oid="3cd564bdb7">Stabiliser:</strong> smooths shaky hands. Mono Liner uses a lighter amount so corners stay sharp.</li>
            <li data-oid="a0f2b0b5a5"><strong className="font-semibold text-foreground" data-oid="ad5396ab18">Simulated pressure:</strong> mouse and finger strokes taper based on drawing speed.</li>
            <li data-oid="d82d267d0b"><strong className="font-semibold text-foreground" data-oid="acff5aa93d">Brush presets:</strong> save a brush, size, opacity and stabiliser combo under your own name and recall it with one tap.</li>
          </ul>
        </section>

        <section className="mb-ds-3xl" data-oid="0f0d911480">
          <p className="type-caption text-accent" data-oid="3cc919de7b">04</p>
          <h2 className="mt-ds-xs text-[1.75rem] font-bold tracking-[-0.02em] text-foreground" data-oid="1ca593e92d">Selecting &amp; arranging</h2>
          <ul className="mt-ds-lg grid gap-ds-md md:grid-cols-3" data-oid="002c5a8a69">
            <li className="break-inside-avoid rounded-lg border border-border bg-card p-ds-lg" data-oid="74083c4085">
              <h3 className="type-heading text-foreground" data-oid="1cd0c82d39">Multi-select</h3>
              <p className="mt-ds-xs type-body text-muted-foreground" data-oid="63da784fd5">Turn on the toolbar toggle and every tap, box or lasso adds to the selection. Tapping a selected object removes it. Works just like holding Shift.</p>
            </li>
            <li className="break-inside-avoid rounded-lg border border-border bg-card p-ds-lg" data-oid="92faa787cd">
              <h3 className="type-heading text-foreground" data-oid="028f50f445">Select a whole layer</h3>
              <p className="mt-ds-xs type-body text-muted-foreground" data-oid="0885d384c6">Tap a layer's thumbnail or Select all. Then Cut or Delete empties the layer and keeps the layer itself.</p>
            </li>
            <li className="break-inside-avoid rounded-lg border border-border bg-card p-ds-lg" data-oid="6c4d273f93">
              <h3 className="type-heading text-foreground" data-oid="2dbca6f45c">Group · Arrange · Align</h3>
              <p className="mt-ds-xs type-body text-muted-foreground" data-oid="4274be084d">Group objects so they move together. Stack them front and back, align or flip them, and set exact X / Y / W / H in the Object panel.</p>
            </li>
            <li className="break-inside-avoid rounded-lg border border-border bg-card p-ds-lg" data-oid="02d59602cc">
              <h3 className="type-heading text-foreground" data-oid="19eb6c4e84">Pathfinder</h3>
              <p className="mt-ds-xs type-body text-muted-foreground" data-oid="6f2608c5c1">Unite, Minus Front, Intersect and Exclude for shapes, paths and ink strokes.</p>
            </li>
            <li className="break-inside-avoid rounded-lg border border-border bg-card p-ds-lg" data-oid="a008c285fb">
              <h3 className="type-heading text-foreground" data-oid="151992a08c">Convert to shape</h3>
              <p className="mt-ds-xs type-body text-muted-foreground" data-oid="0fd24f3493">Turns stroked lines and vector brush strokes into filled outlines that are ready for Pathfinder.</p>
            </li>
            <li className="break-inside-avoid rounded-lg border border-border bg-card p-ds-lg" data-oid="c695ca25da">
              <h3 className="type-heading text-foreground" data-oid="06459e7bd7">Selection bar</h3>
              <p className="mt-ds-xs type-body text-muted-foreground" data-oid="20f13ea7de">A touch bar under the canvas with Deselect, Cut, Group, Ungroup, Join and Delete whenever something is selected.</p>
            </li>
          </ul>
        </section>

        <section className="mb-ds-3xl" data-oid="ee57dc62c1">
          <p className="type-caption text-accent" data-oid="a7a757a0ae">05</p>
          <h2 className="mt-ds-xs text-[1.75rem] font-bold tracking-[-0.02em] text-foreground" data-oid="224b266361">Layers</h2>
          <ul className="mt-ds-lg list-disc space-y-ds-sm pl-ds-xl type-body text-muted-foreground" data-oid="93cec28389">
            <li data-oid="857a35384c"><strong className="font-semibold text-foreground" data-oid="3a8bf806f6">Pencil and vector layers:</strong> each type keeps the right kind of artwork, shown as a PENCIL or VECTOR tag.</li>
            <li data-oid="aa9dbf8a7b"><strong className="font-semibold text-foreground" data-oid="ddff4225ef">Nested layers:</strong> drag a layer onto the middle of another to put it inside, or use Nest / Unnest. Hiding, locking or fading a parent applies to everything inside it, and the folder icon collapses sublayers.</li>
            <li data-oid="2fe9d3283d"><strong className="font-semibold text-foreground" data-oid="30ce2d5ca6">Merge Down:</strong> combines a pencil layer with the pencil layer beneath it, and keeps eraser marks and opacity looking the same.</li>
            <li data-oid="633db8b21b"><strong className="font-semibold text-foreground" data-oid="f8f281ceea">Reorder anything:</strong> drag handles on layers, and on the paths and shapes inside vector layers, move objects within a layer or onto another layer.</li>
            <li data-oid="4bb9ffa41b"><strong className="font-semibold text-foreground" data-oid="38b3e7eb7b">Opacity, blend, lock, hide:</strong> Normal, Multiply and Screen blending for each layer, plus live thumbnails.</li>
            <li data-oid="4500ba030e"><strong className="font-semibold text-foreground" data-oid="0332534bab">Rename, duplicate, clear:</strong> double-tap a layer name to rename it.</li>
          </ul>
        </section>

        <section className="mb-ds-3xl" data-oid="24fafdbd50">
          <p className="type-caption text-accent" data-oid="6b2788ea5f">06</p>
          <h2 className="mt-ds-xs text-[1.75rem] font-bold tracking-[-0.02em] text-foreground" data-oid="e2a61b5de4">Colour, canvas &amp; files</h2>
          <div className="mt-ds-lg grid gap-ds-md md:grid-cols-3" data-oid="4eb793469c">
            <div className="break-inside-avoid rounded-lg border border-border bg-card p-ds-lg" data-oid="01568fd65a">
              <h3 className="type-heading text-foreground" data-oid="532455476c">Colour</h3>
              <ul className="mt-ds-sm space-y-ds-xs type-body text-muted-foreground" data-oid="891f3d7bc6">
                <li data-oid="8080d53860">Colour wheel with hex input</li>
                <li data-oid="f69b3120cd">Stroke / Fill target under the wheel</li>
                <li data-oid="d591f3da1b">Swatch library you can extend</li>
                <li data-oid="194de0d4f3">Eyedropper sampling from the canvas</li>
              </ul>
            </div>
            <div className="break-inside-avoid rounded-lg border border-border bg-card p-ds-lg" data-oid="f8084c0509">
              <h3 className="type-heading text-foreground" data-oid="00a5733404">Canvas &amp; view</h3>
              <ul className="mt-ds-sm space-y-ds-xs type-body text-muted-foreground" data-oid="f0a101f24d">
                <li data-oid="322d9b2d8d">Presets: Square, Tabloid 300 dpi, Story HD, Full HD</li>
                <li data-oid="e66bb58a5b">Grid, snap to grid, smart guides</li>
                <li data-oid="91ec86cde8">Pinch-zoom and rotate the view, tap ROT to reset</li>
                <li data-oid="c361c07957">Live X / Y, pressure and zoom readouts</li>
              </ul>
            </div>
            <div className="break-inside-avoid rounded-lg border border-border bg-card p-ds-lg" data-oid="f4ef6ebebb">
              <h3 className="type-heading text-foreground" data-oid="949649031d">Files &amp; safety</h3>
              <ul className="mt-ds-sm space-y-ds-xs type-body text-muted-foreground" data-oid="5d6dfbfb9e">
                <li data-oid="00948ec06e">.dtm project files that open on every device</li>
                <li data-oid="c15ee3130d">PNG and layered SVG export</li>
                <li data-oid="b632c5f257">Saves straight to the Art Life folder</li>
                <li data-oid="e043b63dac">Autosave while you rest the pen</li>
                <li data-oid="8b5f8aaa9d">New-project window at launch, unique names, tap the title to rename</li>
                <li data-oid="55ea747fae">40 undo steps</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="mb-ds-2xl" data-oid="d2cd3835c3">
          <p className="type-caption text-accent" data-oid="29da0b6834">07</p>
          <h2 className="mt-ds-xs text-[1.75rem] font-bold tracking-[-0.02em] text-foreground" data-oid="c7ac69ffbf">Keyboard shortcuts</h2>
          <p className="mt-ds-xs type-body text-muted-foreground" data-oid="63b8257f1f">Optional. Every one of these also has an on-screen button. On Mac, use Cmd in place of Ctrl.</p>
          <table className="mt-ds-lg w-full border-collapse overflow-hidden rounded-lg border border-border bg-card" data-oid="3943c4537d">
            <tbody data-oid="f117390a13">
              {SHORTCUTS.map((s, index) =>
              <tr key={s.name} data-index={index} className="break-inside-avoid border-b border-border last:border-b-0" data-oid="f01ab4cdfc" data-oid-shared="true">
                  <th scope="row" className="p-ds-sm text-left type-body font-normal text-foreground" data-oid="804d413e81" data-oid-shared="true">{s.name}</th>
                  <td className="p-ds-sm text-right type-caption text-primary" data-oid="8dc3a497b4" data-oid-shared="true">{s.key}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <footer className="border-t border-border pt-ds-lg" data-oid="dbe7bdab3e">
          <p className="type-caption text-muted-foreground" data-oid="4447fb2f1d">ART LIFE CREATIVE STUDIO v1.0.7 · WINDOWS · ANDROID · IPAD · WEB</p>
        </footer>
      </article>
    </div>);
}

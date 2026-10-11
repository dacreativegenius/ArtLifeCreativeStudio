// Mercury interactive-editing bridge.
// OID stamping version: v15
// This file is injected by the backend before build. It runs inside the
// generated app iframe and forwards click/hover events to the parent canvas
// via postMessage.
//
// Message shape (iframe -> parent):
//   { source: 'mercury-bridge', type: 'element-selected', oid, append, props: {...} }
//   { source: 'mercury-bridge', type: 'inline-text-draft', oid, text, editTarget: 'text' | 'placeholder', props: {...}, textSegment?, mutationId?, historyBeforeText? }
//   { source: 'mercury-bridge', type: 'inline-text-commit', oid, text, editTarget: 'text' | 'placeholder', props: {...}, textSegment?, mutationId?, historyBeforeText? /* required for placeholder */ }
//   { source: 'mercury-bridge', type: 'inline-text-cancel', oid, editTarget, mutationIds, props: {...} }
//   { source: 'mercury-bridge', type: 'history-shortcut', action: 'undo' | 'redo', modifier: 'cmd' | 'ctrl', redoKey?: 'shift-z' | 'y', resumeInlineEditing?: true }
//   { source: 'mercury-bridge', type: 'inspect-mode-changed', enabled }
//   { source: 'mercury-bridge', type: 'inspect-selection-key', direction }
//   { source: 'mercury-bridge', type: 'inspect-selection-boundary', direction }
//   { source: 'mercury-bridge', type: 'ready', version: '<bridge fingerprint>', bootedAtHome: true }
//   { source: 'mercury-bridge', type: 'pages-list', paths: ['/', '/about', ...] }
//   { source: 'mercury-bridge', type: 'page-size', path, width, height }
//   { source: 'mercury-bridge', type: 'link-click', toPath: '/about' }
//   { source: 'mercury-bridge', type: 'thumbnail-captured', correlationId, dataUrl?, error? }
//   { source: 'mercury-bridge', type: 'runtime-error', kind, name?, message?, filename?, lineno?, colno?, routePath? }
//
// Accepted commands (parent -> iframe):
//   { source: 'mercury', type: 'set-inspect-mode', enabled, inlineTextEditEnabled? }
//   { source: 'mercury', type: 'move-inspect-selection', direction: 'next-sibling' | 'previous-sibling' | 'parent' | 'first-child' }
//   { source: 'mercury', type: 'select-inspect-edge', edge: 'first' | 'last' }
//   { source: 'mercury', type: 'begin-inline-text-edit', oid, instanceIndex? }
//   { source: 'mercury', type: 'set-route', path: '/about' | null, pin?: boolean, baselineHeight?: number, baselineWidth?: number }
//   { source: 'mercury', type: 'set-page-size-freeze', enabled: boolean }
//   { source: 'mercury', type: 'restore-selected-elements', selections: [{ oid, instanceIndex? }] }
//   { source: 'mercury', type: 'mutate-dom', mutationId, oid, op, value, instanceIndex? }
//     ops: 'setText' | 'setClassName' | 'setStyle' | 'replaceSvgMarkup' | 'setColorOverride' | 'setPropertyOverride'
//   { source: 'mercury', type: 'revert-dom', mutationId }
//   { source: 'mercury', type: 'capture-thumbnail', correlationId: '…' }
//
// 'setColorOverride' is the color-edit channel used by the properties
// panel. Instead of pinning an inline style (which would defeat interaction
// utilities like `hover:bg-emerald-700` and `active:bg-emerald-800` via
// specificity), it upserts a
// rule into a private <style id="mercury-color-overrides"> element.
// Base overrides stay low-specificity so authored hover/selected states
// still win. The bridge can also render explicit state overrides for future
// callers, but the Properties panel currently only exposes base Appearance
// color editing.
//
// mutate-dom normally applies a synchronous live-DOM change to every node
// sharing the given oid (so calculator-style .map() elements all update
// together) and records the prior value under mutationId. When
// 'instanceIndex' is provided, the change lands on the single matching
// DOM node at that index only — mirroring the AST rewrite that emits
// 'idx === N ? new : old' in the source. revert-dom rolls a recorded
// mutation back. This is the optimistic-preview channel used by the
// parent canvas while the source-of-truth AST edit + rebuild runs
// asynchronously.

import { toSvg } from 'html-to-image'

const INLINE_PLACEHOLDER_INPUT_TYPES = new Set<string>(
  ["text","search","url","tel","email","password","number"],
)

const DIRECT_EDIT_ELEMENT_CATEGORY_BY_TAG: Readonly<Record<string, string>> =
  {"a":"Text","abbr":"Text","address":"Text","area":"Div","article":"Div","aside":"Div","audio":"Div","b":"Text","base":"Div","bdi":"Text","bdo":"Text","blockquote":"Text","body":"Div","br":"Div","button":"Div","canvas":"Div","caption":"Text","cite":"Text","code":"Text","col":"Div","colgroup":"Div","data":"Text","datalist":"Div","dd":"Text","del":"Text","details":"Div","dfn":"Text","dialog":"Div","div":"Div","dl":"Div","dt":"Text","em":"Text","embed":"Div","fieldset":"Div","figcaption":"Text","figure":"Div","footer":"Div","form":"Div","h1":"Text","h2":"Text","h3":"Text","h4":"Text","h5":"Text","h6":"Text","head":"Div","header":"Div","hgroup":"Text","hr":"Div","html":"Div","i":"Text","iframe":"Div","img":"Image","input":"Div","ins":"Text","kbd":"Text","label":"Text","legend":"Div","li":"Text","link":"Div","main":"Div","map":"Div","mark":"Text","menu":"Div","meta":"Div","meter":"Div","nav":"Div","noscript":"Div","object":"Div","ol":"Div","optgroup":"Div","option":"Div","output":"Text","p":"Text","picture":"Div","pre":"Text","progress":"Div","q":"Text","rp":"Text","rt":"Text","ruby":"Text","s":"Text","samp":"Text","script":"Div","search":"Div","section":"Div","select":"Text","slot":"Text","small":"Text","source":"Div","span":"Text","strong":"Text","style":"Div","sub":"Text","summary":"Text","sup":"Text","table":"Div","tbody":"Div","td":"Text","template":"Div","textarea":"Text","tfoot":"Div","th":"Text","thead":"Div","time":"Text","title":"Div","tr":"Div","track":"Div","u":"Text","ul":"Div","var":"Text","video":"Video","wbr":"Div","svg":"Svg"}

// Subset of computed style values the properties panel cares about. The
// bridge snapshots them at selection time so the panel can show the
// element's actual rendered appearance — e.g. if bg is 'bg-blue-600' (not
// in the panel's preset swatches) we still display the real blue swatch
// instead of falling back to "Inherit/transparent".
//
// Border style and radius are intentionally single-side proxies — explicit
// borderTopStyle / borderTopLeftRadius field names match the existing
// borderTop* color/width naming and signal to consumers that they're
// looking at one corner / one side, not the shorthand. An element with
// border-radius: 8px 0 0 8px reports borderTopLeftRadius: "8px" so the
// panel's Radius dropdown can't lie and claim "8px" applies to all corners.
type BridgeComputedStyle = {
  color: string
  backgroundColor: string
  // Raw `background-image`. Present so the panel can tell an element that is
  // actually painted by a gradient or image apart from an unpainted one:
  // `background-color` alone reports `rgba(0, 0, 0, 0)` for both. Bounded, and
  // empty rather than truncated past the bound — see extractComputedStyle.
  backgroundImage: string
  // `background-clip`. `text` means the background paints the glyphs rather
  // than the box, which the panel must not offer as a surface fill: clearing it
  // on a `text-transparent` heading would leave the text invisible.
  backgroundClip: string
  // Base utility values resolved on a non-interactive probe. Unlike the live
  // computed values, these are not affected by :hover/:active/selected state.
  baseBackgroundColor: string
  baseColor: string
  baseBorderTopColor: string
  borderTopColor: string
  borderTopWidth: string
  borderTopStyle: string
  borderTopLeftRadius: string
  borderTopRightRadius: string
  borderBottomRightRadius: string
  borderBottomLeftRadius: string
  width: string
  height: string
  fontSize: string
  fontFamily: string
  fontWeight: string
  fontStyle: string
  textAlign: string
  direction: string
  boxShadow: string
  opacity: string
  mixBlendMode: string
  overflow: string
  fill: string
  objectFit: string
  scale: string
  paddingTop: string
  paddingRight: string
  paddingBottom: string
  paddingLeft: string
  marginTop: string
  marginRight: string
  marginBottom: string
  marginLeft: string
  customProperties: BridgeAttributes
}

type BridgeAttributes = Record<string, string>

type BridgeRect = {
  x: number
  y: number
  width: number
  height: number
}

type BridgeDomContext = {
  parentTagName: string | null
  parentClassName: string | null
  parentOid: string | null
  parentInstanceIndex: number | null
  childElementCount: number
  siblingIndex: number | null
  siblingCount: number | null
}

// data-oid identifies the JSX source node, not a rendered occurrence. A
// loop/reused component can therefore produce several DOM nodes with one oid.
// This locator is runtime-only identity and must never be written back into
// generated JSX or used as a source edit key.
type BridgeInstanceLocator = {
  path: number[]
  fingerprint: string
}

type BridgeDirectTextSegment = {
  index: number
  domIndex: number
  text: string
}

type BridgeAncestorContext = {
  oid: string
  tagName: string
  directText?: string
  textContent?: string
}

type InlineTextSegmentTarget = BridgeDirectTextSegment & {
  structureFingerprint: string
  sourceIndex?: number
  sourceKind?: 'text' | 'expression'
}

type BridgeProps = {
  // Editor-only, data-only registration. Never execute metadata from the app.
  dynamicControls: string | null
  routePath: string
  viewport: { width: number; height: number }
  tagName: string
  className: string | null
  attributes: BridgeAttributes
  rect: BridgeRect | null
  domContext: BridgeDomContext
  instanceLocator: BridgeInstanceLocator
  oidAttributes: BridgeAttributes
  // Aggregate text (recursive). Includes text from descendants — useful for
  // display/preview but NOT safe to use for the Text editor on container
  // elements because editing it would clobber descendants.
  textContent: string | null
  // Nearest useful OID ancestors with bounded semantic text. This is
  // correlation evidence for shared instances, never a durable source key.
  ancestorContext: BridgeAncestorContext[]
  // True when the element has at least one direct child that is NOT a Text
  // node (i.e. a child element). Used by the panel as a discriminator:
  //   - no non-text children => element's textContent IS its direct text,
  //     always safe to edit (plain leaves like <h2>Title</h2>).
  //   - has non-text children AND directText is null => pure container,
  //     hide the Text editor (e.g. <div><Foo/></div>).
  //   - has non-text children AND directText exists => mixed content,
  //     show the editor; server + bridge both do a surgical edit of the
  //     direct-text slice(s) and preserve the element children.
  hasNonTextChildren: boolean
  // Direct text content only (sum of immediate Text-node children).
  // null for pure containers like <div><Foo/></div>. For mixed content
  // like <h1>Build faster.<span>Ship smarter.</span></h1> this is
  // "Build faster." — exactly the slice the panel's textarea rewrites
  // and the astEdit.ts + bridge text operations surgically rewrite on commit.
  // Also null when the direct text exceeded MAX_DIRECT_TEXT_CHARS — see
  // directTextTruncated below for how the panel renders that case.
  directText: string | null
  // Meaningful direct browser Text nodes in DOM order. These remain separate
  // when an element child sits between them, allowing the parent panel to
  // edit `Hello` and `yo` independently in `Hello <span>world</span>yo`.
  directTextSegments: BridgeDirectTextSegment[]
  // Direct-child shape used as a stale-edit guard by the source AST editor.
  directTextStructure: string | null
  // Authored direct-child text shape. Dynamic expressions carry opaque source
  // fingerprints so inline editing can target exactly the expression beneath
  // the pointer without exposing source code to the browser.
  textSourceStructure: string | null
  // True when the element has direct text but it's too long for the panel
  // to safely round-trip. We deliberately do NOT ship a sliced prefix:
  // binding the textarea to a partial string would let a Save persist the
  // truncation, silently destroying the back half of the user's content
  // in both the optimistic DOM and the source JSX. Panel renders a
  // read-only banner ("text too long, edit source directly") instead.
  directTextTruncated: boolean
  styleText: string | null
  // Rendered style values at selection time (getComputedStyle). Gives the
  // panel ground truth when className is arbitrary or uses tokens outside
  // the panel's preset lists.
  computedStyle: BridgeComputedStyle | null
  // True when the clicked element is currently in a semantic selected-like
  // state. The properties panel uses this to avoid showing selected tab /
  // pressed button colors as the editable base Fill/Text colors.
  semanticStateActive: boolean
  // Tailwind variant that can target this selected state safely, when one is
  // available (e.g. "aria-selected", "data-[state=active]").
  semanticStateVariant: string | null
  // True when the source JSX element was emitted inside a .map()/.forEach()
  // callback. Such elements share their oid across every runtime instance,
  // so a source AST edit will modify every instance.
  isShared: boolean
  // True ONLY when the stamper marked this exact JSX literal as living
  // inside a .map()/.forEach() callback (the literal data-oid-shared
  // attribute) — unlike isShared, this does NOT fall back to live
  // instanceCount > 1. A reused local/shared component (e.g. a NavButton
  // called from four different arrays) has isShared === true (many live
  // instances) but isLoopShared === false (its own JSX isn't lexically
  // inside a loop) — deleting it edits the shared definition once, safely,
  // rather than needing per-array-item surgery. Delete-affordance gating
  // uses this narrower flag so reused components stay deletable.
  isLoopShared: boolean
  // True when the edit pipeline can provably rewrite exactly ONE rendered
  // instance of this element (stamped as data-oid-instance-targetable by
  // stampOidsInSource, using the edit path's own predicates). Depends on AST
  // facts the client cannot observe — local vs exported enclosing component,
  // destructured vs positional props, stable vs computed collections — so it
  // must be published from the server rather than inferred in the panel.
  instanceTargetable: boolean
  // True when this element is its component's entire output, so deleting it
  // would blank every call site — including routes not currently rendered.
  isComponentRoot: boolean
  // True when this element is a component root whose call sites the server can
  // each address individually. Delete then rewrites the CALLER that rendered
  // this instance, leaving the component and every other usage untouched — so
  // the component-root refusal does not apply. False/absent → today's behaviour.
  callSiteDeletable: boolean
  // Same, for property edits: the component can accept a threaded instance
  // index, so colour / font / size / text can target this instance alone.
  callSiteEditable: boolean
  // Delete additionally needs exactly one live instance for this element.
  callSiteRequiresSingleInstance: boolean
  // Live count of DOM nodes currently sharing this oid. Useful even when
  // isShared is false (e.g. an element rendered in two unrelated places).
  instanceCount: number
  // Zero-based index of the clicked instance within the list of DOM nodes
  // sharing this oid. The properties panel threads this back into every
  // edit when the user picks "Edit just this one" so the server-side AST
  // rewrites only that rendered instance. Always 0 for elements with a
  // single instance.
  instanceIndex: number
  // False when the JSX source contains a runtime expression like
  // <p>Hi {name}</p>. The properties panel hides its text input for
  // these elements because a literal text rewrite would erase the binding
  // on the client (el.textContent=... wipes nested nodes) and the
  // backend AST guard refuses the edit anyway. Defaults to true.
  textEditable: boolean
  // Comma-separated list of inline style property names whose JSX values
  // are dynamic expressions (ternary, identifier, call). The panel must
  // hide edit controls for these properties because overwriting them would
  // destroy runtime logic. Empty string or absent means all props are safe.
  dynamicStyleKeys: string[]
  // True when the className attribute is a non-literal expression (cn(),
  // clsx(), ternary, template literal). The panel hides Tailwind-token
  // controls because replacing the expression with a static string would
  // destroy runtime conditional classes.
  classNameDynamic: boolean
  // SVG colour facts are computed from rendered paint values. The panel
  // exposes direct recolouring only for a single-colour root SVG; multi-colour
  // artwork stays protected and falls back to chat editing.
  isSingleColorSvg: boolean
  isMultiColorSvg: boolean
  supportsInlineSvgReplacement: boolean
  // Bounded rendered markup for the Properties-panel preview. The host
  // sanitizes this again and renders it through an <img> data URL, never as
  // live DOM.
  svgPreviewMarkup: string | null
  availableFonts: string[]
  availableFontWeights: string[]
  availableFontWeightsByFamily: Record<string, string[]>
  resolvedBackgroundColor: string | null
  // Component-level oid (data-oid-component), present only under PascalCase
  // call-site stamping. The 'oid' field targets this rendered instance; this
  // targets every instance rendered from the same component. Null when the
  // stamper did not emit one — the panel must then hide group edit rather
  // than silently widening a single edit.
  componentOid: string | null
  // Capability tokens proven for this call site ('class' | 'style' | 'text'),
  // read from data-oid-caps. Null for an ordinary DOM element, in which case
  // the panel keeps its existing behaviour. When non-null the list is
  // exhaustive: a control whose token is absent was not proven and must be
  // hidden rather than shown-and-failing.
  editableCapabilities: string[] | null
  // Runtime render ancestry from React's fiber tree, e.g.
  // "App:0/Toolbar:1/Button:0". Identifies instances that share both a source
  // location and a call site — three <Toolbar/> usages each containing one
  // <Button/> — which no source-level identifier can separate.
  //
  // Advisory: nothing consumes it yet. Null on non-React pages or React builds
  // that do not expose fiber internals, so it can never be a precondition.
  instancePath: string | null
  /** Ordinal among the nodes this element's own call site rendered. */
  siteLocalIndex: number | null
  siteLocalCount: number | null
}

type BridgeLayerNode = {
  tagName: string
  oid: string | null
  instanceIndex: number | null
  label: string | null
  children: BridgeLayerNode[]
}

type BridgeElementSelectedMessage =
  | { source: 'mercury-bridge'; type: 'element-selected'; oid: string; append: boolean; props: BridgeProps; routePath: string; instanceLocator: BridgeInstanceLocator; point?: { xRatio: number; yRatio: number }; inputType?: 'keyboard'; direction?: InspectHierarchyDirection }
  | { source: 'mercury-bridge'; type: 'element-selected'; oid: string; append: boolean; props: BridgeProps; point?: { xRatio: number; yRatio: number }; inputType?: 'keyboard'; direction?: InspectHierarchyDirection }

const BRIDGE_VERSION = '0b905d5165e1'

type OutboundMessage =
  | BridgeElementSelectedMessage
  | { source: 'mercury-bridge'; type: 'selection-cleared' }
  | { source: 'mercury-bridge'; type: 'inline-text-draft' | 'inline-text-commit'; oid: string; text: string; editTarget: 'text' | 'placeholder'; props: BridgeProps; textSegment?: InlineTextSegmentTarget; mutationId?: string; historyBeforeText?: string }
  | { source: 'mercury-bridge'; type: 'inline-text-cancel'; oid: string; editTarget: 'text' | 'placeholder'; mutationIds: string[]; props: BridgeProps }
  | { source: 'mercury-bridge'; type: 'history-shortcut'; action: 'undo' | 'redo'; modifier: 'cmd' | 'ctrl'; redoKey?: 'shift-z' | 'y'; resumeInlineEditing?: true }
  | { source: 'mercury-bridge'; type: 'canvas-pan-key'; phase: 'down' | 'up' }
  | { source: 'mercury-bridge'; type: 'dynamic-features'; features: Array<{ oid: string; registration: string }>; truncated?: boolean }
  | { source: 'mercury-bridge'; type: 'element-props-updated'; oid: string; props: BridgeProps }
  | { source: 'mercury-bridge'; type: 'layers-tree'; nodes: BridgeLayerNode[]; totalCount: number; stampedCount: number; truncated: boolean }
  | { source: 'mercury-bridge'; type: 'inspect-mode-changed'; enabled: boolean; cursorMode: 'inspect' | 'comment' }
  | { source: 'mercury-bridge'; type: 'comment-anchors'; anchors: Array<{ oid: string; instanceLocator: BridgeInstanceLocator; rect: BridgeRect | null; visible: boolean; viewport: { width: number; height: number } | null }> }
  | { source: 'mercury-bridge'; type: 'delete-selection-key'; oid: string }
  | { source: 'mercury-bridge'; type: 'element-move-commit'; oid: string; parentOid: string; beforeOid: string | null; fromIndex?: number; beforeIndex?: number | null; siblingCount?: number; props: BridgeProps }
  | { source: 'mercury-bridge'; type: 'element-resize-commit'; oid: string; width?: number; height?: number; flexBasis?: number; flexBasisDimension?: 'width' | 'height'; horizontalOffsetProperty: InspectResizeOffsetProperty | null; horizontalOffset?: number; verticalOffsetProperty: InspectResizeOffsetProperty | null; verticalOffset?: number; instanceIndex: number; beforeStyle: { flexBasis?: string; height?: string; width?: string }; props: BridgeProps; parentEdit?: { oid: string; style: Record<string, string>; beforeStyle: Record<string, string>; instanceIndex?: number } }
  | { source: 'mercury-bridge'; type: 'inspect-selection-key'; direction: InspectHierarchyDirection }
  | { source: 'mercury-bridge'; type: 'inspect-selection-boundary'; direction: 'next-sibling' | 'previous-sibling' }
  | { source: 'mercury-bridge'; type: 'ready'; version: typeof BRIDGE_VERSION; bootedAtHome: boolean; capabilities: { elementResizeHandles: boolean; elementMoveReorder: boolean; resizeFeatureGate: boolean; directManipulationGestures: boolean; componentCallSiteMetadata: boolean } }
  | { source: 'mercury-bridge'; type: 'pages-list'; paths: string[] }
  | { source: 'mercury-bridge'; type: 'page-size'; path: string; width: number; height: number }
  | { source: 'mercury-bridge'; type: 'link-click'; toPath: string }
  | { source: 'mercury-bridge'; type: 'comment-target-scroll' }
  | { source: 'mercury-bridge'; type: 'edit-targets-observed'; correlationId: string; observations: Array<{ key: string; found: boolean; value: string | null; viewport: { width: number; height: number }; routePath: string }> }
  | { source: 'mercury-bridge'; type: 'hmr-settled'; documentId: string; revision: number; routePath: string; editVerificationId?: string }
  | { source: 'mercury-bridge'; type: 'edit-hmr-unconfirmed'; editVerificationId: string; routePath: string }
  | { source: 'mercury-bridge'; type: 'runtime-error'; kind: 'error' | 'unhandledrejection'; name?: string; message?: string; filename?: string; lineno?: number; colno?: number; routePath?: string }

let inspectEnabled = false
let demoKeepAnimationsRunning = false
let cursorMode: 'inspect' | 'comment' = 'inspect'
// Target capture and animation-freeze ownership are separate concerns. Comment
// mode arms the bridge in EVERY ready frame so any track is clickable as a
// comment target, but freezing every one of those documents costs an rAF
// suspension, a getAnimations() sweep and a subtree MutationObserver each. The
// parent therefore grants the freeze to the focused track only, and a document
// additionally claims it while the pointer is inside itself — pointerdown covers
// touch, where there is no hover to precede the click. Inspect is unaffected: it
// arms exactly one frame, so it always owns its own freeze.
let animationFreezeGranted = false
let commentPointerEngaged = false
let inspectMoveEnabled = false
let inspectResizeEnabled = false
let inlineTextEditEnabled = false
let inspectSpacePanActive = false
// The generated app and Mercury bridge share one window. Keep a private handle
// to the browser scheduler so inspect mode can suspend app-owned rAF loops
// without also freezing overlays, direct manipulation, HMR, or capture work.
const MERCURY_NATIVE_FRAME_SCHEDULER_KEY = '__mercuryNativeFrameScheduler_v1__'
type MercuryNativeFrameScheduler = {
  request: typeof window.requestAnimationFrame
  cancel: typeof window.cancelAnimationFrame
}
const frameSchedulerWindow = window as unknown as Record<string, unknown>
const existingNativeFrameScheduler = frameSchedulerWindow[MERCURY_NATIVE_FRAME_SCHEDULER_KEY] as
  | MercuryNativeFrameScheduler
  | undefined
const nativeBridgeRequestAnimationFrame =
  existingNativeFrameScheduler?.request ?? window.requestAnimationFrame
const nativeBridgeCancelAnimationFrame =
  existingNativeFrameScheduler?.cancel ?? window.cancelAnimationFrame
if (!existingNativeFrameScheduler) {
  frameSchedulerWindow[MERCURY_NATIVE_FRAME_SCHEDULER_KEY] = {
    request: nativeBridgeRequestAnimationFrame,
    cancel: nativeBridgeCancelAnimationFrame,
  } satisfies MercuryNativeFrameScheduler
}
const bridgeRequestAnimationFrame = (callback: FrameRequestCallback): number =>
  nativeBridgeRequestAnimationFrame.call(window, callback)
const bridgeCancelAnimationFrame = (id: number): void =>
  nativeBridgeCancelAnimationFrame.call(window, id)
let hmrRevision = 0
const hmrDocumentId = Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
// Prevents publishLayersTree() firing twice when both the generic vite:afterUpdate
// path and the marker-correlated path call postHmrSettled() for the same rebuild.
// Reset to false at the top of every vite:afterUpdate handler.
let hmrLayersPublished = false
const EDIT_HMR_APPLY_TIMEOUT_MS = 4_000
// Match the server transaction so an early marker survives until finish.
const EDIT_HMR_MARKER_MAX_AGE_MS = 600000
const EDIT_HMR_FULL_RELOAD_STORAGE_KEY = '__mercury_edit_hmr_full_reload_v1__'
const EDIT_HMR_FULL_RELOAD_MAX_AGE_MS = 15_000
const EDIT_HMR_VERIFICATION_ID_RE = /^[a-zA-Z0-9_:-]{16,128}$/
const EDIT_HMR_MARKER_ID_RE = /^mercury-hmr-[a-z0-9]+-[a-z0-9]+$/
const editHmrMarkerReceipts = new Map<string, {
  appliedFiles: Set<string>
  failedFiles: Set<string>
  expiryTimer: ReturnType<typeof setTimeout>
}>()
const editHmrMarkerBatches = new Map<string, {
  markers: Array<{ verificationId: string; files: string[] }>
  expiryTimer: ReturnType<typeof setTimeout>
}>()
const pendingEditHmrSignals = new Map<string, {
  expectedFiles: Set<string>
  fullReload: boolean
  timer: ReturnType<typeof setTimeout>
}>()
let pinnedRoutePath: string | null = null
let hoverOutlineEl: HTMLElement | null = null
let hoverLabelEl: HTMLElement | null = null
let lastHoverTarget: HTMLElement | null = null
// Persistent selection outline — unlike the hover outline it stays anchored
// on selected elements so the user never "loses" the selection when they
// move the mouse to hover something else.
type SelectedOverlayEntry = {
  target: HTMLElement
  outlineEl: HTMLElement
  labelEl: HTMLElement
  resizeHandles: HTMLElement[]
}

type InspectResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type InspectResizeOffsetProperty = 'left' | 'top' | 'marginLeft' | 'marginTop'

type ActiveInspectResize = {
  target: HTMLElement
  captureEl: HTMLElement
  oid: string
  instanceIndex: number
  handle: InspectResizeHandle
  pointerId: number
  startClientX: number
  startClientY: number
  startWidth: number
  startHeight: number
  latestClientX: number
  latestClientY: number
  latestShiftKey: boolean
  horizontalOffsetProperty: InspectResizeOffsetProperty | null
  verticalOffsetProperty: InspectResizeOffsetProperty | null
  startHorizontalOffset: number
  startVerticalOffset: number
  beforeStyle: Record<string, string>
  originalStyleAttr: string | null
  parent: HTMLElement | null
  parentOid: string | null
  parentInstanceIndex: number
  parentIsShared: boolean
  parentBeforeStyle: Record<string, string>
  originalParentStyleAttr: string | null
  parentDisplay: string
  parentFlexDirection: string
  columnGap: number
  rowGap: number
  gridColumns: number[]
  gridRows: number[]
  gridColumnIndex: number
  gridRowIndex: number
  rafId: number | null
}

/**
 * An in-frame gesture that has painted its result and is waiting for the
 * parent's mutate-dom to make it real.
 *
 * Two gestures need this -- a resize drag and an inline text commit -- for the
 * same reason: mutate-dom only arrives on a later task, so restoring the
 * authored value at gesture end paints a visible b -> a -> b flash between the
 * two cross-frame messages. Both therefore keep their result on screen and
 * carry the true before-value here, out of band, so the optimistic mutation can
 * still roll back exactly on undo or save failure without reading a DOM that
 * now holds the new value.
 *
 * Both also need the rollback below, because the parent can decline to enqueue
 * the mutation and answers nothing when it does.
 */
type OptimisticHandoff = {
  rollbackTimer: ReturnType<typeof setTimeout>
}

type InspectStyleHandoff = OptimisticHandoff & {
  prevStyleAttr: string | null
}

/**
 * Which edit this handoff belongs to, so only that edit's echo can claim it.
 *
 * Presence alone is not enough to license the already-applied bypass below. An
 * older setTextSegment for the same node whose value happens to equal the
 * pending committed text would otherwise pass it, consume the handoff and
 * snapshot the authored markup for itself -- and the real echo, arriving next
 * with no handoff left, would fail the guard, record nothing, and leave its
 * revert unable to reach the authored text.
 *
 * `segment` is null for a whole-text commit. `expectedText` is the authored
 * segment text, which is the same value the parent echoes back: it posts the
 * bridge's own `textSegment` on the commit, and the parent reads expectedText
 * straight off that payload.
 */
type InlineTextCommitIdentity = {
  committedText: string
  segment: { index: number; domIndex: number; expectedText: string } | null
}

type InlineTextHandoff = OptimisticHandoff & InlineTextCommitIdentity & {
  authoredTextValues: Map<Text, string>
}

// Bound how long an optimistic gesture result may wait for its mutate-dom echo.
// One second covers the normal cross-frame handoff while still rolling back a
// genuinely lost or declined mutation instead of leaving unsaved state painted
// forever.
const OPTIMISTIC_HANDOFF_TIMEOUT_MS = 1000

type ActiveInspectMove = {
  target: HTMLElement
  parent: HTMLElement
  sourceSiblings: HTMLElement[]
  parentOid: string
  oid: string
  isShared: boolean
  fromIndex: number
  originalBeforeIndex: number | null
  beforeIndex: number | null
  pointerId: number
  startClientX: number
  startClientY: number
  latestClientX: number
  latestClientY: number
  startRect: DOMRect
  parentRect: DOMRect
  originalStyleAttr: string | null
  originalNextSibling: ChildNode | null
  originalBeforeOid: string | null
  placeholder: HTMLElement
  activated: boolean
  // The element actually under the pointer, which is the moved element itself
  // unless the press landed on a stamped descendant of it. See startInspectMove.
  pressedTarget: HTMLElement
  beforeOid: string | null
  rafId: number | null
}

type ActiveInlineTextEditBase = {
  target: HTMLElement
  oid: string
  baseProps: BridgeProps
  originalText: string
  editTarget: 'text' | 'placeholder'
}

type ActiveInlineTextEdit = ActiveInlineTextEditBase & ({
  editTarget: 'text'
  editingHost: HTMLElement
  textSegment: InlineTextSegmentTarget | null
  originalContentEditable: string | null
  originalChildNodes: ChildNode[]
  originalTextValues: Map<Text, string>
  historyMutationIds: string[]
  activeHistoryMutationId: string | null
  activeHistoryBeforeText: string | null
  lastHistoryInputAt: number | null
  lastPublishedHtml: string
  lastPublishedText: string
  protectedChildren: Array<{
    element: HTMLElement
    contentEditable: string | null
    protectedMarker: string | null
  }>
} | {
  editTarget: 'placeholder'
  target: HTMLInputElement | HTMLTextAreaElement
  editingHost: HTMLInputElement | HTMLTextAreaElement
  stopPositioning: () => void
})

type ActiveInlineTextContentEdit = Extract<ActiveInlineTextEdit, { editTarget: 'text' }>

let selectedOverlayEntries: SelectedOverlayEntry[] = []
let interactionPreview = false
let dynamicControlsEnabled = false
let registeredAnimationsLive = false
let selectedTarget: HTMLElement | null = null
let suppressNextClickTarget: HTMLElement | null = null
let selectedResizeObs: ResizeObserver | null = null
let selectedMutationObs: MutationObserver | null = null
let selectedPropsRefreshTimer: number | null = null
let activeInspectResize: ActiveInspectResize | null = null
const inspectStyleHandoffs = new WeakMap<HTMLElement, InspectStyleHandoff>()
let activeInspectMove: ActiveInspectMove | null = null
let activeInlineTextEdit: ActiveInlineTextEdit | null = null
let inlineTextHistorySequence = 0
let repositionRafPending = false
let commentTargetScrollRafPending = false
let inspectCursorStyleEl: HTMLStyleElement | null = null
let pageMeasureViewportStyleEl: HTMLStyleElement | null = null
let pageMeasureViewportDynamicStyleEl: HTMLStyleElement | null = null
const nativePushState = history.pushState.bind(history)
const nativeReplaceState = history.replaceState.bind(history)
let mercuryRouteChangeDepth = 0

// Publish base path stripped from every outbound path so Mercury sees
// app-relative routes regardless of where the build was hosted. Vite
// substitutes import.meta.env.BASE_URL at build time from the base flag:
// / for sandbox dev, /preview/<siteId>/ for the published S3
// artifact.
const APP_BASE_PATH: string = (() => {
  const raw = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  const trimmed = raw.replace(/\/+$/g, '')
  return trimmed === '' ? '' : trimmed
})()

function appRelativePath(p: string | null | undefined): string {
  let raw = p == null || p === '' ? '/' : p
  if (APP_BASE_PATH) {
    if (raw === APP_BASE_PATH) {
      raw = '/'
    } else if (raw.startsWith(APP_BASE_PATH + '/')) {
      raw = raw.slice(APP_BASE_PATH.length) || '/'
    }
  }
  if (raw.length > 1) raw = raw.replace(/\/+$/g, '') || '/'
  return raw
}

function appAbsolutePath(p: string): string {
  if (!APP_BASE_PATH) return p
  if (p === '/' || p === '') return APP_BASE_PATH + '/'
  return p.startsWith(APP_BASE_PATH + '/') || p === APP_BASE_PATH
    ? p
    : APP_BASE_PATH + p
}

function routeUpdateNeedsRenderWindow(
  shouldPinRoute: boolean,
  routeWillChange: boolean,
  expandedRouteActive: boolean,
): boolean {
  // Entering or leaving Expanded changes the effective viewport even when the
  // pathname stays put. A repeated parent measurement with the same route and
  // mode is a no-op and must not restart either animation window.
  return routeWillChange || shouldPinRoute !== expandedRouteActive
}

function pathFromHistoryUrl(url: string | URL | null | undefined): string | null {
  if (url == null) return appRelativePath(location.pathname)
  try {
    const next = new URL(String(url), location.href)
    if (next.origin !== location.origin) return null
    return appRelativePath(next.pathname)
  } catch {
    return null
  }
}

function isPinnedCrossRoute(path: string | null): path is string {
  return mercuryRouteChangeDepth === 0 && Boolean(pinnedRoutePath && path && path !== pinnedRoutePath)
}

function postLinkClick(toPath: string): void {
  post({ source: 'mercury-bridge', type: 'link-click', toPath })
}

function normalizePagePath(path: string): string {
  const relativePath = appRelativePath(path || '/').replace(/\/{2,}/g, '/')
  if (relativePath.length <= 1) return '/'
  return relativePath.replace(/\/+$/g, '')
}

function isInspectPointRouteRendered(expectedRoutePath: unknown): boolean {
  // A collapsed frame pins no route, so it has nothing to prove.
  if (typeof expectedRoutePath !== 'string' || !expectedRoutePath) return true
  return location.pathname === appAbsolutePath(normalizePagePath(expectedRoutePath))
}

const originalAppRoutePath = normalizePagePath(location.pathname)

const PAGE_MEASURE_MIN_HEIGHT = 900
const PAGE_MEASURE_BOTTOM_PADDING = 48
const PAGE_MEASURE_MAX_HEIGHT = 12000
const PAGE_MEASURE_VIEWPORT_FEEDBACK_EPSILON = 96
const PAGE_MEASURE_STABLE_CHANGE_EPSILON = 8
const PAGE_MEASURE_STABLE_CHANGE_COUNT = 3
const PAGE_MEASURE_MAX_SETTLE_ATTEMPTS = 25
const PAGE_MEASURE_VIEWPORT_RULE_SYNC_INTERVAL_MS = 250
const PAGE_SIZE_HMR_SETTLE_MS = 1500
const PAGE_SIZE_HMR_MAX_FREEZE_MS = 5000
const PAGE_MEASURE_TAGS = new Set([
  'A',
  'AUDIO',
  'BUTTON',
  'CANVAS',
  'DETAILS',
  'EMBED',
  'FIELDSET',
  'FIGURE',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'IFRAME',
  'IMG',
  'INPUT',
  'LABEL',
  'LEGEND',
  'LI',
  'METER',
  'OBJECT',
  'OL',
  'OPTION',
  'OUTPUT',
  'PICTURE',
  'PROGRESS',
  'SELECT',
  'SUMMARY',
  'SVG',
  'TABLE',
  'TBODY',
  'TD',
  'TEXTAREA',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'UL',
  'VIDEO',
])
const originalViewportHeight = Math.max(
  1,
  window.innerHeight || 0,
  window.visualViewport?.height || 0,
  document.documentElement?.clientHeight || 0,
  PAGE_MEASURE_MIN_HEIGHT,
)
const originalViewportWidth = Math.max(
  1,
  window.innerWidth || 0,
  window.visualViewport?.width || 0,
  document.documentElement?.clientWidth || 0,
)
let pageMeasureViewportBaselineWidth = originalViewportWidth
let pageMeasureViewportBaselineHeight = originalViewportHeight
// Non-zero synchronously across Mercury's own documentElement style writes,
// and through the MutationObserver microtask those writes queue -- the
// observer callback is itself a microtask queued at the moment of the write,
// so a queueMicrotask-scheduled decrement (queued after it) still runs after
// the callback sees the scope, while a synchronous decrement would end it too
// early. A depth rather than a boolean so nested calls cannot end an outer
// scope; the decrement is queued from finally so a throwing operation cannot
// leave the scope open. Lets the settle-style watch (see
// beginViewportSettleStyleWatch) recognize a resize/zoom-driven baseline
// update as Mercury's own, not app entrance motion.
let mercuryOwnStyleWriteDepth = 0
function withMercuryOwnStyleWrite(operation: () => void): void {
  mercuryOwnStyleWriteDepth += 1
  try {
    operation()
  } finally {
    queueMicrotask(() => {
      mercuryOwnStyleWriteDepth -= 1
    })
  }
}
// Every Mercury write to the baseline variables goes through these, so a new
// variable cannot be added outside the own-write scope.
function applyViewportBaselineVars(): void {
  withMercuryOwnStyleWrite(() => {
    const style = document.documentElement.style
    style.setProperty('--mercury-virtual-viewport-width', pageMeasureViewportBaselineWidth + 'px')
    style.setProperty('--mercury-virtual-viewport-height', pageMeasureViewportBaselineHeight + 'px')
    style.setProperty('--mercury-vh', (pageMeasureViewportBaselineHeight / 100) + 'px')
    style.setProperty('--mercury-vw', (pageMeasureViewportBaselineWidth / 100) + 'px')
  })
}
function clearViewportBaselineVars(): void {
  withMercuryOwnStyleWrite(() => {
    const style = document.documentElement.style
    style.removeProperty('--mercury-virtual-viewport-width')
    style.removeProperty('--mercury-virtual-viewport-height')
    style.removeProperty('--mercury-vh')
    style.removeProperty('--mercury-vw')
  })
}
// Kept for the lifetime of this iframe so collapsing and re-expanding a
// warm preview can reuse the last non-feedback height for each route.
const stablePageHeights = new Map<string, number>()
type PageMeasureSettleState = {
  minHeight: number
  maxHeight: number
  count: number
  attempts: number
  exhausted: boolean
}
const pageMeasureSettleStates = new Map<string, PageMeasureSettleState>()
// Start locked so a freshly loaded document cannot publish a transient size
// between its ready ping and the parent's first explicit sizing command.
// Parent/source-mutation and Vite-HMR locks are independent: completing a job
// must not release sizing while its final HMR render is still settling.
let pageSizeHostFrozen = true
let pageSizeHmrFrozen = false
let pageSizeHmrSettleTimer: number | null = null
let pageSizeHmrWatchdogTimer: number | null = null
let pageMeasureViewportRuleLastSyncAt = 0
let pageMeasureViewportRuleSyncTimer: number | null = null
const expandedScrollingShells = new Map<HTMLElement, HTMLElement>()
const expandedScrollOffsets = new Map<HTMLElement, { top: number; left: number }>()
let expandedScrollRestoreTimer: number | null = null

const PAGE_MEASURE_VIEWPORT_STATIC_RULES = [
  /*
   * Expanded tiles are taller than the app's original viewport so Mercury can
   * show the whole page at once. Without this virtual viewport contract,
   * generated apps that use vh / h-screen / h-full treat the tall tile as the
   * real browser viewport and inflate hero sections or background images.
   */
  'html[data-mercury-expanded-route="true"] {',
  '  width: var(--mercury-virtual-viewport-width) !important;',
  '  min-width: var(--mercury-virtual-viewport-width) !important;',
  '  height: var(--mercury-virtual-viewport-height) !important;',
  '  min-height: var(--mercury-virtual-viewport-height) !important;',
  '  overflow: visible !important;',
  '  scrollbar-width: none !important;',
  '}',
  'html[data-mercury-expanded-route="true"]::-webkit-scrollbar,',
  'html[data-mercury-expanded-route="true"] body::-webkit-scrollbar {',
  '  display: none !important;',
  '  width: 0 !important;',
  '  height: 0 !important;',
  '}',
  'html[data-mercury-expanded-route="true"] body {',
  '  width: var(--mercury-virtual-viewport-width) !important;',
  '  min-width: var(--mercury-virtual-viewport-width) !important;',
  '  min-height: var(--mercury-virtual-viewport-height) !important;',
  '  overflow: visible !important;',
  '  scrollbar-width: none !important;',
  '}',
  'html[data-mercury-expanded-route="true"] body.h-full,',
  'html[data-mercury-expanded-route="true"] body[class*=" h-full"] {',
  '  height: var(--mercury-virtual-viewport-height) !important;',
  '}',
  'html[data-mercury-expanded-route="true"] #root,',
  'html[data-mercury-expanded-route="true"] #__next,',
  'html[data-mercury-expanded-route="true"] [data-reactroot] {',
  '  width: var(--mercury-virtual-viewport-width) !important;',
  '  min-width: var(--mercury-virtual-viewport-width) !important;',
  '  min-height: var(--mercury-virtual-viewport-height) !important;',
  '  overflow: visible !important;',
  '}',
  /*
   * Class-based fallbacks force the full virtual size, which is only right for
   * CSS that still uses native viewport units. CSS rewritten by the
   * mercury-viewport-units plugin already resolves against the virtual
   * viewport, including min()/max()/clamp()/calc() caps and responsive
   * overrides, so these apply only while syncViewportClassFallbackGate() finds
   * native viewport CSS in the document; unreadable CSS alone enables only
   * the named ones. :where() keeps the gate out of their specificity, so the
   * scroll-shell overrides still outrank them.
   */
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .min-h-screen,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .min-h-dvh,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .min-h-svh,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .min-h-lvh,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css="all"]) [class^="min-h-["][class*="vh"],',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css="all"]) [class*=" min-h-["][class*="vh"] {',
  '  min-height: var(--mercury-virtual-viewport-height) !important;',
  '}',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .h-screen,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .h-dvh,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .h-svh,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .h-lvh,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css="all"]) [class^="h-["][class*="vh"],',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css="all"]) [class*=" h-["][class*="vh"] {',
  '  height: var(--mercury-virtual-viewport-height) !important;',
  '}',
  'html[data-mercury-expanded-route="true"] [data-mercury-expanded-scroll-shell][data-mercury-expanded-scroll-shell] {',
  '  height: auto !important;',
  '  max-height: none !important;',
  '  min-height: var(--mercury-virtual-viewport-height) !important;',
  '}',
  'html[data-mercury-expanded-route="true"] [data-mercury-expanded-scroll-main][data-mercury-expanded-scroll-main] {',
  '  height: auto !important;',
  '  max-height: none !important;',
  '  overflow: visible !important;',
  '}',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .max-h-screen,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .max-h-dvh,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .max-h-svh,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .max-h-lvh,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css="all"]) [class^="max-h-["][class*="vh"],',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css="all"]) [class*=" max-h-["][class*="vh"] {',
  '  max-height: var(--mercury-virtual-viewport-height) !important;',
  '}',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .w-screen,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css="all"]) [class^="w-["][class*="vw"],',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css="all"]) [class*=" w-["][class*="vw"] {',
  '  width: var(--mercury-virtual-viewport-width) !important;',
  '}',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .min-w-screen,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css="all"]) [class^="min-w-["][class*="vw"],',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css="all"]) [class*=" min-w-["][class*="vw"] {',
  '  min-width: var(--mercury-virtual-viewport-width) !important;',
  '}',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css]) .max-w-screen,',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css="all"]) [class^="max-w-["][class*="vw"],',
  'html[data-mercury-expanded-route="true"]:where([data-mercury-native-viewport-css="all"]) [class*=" max-w-["][class*="vw"] {',
  '  max-width: var(--mercury-virtual-viewport-width) !important;',
  '}',
]

function ensurePageMeasureViewportStyle(): HTMLStyleElement {
  if (pageMeasureViewportStyleEl && pageMeasureViewportStyleEl.isConnected) return pageMeasureViewportStyleEl
  const existing = document.getElementById('mercury-expanded-viewport-stabilizer')
  if (existing instanceof HTMLStyleElement) {
    pageMeasureViewportStyleEl = existing
    return existing
  }
  const el = document.createElement('style')
  el.id = 'mercury-expanded-viewport-stabilizer'
  el.textContent = PAGE_MEASURE_VIEWPORT_STATIC_RULES.join('\n')
  ;(document.head || document.documentElement).appendChild(el)
  pageMeasureViewportStyleEl = el
  return el
}

function ensurePageMeasureViewportDynamicStyle(): HTMLStyleElement {
  if (pageMeasureViewportDynamicStyleEl && pageMeasureViewportDynamicStyleEl.isConnected) {
    return pageMeasureViewportDynamicStyleEl
  }
  const existing = document.getElementById('mercury-expanded-viewport-dynamic-stabilizer')
  if (existing instanceof HTMLStyleElement) {
    pageMeasureViewportDynamicStyleEl = existing
    return existing
  }
  const el = document.createElement('style')
  el.id = 'mercury-expanded-viewport-dynamic-stabilizer'
  ;(document.head || document.documentElement).appendChild(el)
  pageMeasureViewportDynamicStyleEl = el
  return el
}

function escapeCssClassToken(token: string): string {
  const css = window.CSS as { escape?: (value: string) => string } | undefined
  if (typeof css?.escape === 'function') return css.escape(token)
  return token.replace(/[^a-zA-Z0-9_-]/g, (char) => '\\' + char)
}

function decodeTailwindArbitraryValue(value: string): string {
  return value
    .replace(/\\_/g, '\u0000')
    .replace(/_/g, ' ')
    .replace(/\u0000/g, '_')
}

function replaceVirtualViewportUnits(value: string): string | null {
  let changed = false
  const next = value.replace(
    /(-?\d*\.?\d+)(dvh|svh|lvh|vh|dvw|svw|lvw|vw)\b/g,
    (match, amountText: string, unit: string) => {
      const amount = Number(amountText)
      if (!Number.isFinite(amount)) return match
      const basis = unit.endsWith('w')
        ? pageMeasureViewportBaselineWidth
        : pageMeasureViewportBaselineHeight
      changed = true
      return (basis * amount / 100)
        .toFixed(3)
        .replace(/\.0+$/g, '')
        .replace(/(\.\d*?)0+$/g, '$1') + 'px'
    },
  )
  return changed ? next : null
}

function propertyForViewportClass(
  kind: string,
): 'height' | 'min-height' | 'max-height' | 'width' | 'min-width' | 'max-width' | null {
  switch (kind) {
    case 'h':
      return 'height'
    case 'min-h':
      return 'min-height'
    case 'max-h':
      return 'max-height'
    case 'w':
      return 'width'
    case 'min-w':
      return 'min-width'
    case 'max-w':
      return 'max-width'
    default:
      return null
  }
}

function eligibleExpandedScrollingShell(candidate: HTMLElement): HTMLElement | null {
  const { overflowX, overflowY } = window.getComputedStyle(candidate)
  if ((overflowY !== 'auto' && overflowY !== 'scroll') || candidate.scrollHeight <= candidate.clientHeight + 1) return null
  if ((overflowX === 'auto' || overflowX === 'scroll') && candidate.scrollWidth > candidate.clientWidth + 1) return null
  const parent = candidate.parentElement
  // Equivalent to the optional-chained form this replaces -- a null parent
  // made both shells nullish and fell through to the return below -- but it
  // narrows `parent` for the dereference in the loop, which the generated
  // app's own typecheck rejects under strictNullChecks.
  if (!parent) return null
  const shells = [parent, parent.parentElement]
  for (const shell of shells) {
    if (!shell) continue
    if (shell !== parent && window.getComputedStyle(parent).display !== 'flex') continue
    const height = Number.parseFloat(window.getComputedStyle(shell).height)
    if (Math.abs(height - pageMeasureViewportBaselineHeight) > 2) continue
    return shell
  }
  return null
}

function restoreExpandedScrollOffsets(): void {
  for (const [main, offset] of expandedScrollOffsets) {
    if (!main.isConnected) {
      expandedScrollOffsets.delete(main)
      continue
    }
    if (main.hasAttribute('data-mercury-expanded-scroll-main')) continue
    main.scrollTop = offset.top
    main.scrollLeft = offset.left
    if (main.scrollTop === offset.top && main.scrollLeft === offset.left) {
      expandedScrollOffsets.delete(main)
    }
  }
}

function syncExpandedScrollingShells(): void {
  for (const [shell, main] of expandedScrollingShells) {
    shell.removeAttribute('data-mercury-expanded-scroll-shell')
    main.removeAttribute('data-mercury-expanded-scroll-main')
    if (shell.isConnected && main.isConnected && eligibleExpandedScrollingShell(main) === shell) {
      shell.setAttribute('data-mercury-expanded-scroll-shell', '')
      main.setAttribute('data-mercury-expanded-scroll-main', '')
    } else {
      expandedScrollingShells.delete(shell)
    }
  }
  for (const candidate of document.querySelectorAll('main')) {
    if (!(candidate instanceof HTMLElement)) continue
    if (candidate.hasAttribute('data-mercury-expanded-scroll-main')) continue
    const shell = eligibleExpandedScrollingShell(candidate)
    if (!shell || expandedScrollingShells.has(shell)) continue
    if (!expandedScrollOffsets.has(candidate) && (candidate.scrollTop || candidate.scrollLeft)) {
      expandedScrollOffsets.set(candidate, { top: candidate.scrollTop, left: candidate.scrollLeft })
    }
    shell.setAttribute('data-mercury-expanded-scroll-shell', '')
    candidate.setAttribute('data-mercury-expanded-scroll-main', '')
    expandedScrollingShells.set(shell, candidate)
  }
  restoreExpandedScrollOffsets()
}

function hasNativeViewportUnit(value: string): boolean {
  // The viewport plugin rebases units to var(--mercury-v{h,w}, 1<unit>); any
  // viewport unit left after removing those is native.
  return /\d[dsl]?v[hw]\b/i.test(value.replace(/var\(--mercury-v[hw],[^)]*\)/g, ''))
}

function cssMediaApplies(media: MediaList | undefined): boolean {
  return !media?.mediaText || window.matchMedia(media.mediaText).matches
}

// Kept out of line: the instanceof narrowing would otherwise leak into the
// caller's loop and fail the generated app's strict typecheck.
function cssRuleConditionHolds(rule: CSSRule & { media?: MediaList }): boolean {
  if (rule instanceof CSSSupportsRule) return CSS.supports(rule.conditionText)
  return cssMediaApplies(rule.media)
}

function cssRulesStyleViewportFallbackTargetsNatively(rules: CSSRuleList, scan: { unreadable: boolean }): boolean {
  // Selectors naming a utility the class-based fallbacks target: *-screen,
  // *-dvh/svh/lvh and arbitrary *-[…] for h, min-h, max-h, w, min-w, max-w.
  // A following name character or escape (h-screen-safe, h-screen!) is a different class.
  const fallbackTarget = /\.((?:min-|max-)?[hw])-(?:(?:screen|[dsl]vh)(?![\w-]|\\)|\\\[)/g
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as CSSRule & {
      selectorText?: string
      style?: CSSStyleDeclaration
      cssRules?: CSSRuleList
      styleSheet?: CSSStyleSheet | null
      media?: MediaList
    }
    // @media, @import and @supports rules whose condition does not hold cannot size anything now.
    if (!cssRuleConditionHolds(rule)) continue
    if (rule.styleSheet && styleSheetStylesViewportFallbackTargetsNatively(rule.styleSheet, scan)) return true
    if (rule.selectorText && rule.style) {
      // Only the property the utility sets decides; other declarations cannot
      // be repaired by its fallback.
      for (const [, kind] of rule.selectorText.matchAll(fallbackTarget)) {
        const property = propertyForViewportClass(kind)
        if (property && hasNativeViewportUnit(rule.style.getPropertyValue(property))) return true
      }
    }
    if (rule.cssRules && cssRulesStyleViewportFallbackTargetsNatively(rule.cssRules, scan)) return true
  }
  return false
}

function styleSheetStylesViewportFallbackTargetsNatively(sheet: CSSStyleSheet, scan: { unreadable: boolean }): boolean {
  if (sheet.disabled || !cssMediaApplies(sheet.media)) return false
  let rules: CSSRuleList
  try {
    rules = sheet.cssRules
  } catch {
    // Cross-origin CSS cannot be inspected. The Google Fonts CSS Mercury
    // itself injects carries no utilities; any other is recorded for the gate.
    if (!sheet.href?.startsWith('https://fonts.googleapis.com/')) scan.unreadable = true
    return false
  }
  return cssRulesStyleViewportFallbackTargetsNatively(rules, scan)
}

function inlineStylesKeepViewportFallbackTargetsNative(): boolean {
  // The plugin cannot rewrite inline styles, so an element pairing a covered
  // utility with an inline viewport unit on the property it sets still relies
  // on its fallback. The parsed value is read because the attribute text may
  // escape the unit (100\76 h is 100vh).
  const coveredClass = /^((?:min-|max-)?[hw])-(?:(?:screen|[dsl]vh)$|\[)/
  return Array.from(document.querySelectorAll<HTMLElement>('[class][style]')).some((el) =>
    Array.from(el.classList).some((token) => {
      const property = propertyForViewportClass(coveredClass.exec(token)?.[1] ?? '')
      return property !== null && hasNativeViewportUnit(el.style.getPropertyValue(property))
    }),
  )
}

function syncViewportClassFallbackGate(): boolean {
  // Sheets are re-read on every sync: insertRule(), deleteRule() and
  // replaceSync() keep a sheet's identity and fire no event, and media
  // conditions change with the tile's size. Such an edit is seen at the next
  // sync; one that changes the page's size schedules it through the page-size
  // ResizeObserver.
  const scan = { unreadable: false }
  const native =
    [...Array.from(document.styleSheets), ...(document.adoptedStyleSheets ?? [])].some(
      (sheet) => styleSheetStylesViewportFallbackTargetsNatively(sheet, scan),
    ) || inlineStylesKeepViewportFallbackTargetsNative()
  // Cross-origin CSS is prebuilt rather than generated from the app's classes,
  // so the covered utilities it can size natively are the named ones; the
  // app's arbitrary values come from its own, readable CSS. It therefore keeps
  // only the named fallbacks. For plugin-rebased CSS these force the size the
  // utility already has, but still override a responsive or state variant of
  // it (h-screen md:h-auto), as on main. Cross-origin CSS defining arbitrary
  // covered classes is not detected.
  const level = native ? 'all' : scan.unreadable ? 'named' : null
  const html = document.documentElement
  const attribute = 'data-mercury-native-viewport-css'
  if (level === null) html.removeAttribute(attribute)
  else if (html.getAttribute(attribute) !== level) html.setAttribute(attribute, level)
  return native
}

function syncVirtualViewportClassRules(): void {
  if (document.documentElement.getAttribute('data-mercury-expanded-route') !== 'true') return
  const native = syncViewportClassFallbackGate()
  syncExpandedScrollingShells()
  const rules = new Map<string, string>()
  // Per-class rules are native-CSS fallbacks too: plugin-rebased CSS already
  // resolves these values, and an !important copy would override its
  // responsive and state variants.
  const elements = native ? document.body?.querySelectorAll('[class]') ?? [] : []
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as HTMLElement
    for (const token of Array.from(el.classList)) {
      const match = /^(min-h|max-h|h|min-w|max-w|w)-\[(.+)\]$/.exec(token)
      if (!match) continue
      const property = propertyForViewportClass(match[1])
      if (!property) continue
      const value = replaceVirtualViewportUnits(decodeTailwindArbitraryValue(match[2]))
      if (!value) continue
      rules.set(
        token + property,
        'html[data-mercury-expanded-route="true"] .'
          + escapeCssClassToken(token)
          + ' { '
          + property
          + ': '
          + value
          + ' !important; }',
      )
    }
  }
  ensurePageMeasureViewportDynamicStyle().textContent = Array.from(rules.values()).join('\n')
  pageMeasureViewportRuleLastSyncAt = Date.now()
}

function scheduleVirtualViewportClassRulesSync(): void {
  if (document.documentElement.getAttribute('data-mercury-expanded-route') !== 'true') return
  const elapsed = Date.now() - pageMeasureViewportRuleLastSyncAt
  if (elapsed >= PAGE_MEASURE_VIEWPORT_RULE_SYNC_INTERVAL_MS) {
    if (pageMeasureViewportRuleSyncTimer != null) {
      window.clearTimeout(pageMeasureViewportRuleSyncTimer)
      pageMeasureViewportRuleSyncTimer = null
    }
    syncVirtualViewportClassRules()
    return
  }
  if (pageMeasureViewportRuleSyncTimer != null) return
  pageMeasureViewportRuleSyncTimer = window.setTimeout(() => {
    pageMeasureViewportRuleSyncTimer = null
    syncVirtualViewportClassRules()
  }, PAGE_MEASURE_VIEWPORT_RULE_SYNC_INTERVAL_MS - elapsed)
}

function setExpandedViewportBaseline(enabled: boolean): void {
  if (enabled) {
    if (expandedScrollRestoreTimer != null) {
      window.clearTimeout(expandedScrollRestoreTimer)
      expandedScrollRestoreTimer = null
    }
    ensurePageMeasureViewportStyle()
    applyViewportBaselineVars()
    document.documentElement.setAttribute('data-mercury-expanded-route', 'true')
    syncVirtualViewportClassRules()
    syncAnimationPauseState()
    return
  }
  cancelViewportAnimationSettleUnlessInspectOwned()
  document.documentElement.removeAttribute('data-mercury-expanded-route')
  for (const [shell, main] of expandedScrollingShells) {
    shell.removeAttribute('data-mercury-expanded-scroll-shell')
    main.removeAttribute('data-mercury-expanded-scroll-main')
  }
  expandedScrollingShells.clear()
  document.documentElement.removeAttribute('data-mercury-native-viewport-css')
  clearViewportBaselineVars()
  if (pageMeasureViewportRuleSyncTimer != null) {
    window.clearTimeout(pageMeasureViewportRuleSyncTimer)
    pageMeasureViewportRuleSyncTimer = null
  }
  if (pageMeasureViewportDynamicStyleEl) pageMeasureViewportDynamicStyleEl.textContent = ''
  restoreExpandedScrollOffsets()
  expandedScrollRestoreTimer = window.setTimeout(() => {
    expandedScrollOffsets.clear()
    expandedScrollRestoreTimer = null
  }, 2000)
  syncAnimationPauseState()
  if (!inspectEnabled) clearInspectRevealSnapshots()
}

function updatePageMeasureViewportBaseline(width: unknown, height: unknown): void {
  if (typeof width === 'number' && Number.isFinite(width)) {
    pageMeasureViewportBaselineWidth = Math.max(1, Math.ceil(width))
  }
  if (typeof height === 'number' && Number.isFinite(height)) {
    pageMeasureViewportBaselineHeight = Math.max(1, Math.ceil(height))
  }
  if (document.documentElement.getAttribute('data-mercury-expanded-route') === 'true') {
    applyViewportBaselineVars()
    syncVirtualViewportClassRules()
  }
}

function hasDirectVisibleText(el: HTMLElement): boolean {
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i]
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return true
  }
  return false
}

function measureDirectVisibleTextBottom(el: HTMLElement, scrollY: number): number | null {
  let bottom: number | null = null
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i]
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue
    const range = document.createRange()
    try {
      range.selectNodeContents(node)
      const rect = range.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        const elementBottom = rect.bottom + scrollY
        if (Number.isFinite(elementBottom)) {
          bottom = Math.max(bottom ?? 0, elementBottom)
        }
      }
    } finally {
      range.detach()
    }
  }
  return bottom == null ? null : Math.ceil(bottom)
}

function isPageMeasureSemanticTarget(el: HTMLElement): boolean {
  const tag = el.tagName
  if (PAGE_MEASURE_TAGS.has(tag)) return true
  if (el.isContentEditable) return true
  const role = el.getAttribute('role')
  if (
    role === 'img' ||
    role === 'button' ||
    role === 'link' ||
    role === 'form' ||
    role === 'list' ||
    role === 'listitem' ||
    role === 'textbox'
  ) {
    return true
  }
  return false
}

function isPageMeasureTarget(el: HTMLElement): boolean {
  return isPageMeasureSemanticTarget(el) || hasDirectVisibleText(el)
}

function isDecorativeMediaMeasureTarget(
  el: HTMLElement,
  rect: DOMRect,
  style: CSSStyleDeclaration,
): boolean {
  const tag = el.tagName
  const role = el.getAttribute('role')
  const isMedia =
    tag === 'CANVAS' ||
    tag === 'IMG' ||
    tag === 'PICTURE' ||
    tag === 'VIDEO' ||
    tag === 'SVG' ||
    role === 'img'
  if (!isMedia) return false
  if (el.getAttribute('aria-hidden') === 'true') return true
  if (role === 'presentation' || role === 'none') return true
  if (
    style.position === 'absolute' ||
    style.pointerEvents === 'none'
  ) {
    return true
  }

  const viewportHeight = Math.max(
    1,
    window.innerHeight || 0,
    window.visualViewport?.height || 0,
    document.documentElement?.clientHeight || 0,
  )
  const fillsViewportHeight =
    rect.height >= viewportHeight * 0.78 &&
    rect.top <= viewportHeight * 0.25
  if (!fillsViewportHeight) return false

  const objectFit = style.objectFit
  const behavesLikeBackground =
    objectFit === 'cover' ||
    objectFit === 'fill'
  return behavesLikeBackground
}

function currentViewportHeight(): number {
  return Math.max(
    1,
    window.innerHeight || 0,
    window.visualViewport?.height || 0,
    document.documentElement?.clientHeight || 0,
  )
}

function documentScrollHeight(): number {
  return Math.max(
    1,
    document.documentElement?.scrollHeight || 0,
    document.body?.scrollHeight || 0,
  )
}

function isViewportFeedbackHeight(contentBottom: number): boolean {
  const viewportHeight = currentViewportHeight()
  if (viewportHeight <= pageMeasureViewportBaselineHeight * 1.25) return false
  return (
    documentScrollHeight() <= viewportHeight + PAGE_MEASURE_VIEWPORT_FEEDBACK_EPSILON &&
    contentBottom >= viewportHeight * 0.75
  )
}

function hasViewportExpandedFromInitial(): boolean {
  return currentViewportHeight() > pageMeasureViewportBaselineHeight + PAGE_MEASURE_VIEWPORT_FEEDBACK_EPSILON
}

function measureContentBottom(): number {
  const scrollY = window.scrollY || window.pageYOffset || 0
  let bottom = 0
  const elements = document.body?.querySelectorAll('*') ?? []
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as HTMLElement
    const tag = el.tagName
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META') continue
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (style.position === 'fixed') continue
    if (isDecorativeMediaMeasureTarget(el, rect, style)) continue
    if (!isPageMeasureTarget(el)) continue
    const directTextBottom = measureDirectVisibleTextBottom(el, scrollY)
    const elementBottom =
      directTextBottom != null && !isPageMeasureSemanticTarget(el)
        ? directTextBottom
        : rect.bottom + scrollY
    if (Number.isFinite(elementBottom)) bottom = Math.max(bottom, elementBottom)
  }
  return Math.ceil(bottom)
}

function clampPageMeasureHeight(height: number): number {
  // An expanded tile is laid out against the virtual viewport (html is pinned
  // to it), so that is its floor, even past the measurement cap: a shorter tile
  // clips a one-viewport page, and the fixed minimum would pad a short viewport
  // past the page.
  if (document.documentElement.getAttribute('data-mercury-expanded-route') === 'true') {
    const measured = Number.isFinite(height) ? Math.min(PAGE_MEASURE_MAX_HEIGHT, Math.ceil(height)) : 0
    return Math.max(pageMeasureViewportBaselineHeight, measured)
  }
  if (!Number.isFinite(height)) return PAGE_MEASURE_MIN_HEIGHT
  return Math.min(
    PAGE_MEASURE_MAX_HEIGHT,
    Math.max(PAGE_MEASURE_MIN_HEIGHT, Math.ceil(height)),
  )
}

function resolveExpandedRouteHeight(
  path: string,
  measuredHeight: number,
  stableRouteHeight: number | undefined,
): number | null {
  const candidateHeight = clampPageMeasureHeight(
    measuredHeight || pageMeasureViewportBaselineHeight,
  )
  if (
    stableRouteHeight != null &&
    Math.abs(candidateHeight - stableRouteHeight) <= PAGE_MEASURE_STABLE_CHANGE_EPSILON
  ) {
    pageMeasureSettleStates.delete(path)
    return stableRouteHeight
  }

  const previous = pageMeasureSettleStates.get(path)
  const attempts = (previous?.attempts ?? 0) + 1
  const minHeight = previous ? Math.min(previous.minHeight, candidateHeight) : candidateHeight
  const maxHeight = previous ? Math.max(previous.maxHeight, candidateHeight) : candidateHeight
  const remainsInSettleRange =
    maxHeight - minHeight <= PAGE_MEASURE_STABLE_CHANGE_EPSILON
  const nextState: PageMeasureSettleState = remainsInSettleRange
    ? {
        minHeight,
        maxHeight,
        count: (previous?.count ?? 0) + 1,
        attempts,
        exhausted: attempts >= PAGE_MEASURE_MAX_SETTLE_ATTEMPTS,
      }
    : {
        minHeight: candidateHeight,
        maxHeight: candidateHeight,
        count: 1,
        attempts,
        exhausted: attempts >= PAGE_MEASURE_MAX_SETTLE_ATTEMPTS,
      }
  pageMeasureSettleStates.set(path, nextState)
  if (nextState.count >= PAGE_MEASURE_STABLE_CHANGE_COUNT) {
    stablePageHeights.set(path, candidateHeight)
    pageMeasureSettleStates.delete(path)
    return candidateHeight
  }
  // ResizeObserver is allowed to deliver only once for a single async layout
  // change. Keep measuring until the candidate is confirmed instead of waiting
  // for another observer notification that may never arrive. Until then retain
  // the parent's existing geometry; a fresh document has no trustworthy
  // fallback height and must not publish the virtual-viewport baseline.
  // Stop the bridge-owned polling loop after a bounded number of attempts.
  // Real ResizeObserver/layout events may still provide enough subsequent
  // samples to commit a stable height, but a JS-driven oscillation cannot keep
  // a full-DOM measurement loop alive for the document's lifetime.
  if (!nextState.exhausted) schedulePageSizePublish(80)
  return stableRouteHeight ?? null
}

function measurePageSize(): { path: string; width: number; height: number } | null {
  const doc = document.documentElement
  const body = document.body
  const path = normalizePagePath(pinnedRoutePath ?? location.pathname ?? '/')
  // Report the rendered iframe viewport width, not document overflow width. A tiny
  // horizontal overflow can otherwise feed back through ResizeObserver and
  // make each subsequent size report wider than the last.
  const width = Math.max(
    1,
    window.innerWidth || 0,
    window.visualViewport?.width || 0,
    doc?.clientWidth || 0,
    body?.clientWidth || 0,
  )
  const viewportExpanded = hasViewportExpandedFromInitial()
  const contentBottom = measureContentBottom()
  let expandedShellBottom = 0
  for (const shell of expandedScrollingShells.keys()) {
    if (shell.isConnected) {
      expandedShellBottom = Math.max(
        expandedShellBottom,
        shell.getBoundingClientRect().bottom + (window.scrollY || window.pageYOffset || 0),
      )
    }
  }
  const layoutHeight = documentScrollHeight()
  const stableRouteHeight = stablePageHeights.get(path)
  const viewportFeedback = isViewportFeedbackHeight(contentBottom)
    && expandedShellBottom <= (stableRouteHeight ?? pageMeasureViewportBaselineHeight)
  const contentHeight = Math.max(contentBottom, expandedShellBottom) > 0
    ? Math.max(contentBottom, expandedShellBottom) + PAGE_MEASURE_BOTTOM_PADDING
    : 0
  const measuredHeight = contentHeight || (layoutHeight + PAGE_MEASURE_BOTTOM_PADDING)
  let rawHeight: number | null
  if (viewportExpanded) {
    rawHeight = viewportFeedback
      ? (stableRouteHeight ?? null)
      : resolveExpandedRouteHeight(path, measuredHeight, stableRouteHeight)
  } else if (viewportFeedback) {
    rawHeight = stableRouteHeight ?? (contentHeight || pageMeasureViewportBaselineHeight)
  } else {
    rawHeight = measuredHeight
  }
  if (rawHeight == null) {
    return null
  }
  const height = clampPageMeasureHeight(rawHeight)
  if (!viewportExpanded && !viewportFeedback) {
    stablePageHeights.set(path, height)
    pageMeasureSettleStates.set(path, {
      minHeight: height,
      maxHeight: height,
      count: 0,
      attempts: 0,
      exhausted: false,
    })
  }
  return {
    path,
    width: Math.ceil(width),
    height: Math.ceil(height),
  }
}

function publishPageSize(): void {
  try {
    // Viewport-class rules describe the rendered document and must keep up
    // with HMR even while geometry publication is frozen.
    scheduleVirtualViewportClassRulesSync()
    restoreExpandedScrollOffsets()
    if (pageSizeHostFrozen || pageSizeHmrFrozen) return
    const pageSize = measurePageSize()
    if (pageSize) post({ source: 'mercury-bridge', type: 'page-size', ...pageSize })
  } catch {
    /* no-op */
  }
}

const pageSizePublishTimers = new Map<number, number>()

function cancelScheduledPageSizePublishes(): void {
  for (const timer of pageSizePublishTimers.values()) window.clearTimeout(timer)
  pageSizePublishTimers.clear()
}

function schedulePageSizePublish(delay = 80): void {
  const existing = pageSizePublishTimers.get(delay)
  if (existing != null) clearTimeout(existing)
  const timer = window.setTimeout(() => {
    pageSizePublishTimers.delete(delay)
    bridgeRequestAnimationFrame(() => {
      publishPageSize()
      // A route pin changes the iframe's rendered layout without necessarily
      // producing a browser resize event. Re-measure tracked comment targets
      // after every settled layout pass so annotations follow their elements
      // through expand and collapse.
      schedulePositionSync()
    })
  }, delay)
  pageSizePublishTimers.set(delay, timer)
}

function scheduleSettledPageSizePublish(): void {
  schedulePageSizePublish(80)
  schedulePageSizePublish(250)
  schedulePageSizePublish(600)
  schedulePageSizePublish(1200)
}

function freezePageSizeForHmr(): void {
  pageSizeHmrFrozen = true
  if (pageSizeHmrSettleTimer != null) {
    window.clearTimeout(pageSizeHmrSettleTimer)
    pageSizeHmrSettleTimer = null
  }
  if (pageSizeHmrWatchdogTimer != null) window.clearTimeout(pageSizeHmrWatchdogTimer)
  pageSizeHmrWatchdogTimer = window.setTimeout(() => {
    pageSizeHmrWatchdogTimer = null
    releasePageSizeAfterHmr()
  }, PAGE_SIZE_HMR_MAX_FREEZE_MS)
  cancelScheduledPageSizePublishes()
}

function releasePageSizeAfterHmr(): void {
  if (pageSizeHmrSettleTimer != null) {
    window.clearTimeout(pageSizeHmrSettleTimer)
    pageSizeHmrSettleTimer = null
  }
  if (pageSizeHmrWatchdogTimer != null) {
    window.clearTimeout(pageSizeHmrWatchdogTimer)
    pageSizeHmrWatchdogTimer = null
  }
  if (!pageSizeHmrFrozen) return
  pageSizeHmrFrozen = false
  if (pageSizeHostFrozen) return
  const path = normalizePagePath(pinnedRoutePath ?? location.pathname ?? '/')
  pageMeasureSettleStates.delete(path)
  scheduleSettledPageSizePublish()
}

function settlePageSizeAfterHmr(): void {
  if (!pageSizeHmrFrozen) return
  if (pageSizeHmrSettleTimer != null) window.clearTimeout(pageSizeHmrSettleTimer)
  pageSizeHmrSettleTimer = window.setTimeout(() => {
    pageSizeHmrSettleTimer = null
    releasePageSizeAfterHmr()
  }, PAGE_SIZE_HMR_SETTLE_MS)
}

function trimRuntimeString(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value
    .trim()
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
  return normalized ? normalized.slice(0, maxLength) : undefined
}

function runtimeErrorFields(value: unknown): { name?: string; message?: string } {
  if (value instanceof Error) {
    return {
      name: trimRuntimeString(value.name, 120),
      message: trimRuntimeString(value.message, 500),
    }
  }
  if (value && typeof value === 'object') {
    const record = value as { name?: unknown; message?: unknown }
    return {
      name: trimRuntimeString(record.name, 120),
      message: trimRuntimeString(record.message, 500) ?? trimRuntimeString(String(value), 500),
    }
  }
  return {
    name: typeof value,
    message: trimRuntimeString(String(value), 500),
  }
}

function postRuntimeError(
  kind: 'error' | 'unhandledrejection',
  value: unknown,
  locationFields: { filename?: unknown; lineno?: unknown; colno?: unknown } = {},
): void {
  const fields = runtimeErrorFields(value)
  post({
    source: 'mercury-bridge',
    type: 'runtime-error',
    kind,
    name: fields.name,
    message: fields.message,
    filename: trimRuntimeString(locationFields.filename, 256),
    lineno: typeof locationFields.lineno === 'number' && Number.isFinite(locationFields.lineno)
      ? Math.max(0, Math.floor(locationFields.lineno))
      : undefined,
    colno: typeof locationFields.colno === 'number' && Number.isFinite(locationFields.colno)
      ? Math.max(0, Math.floor(locationFields.colno))
      : undefined,
    routePath: appRelativePath(location.pathname),
  })
}

function runMercuryRouteChange(fn: () => void): void {
  mercuryRouteChangeDepth += 1
  try {
    fn()
  } finally {
    mercuryRouteChangeDepth -= 1
  }
}

const TRUSTED_LOCAL_PARENT_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  'local.mercury.adobe.com',
  'localhost.adobe.com',
])

function isTrustedAppParentOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin)
    if (parsed.origin !== origin) return false
    if (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'adobe.com' || parsed.hostname.endsWith('.adobe.com'))
    ) return true
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      TRUSTED_LOCAL_PARENT_HOSTS.has(parsed.hostname)
    )
  } catch {
    return false
  }
}

let trustedParentOrigin: string | null = null
let publishPageStateAfterParentPin: (() => void) | null = null

function postToParent(msg: unknown): void {
  if (!trustedParentOrigin) return
  try {
    window.parent?.postMessage(msg, trustedParentOrigin)
  } catch {
    /* no-op */
  }
}

function post(msg: OutboundMessage): void {
  postToParent(msg)
}

function postBridgeReady(): void {
  try {
    // This non-sensitive boot ping lets the authenticated parent initiate the
    // handshake; all other messages remain pinned by postToParent.
    window.parent?.postMessage({
      source: 'mercury-bridge',
      type: 'ready',
      version: BRIDGE_VERSION,
      // The ready ping uses targetOrigin='*', so expose only the non-sensitive
      // fact the parent needs to repair a satellite full reload. The concrete
      // generated-app route remains private until the parent is authenticated.
      bootedAtHome: originalAppRoutePath === '/',
      capabilities: {
        elementResizeHandles: true,
        elementMoveReorder: true,
        resizeFeatureGate: true,
        directManipulationGestures: true,
        componentCallSiteMetadata: true,
      },
    }, '*')
  } catch {
    /* no-op */
  }
}

function postHmrSettled(editVerificationId?: string): void {
  // SVG replacements are previewed by a Mercury-owned <image> child so React's
  // managed SVG children remain untouched. Once the rebuilt component has
  // rendered, hand visual ownership back to React and remove committed
  // previews. Uncommitted previews survive unrelated HMR updates.
  cleanupCommittedSvgPreviews()
  hmrRevision += 1
  post({
    source: 'mercury-bridge',
    type: 'hmr-settled',
    documentId: hmrDocumentId,
    revision: hmrRevision,
    routePath: appRelativePath(location.pathname),
    ...(editVerificationId ? { editVerificationId } : {}),
  })
  // Push a fresh layers snapshot after every rebuild so the Layers panel
  // always reflects the current DOM. This is the only callsite where the DOM
  // is guaranteed committed (double-rAF above). Without this, the panel holds
  // a stale pre-stamp snapshot — showing oid:null on elements that were just
  // stamped by the post-agent pass — until the user manually refreshes.
  //
  // hmrLayersPublished guards against a double publish: for marker-correlated
  // agent edits both the generic vite:afterUpdate path and the correlated path
  // call postHmrSettled(), which would cause two full DOM walks per rebuild.
  // The flag is reset to false at the top of every vite:afterUpdate event, so
  // the first postHmrSettled() to run publishes and the second is a no-op.
  // For full-page reloads the flag starts false (fresh module scope) so
  // postHmrSettled(editVerificationId) publishes correctly.
  if (inspectEnabled && !hmrLayersPublished) {
    hmrLayersPublished = true
    publishLayersTree()
  }
}

function postHmrRevisionSnapshot(): void {
  post({
    source: 'mercury-bridge',
    type: 'hmr-settled',
    documentId: hmrDocumentId,
    revision: hmrRevision,
    routePath: appRelativePath(location.pathname),
  })
}

function clearEditHmrBridgeState(editVerificationId: string): void {
  const pending = pendingEditHmrSignals.get(editVerificationId)
  if (pending) clearTimeout(pending.timer)
  pendingEditHmrSignals.delete(editVerificationId)
  const receipt = editHmrMarkerReceipts.get(editVerificationId)
  if (receipt) clearTimeout(receipt.expiryTimer)
  editHmrMarkerReceipts.delete(editVerificationId)
  for (const [markerId, batch] of editHmrMarkerBatches) {
    batch.markers = batch.markers.filter((marker) => marker.verificationId !== editVerificationId)
    if (batch.markers.length > 0) continue
    clearTimeout(batch.expiryTimer)
    editHmrMarkerBatches.delete(markerId)
  }
}

function editHmrMarkerReceipt(editVerificationId: string): {
  appliedFiles: Set<string>
  failedFiles: Set<string>
  expiryTimer: ReturnType<typeof setTimeout>
} {
  const existing = editHmrMarkerReceipts.get(editVerificationId)
  if (existing) return existing
  const expiryTimer = setTimeout(() => {
    const current = editHmrMarkerReceipts.get(editVerificationId)
    if (current?.expiryTimer !== expiryTimer) return
    editHmrMarkerReceipts.delete(editVerificationId)
  }, EDIT_HMR_MARKER_MAX_AGE_MS)
  const created = {
    appliedFiles: new Set<string>(),
    failedFiles: new Set<string>(),
    expiryTimer,
  }
  editHmrMarkerReceipts.set(editVerificationId, created)
  return created
}

function maybePostCorrelatedHmr(editVerificationId: string): void {
  const pending = pendingEditHmrSignals.get(editVerificationId)
  if (!pending) return
  // A full reload replaces this entire document, so there will be no
  // vite:afterUpdate in this runtime. The token is persisted by
  // vite:beforeFullReload and settled only by the newly mounted bridge.
  if (pending.fullReload) return
  const receipt = editHmrMarkerReceipts.get(editVerificationId)
  if (!receipt) return
  for (const file of pending.expectedFiles) {
    if (receipt.failedFiles.has(file)) {
      clearEditHmrBridgeState(editVerificationId)
      post({
        source: 'mercury-bridge',
        type: 'edit-hmr-unconfirmed',
        editVerificationId,
        routePath: appRelativePath(location.pathname),
      })
      return
    }
    if (!receipt.appliedFiles.has(file)) return
  }
  clearEditHmrBridgeState(editVerificationId)
  bridgeRequestAnimationFrame(() => {
    bridgeRequestAnimationFrame(() => postHmrSettled(editVerificationId))
  })
}

function rememberPendingEditHmr(
  editVerificationId: string,
  expectedFiles: readonly string[],
  fullReload = false,
): void {
  const previous = pendingEditHmrSignals.get(editVerificationId)
  if (previous) clearTimeout(previous.timer)
  const timer = setTimeout(() => {
    if (pendingEditHmrSignals.get(editVerificationId)?.timer !== timer) return
    // Missing markers, messages, or afterUpdate evidence are inconclusive.
    // Never turn a transport/tooling compatibility gap into a user-visible
    // HMR failure; only an explicitly marker-correlated Vite error does that.
    clearEditHmrBridgeState(editVerificationId)
  }, EDIT_HMR_APPLY_TIMEOUT_MS)
  pendingEditHmrSignals.set(editVerificationId, {
    expectedFiles: new Set(expectedFiles),
    fullReload,
    timer,
  })
  maybePostCorrelatedHmr(editVerificationId)
}

function rememberEditHmrMarkers(payload: unknown, failed: boolean): void {
  const markers = payload && typeof payload === 'object' &&
    Array.isArray((payload as { markers?: unknown }).markers)
    ? (payload as { markers: unknown[] }).markers
    : []
  const validMarkers: Array<{ verificationId: string; files: string[] }> = []
  for (const marker of markers) {
    if (!marker || typeof marker !== 'object') continue
    const verificationId = typeof (marker as { verificationId?: unknown }).verificationId === 'string'
      ? (marker as { verificationId: string }).verificationId
      : ''
    const rawFiles = (marker as { files?: unknown }).files
    if (!EDIT_HMR_VERIFICATION_ID_RE.test(verificationId) || !Array.isArray(rawFiles)) continue
    const files = rawFiles.filter((file): file is string => (
      typeof file === 'string' && file.length > 0 && file.length <= 4_096
    ))
    if (files.length === 0 || files.length !== rawFiles.length) continue
    const receipt = editHmrMarkerReceipt(verificationId)
    if (failed) {
      for (const file of files) receipt.failedFiles.add(file)
      maybePostCorrelatedHmr(verificationId)
    } else {
      validMarkers.push({ verificationId, files })
    }
  }
  if (failed || validMarkers.length === 0) return
  const markerId = payload && typeof payload === 'object' &&
    typeof (payload as { markerId?: unknown }).markerId === 'string'
    ? (payload as { markerId: string }).markerId
    : ''
  if (!EDIT_HMR_MARKER_ID_RE.test(markerId)) return
  const previous = editHmrMarkerBatches.get(markerId)
  if (previous) clearTimeout(previous.expiryTimer)
  const expiryTimer = setTimeout(() => {
    if (editHmrMarkerBatches.get(markerId)?.expiryTimer === expiryTimer) {
      editHmrMarkerBatches.delete(markerId)
    }
  }, EDIT_HMR_MARKER_MAX_AGE_MS)
  editHmrMarkerBatches.set(markerId, { markers: validMarkers, expiryTimer })
}

function completeQueuedEditHmrMarkers(payload: unknown): void {
  const markerId = payload && typeof payload === 'object' &&
    typeof (payload as { mercuryEditHmrMarkerId?: unknown }).mercuryEditHmrMarkerId === 'string'
    ? (payload as { mercuryEditHmrMarkerId: string }).mercuryEditHmrMarkerId
    : ''
  if (!EDIT_HMR_MARKER_ID_RE.test(markerId)) return
  const batch = editHmrMarkerBatches.get(markerId)
  if (!batch) return
  clearTimeout(batch.expiryTimer)
  editHmrMarkerBatches.delete(markerId)
  for (const { verificationId, files } of batch.markers) {
    const receipt = editHmrMarkerReceipt(verificationId)
    for (const file of files) receipt.appliedFiles.add(file)
    maybePostCorrelatedHmr(verificationId)
  }
}

function persistPendingFullReloadEditHmr(): void {
  const verificationIds = [...pendingEditHmrSignals.entries()]
    .filter(([, pending]) => pending.fullReload)
    .map(([verificationId]) => verificationId)
  if (verificationIds.length === 0) return
  try {
    sessionStorage.setItem(EDIT_HMR_FULL_RELOAD_STORAGE_KEY, JSON.stringify({
      verificationIds,
      savedAt: Date.now(),
    }))
    // The new document now owns these tokens. Drop the old document's timers
    // and marker receipts so a slow reload cannot leave duplicate owners.
    for (const verificationId of verificationIds) {
      clearEditHmrBridgeState(verificationId)
    }
  } catch {
    /* storage-disabled iframe; host timeout remains inconclusive */
  }
}

function consumePendingFullReloadEditHmr(): string[] {
  try {
    const raw = sessionStorage.getItem(EDIT_HMR_FULL_RELOAD_STORAGE_KEY)
    sessionStorage.removeItem(EDIT_HMR_FULL_RELOAD_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { verificationIds?: unknown; savedAt?: unknown }
    if (
      typeof parsed.savedAt !== 'number' ||
      !Number.isFinite(parsed.savedAt) ||
      Date.now() - parsed.savedAt > EDIT_HMR_FULL_RELOAD_MAX_AGE_MS ||
      !Array.isArray(parsed.verificationIds)
    ) return []
    return [...new Set(parsed.verificationIds.filter(
      (value): value is string => (
        typeof value === 'string' && EDIT_HMR_VERIFICATION_ID_RE.test(value)
      ),
    ))]
  } catch {
    return []
  }
}

try {
  import.meta.hot?.on('vite:afterUpdate', (payload: unknown) => {
    hmrLayersPublished = false
    completeQueuedEditHmrMarkers(payload)
    bridgeRequestAnimationFrame(() => {
      bridgeRequestAnimationFrame(() => {
        postHmrSettled()
        settlePageSizeAfterHmr()
      })
    })
  })
  import.meta.hot?.on('vite:beforeUpdate', () => {
    freezePageSizeForHmr()
  })
  import.meta.hot?.on('vite:error', () => {
    settlePageSizeAfterHmr()
  })
  import.meta.hot?.on('vite:beforeFullReload', () => {
    freezePageSizeForHmr()
    persistPendingFullReloadEditHmr()
  })
  import.meta.hot?.on('mercury:edit-hmr-correlation', (payload: unknown) => {
    const phase = payload && typeof payload === 'object' &&
      typeof (payload as { phase?: unknown }).phase === 'string'
      ? (payload as { phase: string }).phase
      : ''
    if (phase === 'before-update' || phase === 'vite-error') {
      rememberEditHmrMarkers(payload, phase === 'vite-error')
      return
    }
    const editVerificationId = payload && typeof payload === 'object' &&
      typeof (payload as { verificationId?: unknown }).verificationId === 'string'
      ? (payload as { verificationId: string }).verificationId
      : null
    const files = payload && typeof payload === 'object' &&
      Array.isArray((payload as { files?: unknown }).files)
      ? (payload as { files: unknown[] }).files.filter(
          (file): file is string => typeof file === 'string' && file.length > 0 && file.length <= 4_096,
        )
      : []
    const fullReload = !!payload && typeof payload === 'object' &&
      (payload as { fullReload?: unknown }).fullReload === true
    if (
      phase !== 'finish' ||
      !editVerificationId ||
      !EDIT_HMR_VERIFICATION_ID_RE.test(editVerificationId) ||
      (!fullReload && files.length === 0)
    ) return
    rememberPendingEditHmr(editVerificationId, files, fullReload)
  })
} catch {
  /* non-Vite runtime or older bundler */
}

for (const editVerificationId of consumePendingFullReloadEditHmr()) {
  bridgeRequestAnimationFrame(() => {
    bridgeRequestAnimationFrame(() => postHmrSettled(editVerificationId))
  })
}

type BasePaintStyles = {
  backgroundColor: string
  color: string
  borderTopColor: string
}

function tailwindColorCustomProperty(value: string): string {
  if (/^(?:(?:slate|gray|neutral|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)|black|white)$/.test(value)) return '--color-' + value
  if (/^(?:background|foreground|card(?:-foreground)?|popover(?:-foreground)?|primary(?:-foreground)?|secondary(?:-foreground)?|muted(?:-foreground)?|accent(?:-foreground)?|destructive(?:-foreground)?|border|input|ring|chart-[1-5])$/.test(value)) return '--' + value
  return ''
}

function resolveBasePaintUtility(
  el: HTMLElement,
  cs: CSSStyleDeclaration,
  prefix: 'bg-' | 'text-' | 'border-',
): string {
  const customProperties = Array.from(el.classList).flatMap((token) => {
    if (!token.startsWith(prefix) || token.indexOf(':') !== -1) return []
    const customProperty = tailwindColorCustomProperty(token.slice(prefix.length).split('/')[0])
    return customProperty ? [customProperty] : []
  })
  // Conflicting base utilities require the full CSS cascade to disambiguate.
  // Returning no bridge fallback is safer than guessing from class order.
  if (customProperties.length !== 1) return ''
  return cs.getPropertyValue(customProperties[0]).trim()
}

function resolveBasePaintUtilities(el: HTMLElement, cs: CSSStyleDeclaration): BasePaintStyles {
  const empty = { backgroundColor: '', color: '', borderTopColor: '' }
  if (el.classList.length === 0) return empty
  // Read inherited theme variables from the selected element's existing
  // computed style. This is deliberately DOM-read-only: connecting a cloned
  // custom element would run application lifecycle hooks and observers.
  return {
    backgroundColor: resolveBasePaintUtility(el, cs, 'bg-'),
    color: resolveBasePaintUtility(el, cs, 'text-'),
    borderTopColor: resolveBasePaintUtility(el, cs, 'border-'),
  }
}

function extractCustomProperties(cs: CSSStyleDeclaration): BridgeAttributes {
  const values: BridgeAttributes = {}
  let count = 0
  for (let i = 0; i < cs.length && count < 40; i++) {
    const property = cs.item(i)
    if (!property.startsWith('--')) continue
    values[property] = cs.getPropertyValue(property).trim().slice(0, 512)
    count++
  }
  return values
}

function extractComputedStyle(el: HTMLElement): BridgeComputedStyle | null {
  try {
    const cs = window.getComputedStyle(el)
    const basePaint = resolveBasePaintUtilities(el, cs)
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      // Dropped rather than truncated when it exceeds the bound: the panel
      // classifies this string to decide whether a Fill edit may clear the
      // paint, and a truncated tail could hide a `url(...)` raster layer behind
      // a long gradient prefix. Reporting nothing degrades to treating the
      // element as unpainted; reporting a cut value could delete an image.
      backgroundImage: cs.backgroundImage.length > 512 ? '' : cs.backgroundImage,
      backgroundClip: cs.backgroundClip,
      baseBackgroundColor: basePaint.backgroundColor,
      baseColor: basePaint.color,
      baseBorderTopColor: basePaint.borderTopColor,
      borderTopColor: cs.borderTopColor,
      borderTopWidth: cs.borderTopWidth,
      borderTopStyle: cs.borderTopStyle,
      borderTopLeftRadius: cs.borderTopLeftRadius,
      borderTopRightRadius: cs.borderTopRightRadius,
      borderBottomRightRadius: cs.borderBottomRightRadius,
      borderBottomLeftRadius: cs.borderBottomLeftRadius,
      width: cs.width,
      height: cs.height,
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      textAlign: cs.textAlign,
      direction: cs.direction,
      boxShadow: cs.boxShadow,
      opacity: cs.opacity,
      mixBlendMode: cs.mixBlendMode,
      overflow: cs.overflow,
      fill: cs.fill,
      objectFit: cs.objectFit,
      scale: cs.scale,
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
      marginTop: cs.marginTop,
      marginRight: cs.marginRight,
      marginBottom: cs.marginBottom,
      marginLeft: cs.marginLeft,
      customProperties: extractCustomProperties(cs),
    }
  } catch {
    return null
  }
}

function cachedSvgComputedStyle(
  element: Element,
  computedStyles: WeakMap<Element, CSSStyleDeclaration>,
): CSSStyleDeclaration {
  const existing = computedStyles.get(element)
  if (existing) return existing
  const computed = getComputedStyle(element)
  computedStyles.set(element, computed)
  return computed
}

type SvgExtractionContext = {
  sourceNodes: Element[]
  computedStyles: WeakMap<Element, CSSStyleDeclaration>
}

function createSvgExtractionContext(el: HTMLElement): SvgExtractionContext {
  return {
    sourceNodes: el.tagName.toLowerCase() === 'svg'
      ? [el, ...Array.from(el.querySelectorAll('*'))]
      : [el],
    computedStyles: new WeakMap<Element, CSSStyleDeclaration>(),
  }
}

function extractSvgColorFacts(
  el: HTMLElement,
  context: SvgExtractionContext,
): {
  isSingleColorSvg: boolean
  isMultiColorSvg: boolean
} {
  if (el.tagName.toLowerCase() !== 'svg') {
    return { isSingleColorSvg: false, isMultiColorSvg: false }
  }
  try {
    const paintNodes = context.sourceNodes.filter((node) => (
      node !== el && node.matches(
        'path, circle, ellipse, line, polygon, polyline, rect, text, use',
      )
    ))
    const nodes = paintNodes.length > 0 ? paintNodes : [el]
    const colors = new Set<string>()
    for (const node of nodes) {
      const fill = cachedSvgComputedStyle(node, context.computedStyles).fill.trim().toLowerCase()
      if (fill && fill !== 'none' && fill !== 'transparent') colors.add(fill)
    }
    return {
      isSingleColorSvg: colors.size === 1,
      isMultiColorSvg: colors.size > 1,
    }
  } catch {
    return { isSingleColorSvg: false, isMultiColorSvg: false }
  }
}

function normalizedFontFamily(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

function normalizedFontWeight(value: string): string {
  const weight = value.trim().toLowerCase()
  const named: Record<string, string> = {
    normal: '400',
    bold: '700',
  }
  return named[weight] ?? weight
}

// CSS font-weight is any integer 1–1000 (1000 is legal and 4 digits), so a
// 3-digit-only test would silently drop it.
function isNumericFontWeight(value: string): boolean {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 1000
}

function extractAvailableTypography(el: HTMLElement): {
  availableFonts: string[]
  availableFontWeights: string[]
  availableFontWeightsByFamily: Record<string, string[]>
} {
  try {
    const currentFamily = normalizedFontFamily(
      window.getComputedStyle(el).fontFamily.split(',')[0] || '',
    )
    const families = new Set<string>()
    const weights = new Set<string>()
    const weightsByFamily = new Map<string, Set<string>>()
    if (currentFamily) families.add(currentFamily)
    // Include every family actually used by a rendered, editable site node.
    // This keeps the normal dropdown site-scoped instead of exposing every
    // font the browser happens to know about.
    const renderedNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-oid]')).slice(0, 1000)
    for (const node of renderedNodes) {
      const nodeStyle = window.getComputedStyle(node)
      const family = normalizedFontFamily(nodeStyle.fontFamily.split(',')[0] || '')
      if (!family) continue
      families.add(family)
      const observedWeight = normalizedFontWeight(nodeStyle.fontWeight)
      if (isNumericFontWeight(observedWeight)) {
        const familyWeights = weightsByFamily.get(family) ?? new Set<string>()
        familyWeights.add(observedWeight)
        weightsByFamily.set(family, familyWeights)
      }
    }
    const declaredFaces = Array.from(
      document.fonts as unknown as Iterable<FontFace>,
    )
    for (const face of declaredFaces) {
      const family = normalizedFontFamily(face.family)
      if (!family) continue
      const weight = normalizedFontWeight(face.weight)
      if (isNumericFontWeight(weight)) {
        const familyWeights = weightsByFamily.get(family) ?? new Set<string>()
        familyWeights.add(weight)
        weightsByFamily.set(family, familyWeights)
      }
      if (family.toLowerCase() === currentFamily.toLowerCase()) {
        if (isNumericFontWeight(weight)) weights.add(weight)
      }
    }
    const currentWeight = normalizedFontWeight(window.getComputedStyle(el).fontWeight)
    if (isNumericFontWeight(currentWeight)) {
      weights.add(currentWeight)
      if (currentFamily) {
        const familyWeights = weightsByFamily.get(currentFamily) ?? new Set<string>()
        familyWeights.add(currentWeight)
        weightsByFamily.set(currentFamily, familyWeights)
      }
    }
    const availableFontWeightsByFamily: Record<string, string[]> = {}
    for (const family of families) {
      const familyWeights = weightsByFamily.get(family)
      if (familyWeights?.size) {
        availableFontWeightsByFamily[family] = Array.from(familyWeights)
          .sort((a, b) => Number(a) - Number(b))
      }
    }
    return {
      availableFonts: Array.from(families).sort((a, b) => a.localeCompare(b)),
      availableFontWeights: Array.from(weights).sort((a, b) => Number(a) - Number(b)),
      availableFontWeightsByFamily,
    }
  } catch {
    return { availableFonts: [], availableFontWeights: [], availableFontWeightsByFamily: {} }
  }
}

/**
 * Alpha channel of a computed colour, without a regex.
 *
 * The bridge lives inside a template literal, so a single-backslash regex
 * escape never reaches the sandbox (see the `/s+/` hazard elsewhere in this
 * file). String slicing has no such failure mode. Handles both the legacy
 * comma form `rgba(r, g, b, a)` and the modern slash form
 * `rgb(r g b / a)`; an unparseable or absent alpha reads as fully opaque.
 */
function bridgePaintAlpha(color: string): number {
  const value = color.trim().toLowerCase()
  if (!value || value === 'transparent') return 0
  const open = value.indexOf('(')
  const close = value.lastIndexOf(')')
  if (open === -1 || close <= open) return 1
  const inner = value.slice(open + 1, close)
  const slash = inner.lastIndexOf('/')
  let rawAlpha = ''
  if (slash !== -1) {
    rawAlpha = inner.slice(slash + 1).trim()
  } else {
    const channels = inner.split(',')
    if (channels.length >= 4) rawAlpha = (channels[3] || '').trim()
  }
  if (!rawAlpha) return 1
  const alpha = rawAlpha.endsWith('%')
    ? Number(rawAlpha.slice(0, -1)) / 100
    : Number(rawAlpha)
  return Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1
}

/**
 * First colour stop of a gradient that actually paints something.
 *
 * Transparent leading stops are skipped because the common overlay pattern
 * (`bg-gradient-to-t from-black/60 to-transparent` and its inverse) would
 * otherwise report an invisible paint as the perceived colour. Returns null
 * when the value names no colour at all, e.g. a bare `url(...)`.
 */
function bridgeGradientPaintColor(image: string): string | null {
  // Colour functions getComputedStyle can serialize. Missing one would make the
  // walk fall through to an ancestor and attribute its colour to this element.
  const tokens = image.match(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/gi)
  if (!tokens) return null
  for (const token of tokens) {
    if (bridgePaintAlpha(token) > 0) return token
  }
  return null
}

/**
 * The colour a user perceives behind the selected element.
 *
 * Walks self-then-ancestors and reports the first paint that is actually
 * visible: a gradient's first non-transparent colour stop, or a fully opaque
 * `background-color`. `background-image` is checked first at each level
 * because CSS paints it above `background-color`.
 *
 * Starting at the element itself is what lets one field answer two questions:
 * an element with its own gradient resolves on the first iteration, and a
 * transparent element resolves at whichever ancestor actually paints it.
 *
 * A raster paint (`url(...)`) conceals the stack without naming a colour, so
 * the walk reports nothing rather than an ancestor colour the user cannot see.
 * A translucent `background-color` is skipped because compositing it correctly
 * needs more than one value; a translucent gradient stop is reported as-is,
 * since the stop is the paint rather than something layered over one.
 *
 * `background-clip: text` paints the glyphs instead of the box, so such a level
 * contributes no backdrop and the walk passes through it.
 */
function extractResolvedBackgroundColor(el: HTMLElement): string | null {
  try {
    let current: HTMLElement | null = el
    while (current) {
      const cs = window.getComputedStyle(current)
      // `background-clip` is per-layer, so a multi-layer value is a comma list.
      // Only an all-`text` list means no layer paints the box.
      const paintsBox = !cs.backgroundClip
        .split(',')
        .every((layer) => layer.trim() === 'text')
      const image = paintsBox ? cs.backgroundImage.trim() : 'none'
      if (image && image !== 'none') {
        // The first listed layer is the topmost. A raster layer above every
        // gradient conceals the stack without naming a colour, so report
        // nothing rather than a gradient the user cannot see.
        const raster = image.indexOf('url(')
        const gradient = image.indexOf('gradient(')
        if (raster !== -1 && (gradient === -1 || raster < gradient)) return null
        const stop = bridgeGradientPaintColor(image)
        if (stop) return stop
        if (raster !== -1) return null
      }
      const color = paintsBox ? cs.backgroundColor.trim() : ''
      if (bridgePaintAlpha(color) === 1) return color
      current = current.parentElement
    }
  } catch {
    // Ignore inaccessible style state and omit the fact.
  }
  return null
}

const SELECTION_ATTRIBUTE_NAMES = [
  'id',
  'role',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-current',
  'aria-selected',
  'aria-pressed',
  'aria-checked',
  'data-state',
  'data-selected',
  'data-active',
  'data-variant',
  'href',
  'target',
  'rel',
  'src',
  'alt',
  'title',
  'type',
  'name',
  'value',
  'placeholder',
  // Native intrinsic sizing: an <svg width="24"> is a fixed size the panel has to
  // report as such, and the value lives nowhere else in the selection payload.
  'width',
  'height',
] as const

function trimSelectionMetadataValue(value: string | null): string | null {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > 240 ? text.slice(0, 239).trimEnd() + '…' : text
}

function extractAttributes(el: HTMLElement): BridgeAttributes {
  const attrs: BridgeAttributes = {}
  for (const name of SELECTION_ATTRIBUTE_NAMES) {
    const value = trimSelectionMetadataValue(el.getAttribute(name))
    if (value) attrs[name] = value
  }
  return attrs
}

const OID_ATTRIBUTE_NAMES = [
  'data-oid', 'data-oid-shared', 'data-oid-instance-targetable',
  'data-oid-component-root', 'data-oid-text-editable', 'data-oid-text-source',
  'data-oid-style-dynamic',
  'data-oid-classname-dynamic',
]

function extractOidAttributes(el: HTMLElement): BridgeAttributes {
  const attrs: BridgeAttributes = {}
  for (const name of OID_ATTRIBUTE_NAMES) {
    const value = el.getAttribute(name)
    if (value) attrs[name] = value
  }
  return attrs
}

function roundRectValue(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

function extractRect(el: HTMLElement): BridgeRect | null {
  try {
    const rect = el.getBoundingClientRect()
    return {
      x: roundRectValue(rect.x),
      y: roundRectValue(rect.y),
      width: roundRectValue(rect.width),
      height: roundRectValue(rect.height),
    }
  } catch {
    return null
  }
}

function extractDomContext(el: HTMLElement): BridgeDomContext {
  const parent = el.parentElement
  const parentOid = parent?.getAttribute('data-oid') ?? null
  const parentInstanceIndex = parent && parentOid
    ? findOidNodes(parentOid).indexOf(parent)
    : -1
  let siblingIndex: number | null = null
  let siblingCount: number | null = null
  if (parent) {
    const siblings = Array.from(parent.children)
    siblingCount = siblings.length
    const index = siblings.indexOf(el)
    siblingIndex = index >= 0 ? index : null
  }
  return {
    parentTagName: parent ? parent.tagName.toLowerCase() : null,
    parentClassName: parent && typeof parent.className === 'string' ? parent.className : null,
    parentOid,
    parentInstanceIndex: parentInstanceIndex >= 0 ? parentInstanceIndex : null,
    childElementCount: el.children.length,
    siblingIndex,
    siblingCount,
  }
}

function boundedSemanticText(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, 512) : undefined
}

function extractAncestorContext(el: HTMLElement): BridgeAncestorContext[] {
  const ancestors: BridgeAncestorContext[] = []
  let current = el.parentElement
  while (current && current !== document.body && ancestors.length < 4) {
    const oid = current.getAttribute('data-oid')
    if (oid) {
      const directText = boundedSemanticText(readDirectText(current))
      const textContent = boundedSemanticText(current.textContent || '')
      if (directText || textContent) {
        ancestors.push({
          oid,
          tagName: current.tagName.toLowerCase(),
          ...(directText ? { directText } : {}),
          ...(textContent ? { textContent } : {}),
        })
      }
    }
    current = current.parentElement
  }
  return ancestors
}

function hashLocatorSignature(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8)
}

function elementChildIndex(el: HTMLElement): number {
  const parent = el.parentElement
  if (!parent) return -1
  return Array.prototype.indexOf.call(parent.children, el)
}

function locatorSiblingSignature(parent: HTMLElement): string {
  return Array.from(parent.children)
    .map((child) => (child as HTMLElement).tagName.toLowerCase())
    .join(',')
}

function extractInstanceLocator(el: HTMLElement): BridgeInstanceLocator {
  const path: number[] = []
  const signature: string[] = []
  let current: HTMLElement | null = el
  while (current && current !== document.body) {
    const parent: HTMLElement | null = current.parentElement
    if (!parent) break
    const index = elementChildIndex(current)
    if (index < 0) break
    path.unshift(index)
    signature.unshift(
      current.tagName.toLowerCase() + ':' + (current.getAttribute('data-oid') || '') + ':' +
      index + '|' + locatorSiblingSignature(parent),
    )
    current = parent
  }
  return { path, fingerprint: 'v1-' + hashLocatorSignature(signature.join('/')) }
}

function collectSvgPreviewFragmentReferences(root: Element): string[] {
  const references = new Set<string>()
  const collectValue = (value: string, allowDirectReference = false): void => {
    if (allowDirectReference) {
      const directReference = value.trim()
      const fragmentAt = directReference.lastIndexOf('#')
      if (fragmentAt >= 0 && fragmentAt < directReference.length - 1) {
        references.add(directReference.slice(fragmentAt + 1))
      }
    }
    const urlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi
    let match: RegExpExecArray | null
    while ((match = urlPattern.exec(value)) !== null) {
      const resource = match[2] || ''
      const fragmentAt = resource.lastIndexOf('#')
      if (fragmentAt >= 0 && fragmentAt < resource.length - 1) {
        references.add(resource.slice(fragmentAt + 1))
      }
    }
  }
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      collectValue(attribute.value, attribute.localName.toLowerCase() === 'href')
    }
    if (element.tagName.toLowerCase() === 'style') collectValue(element.textContent || '')
  }
  return Array.from(references)
}

function appendExternalSvgPreviewResources(
  preview: SVGSVGElement,
  sourceRoot: HTMLElement,
): void {
  const knownIds = new Set(
    [preview, ...Array.from(preview.querySelectorAll('[id]'))]
      .map((element) => element.getAttribute('id'))
      .filter((id): id is string => Boolean(id)),
  )
  const queuedIds = new Set(collectSvgPreviewFragmentReferences(preview))
  const queue = Array.from(queuedIds)
  let resourceDefs: SVGDefsElement | null = null
  let resourceCount = 0
  const MAX_EXTERNAL_SVG_PREVIEW_RESOURCES = 256

  while (queue.length > 0 && resourceCount < MAX_EXTERNAL_SVG_PREVIEW_RESOURCES) {
    const id = queue.shift()
    if (!id || knownIds.has(id)) continue
    knownIds.add(id)
    const source = document.getElementById(id)
    if (!(source instanceof SVGElement) || source === sourceRoot || sourceRoot.contains(source)) continue

    if (!resourceDefs) {
      resourceDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
      preview.insertBefore(resourceDefs, preview.firstChild)
    }
    const clone = source.cloneNode(true) as SVGElement
    resourceDefs.appendChild(clone)
    resourceCount += 1
    for (const nested of [clone, ...Array.from(clone.querySelectorAll('[id]'))]) {
      const nestedId = nested.getAttribute('id')
      if (nestedId) knownIds.add(nestedId)
    }
    for (const referencedId of collectSvgPreviewFragmentReferences(clone)) {
      if (!knownIds.has(referencedId) && !queuedIds.has(referencedId)) {
        queuedIds.add(referencedId)
        queue.push(referencedId)
      }
    }
  }
}

function extractSvgPreviewMarkup(
  el: HTMLElement,
  context: SvgExtractionContext,
): string | null {
  if (el.tagName.toLowerCase() !== 'svg') return null
  const preview = el.cloneNode(true) as SVGSVGElement
  const originalMarkup = preview.outerHTML
  const sourceNodes = context.sourceNodes
  const previewNodes = [preview, ...Array.from(preview.querySelectorAll('*'))]
  // SVGs generated by React/icon packages often keep paint and transforms in
  // CSS classes. outerHTML alone loses that stylesheet when rendered through
  // a data URL, leaving only the few shapes with literal attributes. Inline a
  // bounded set of rendered SVG properties so the first-selection snapshot is
  // as self-contained as an uploaded SVG file.
  const previewStyleProperties = [
    'display', 'visibility', 'opacity',
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
    'paint-order', 'vector-effect',
    'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end',
    'stop-color', 'stop-opacity',
    'transform', 'transform-origin',
    'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor',
  ]
  const inheritedPreviewProperties = new Set([
    'visibility',
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
    'paint-order', 'marker-start', 'marker-mid', 'marker-end',
    'font-family', 'font-size', 'font-style', 'font-weight', 'text-anchor',
  ])
  const previewPropertyDefaults: Record<string, string> = {
    display: 'inline', visibility: 'visible', opacity: '1',
    fill: 'rgb(0, 0, 0)', 'fill-opacity': '1', 'fill-rule': 'nonzero',
    stroke: 'none', 'stroke-width': '1px', 'stroke-opacity': '1',
    'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stroke-miterlimit': '4',
    'stroke-dasharray': 'none', 'stroke-dashoffset': '0px',
    'paint-order': 'normal', 'vector-effect': 'none',
    'clip-path': 'none', mask: 'none',
    'marker-start': 'none', 'marker-mid': 'none', 'marker-end': 'none',
    'stop-color': 'rgb(0, 0, 0)', 'stop-opacity': '1',
    transform: 'none', 'transform-origin': '0px 0px',
    'font-style': 'normal', 'font-weight': '400', 'text-anchor': 'start',
  }
  if (sourceNodes.length === previewNodes.length && sourceNodes.length <= 2_000) {
    sourceNodes.forEach((source, index) => {
      const target = previewNodes[index]
      if (!(target instanceof SVGElement)) return
      const computed = cachedSvgComputedStyle(source, context.computedStyles)
      const parent = source === el ? null : source.parentElement
      const parentComputed = parent && el.contains(parent)
        ? cachedSvgComputedStyle(parent, context.computedStyles)
        : null
      const renderedTransform = computed.getPropertyValue('transform').trim()
      previewStyleProperties.forEach((property) => {
        const value = computed.getPropertyValue(property).trim()
        if (!value || value.length > 500) return
        // Geometry-derived transform origins on untransformed paths add a lot
        // of markup without changing the rendered preview.
        if (property === 'transform-origin' && (!renderedTransform || renderedTransform === 'none')) return
        const inheritedValue = inheritedPreviewProperties.has(property)
          ? parentComputed?.getPropertyValue(property).trim()
          : ''
        const baseline = inheritedValue || previewPropertyDefaults[property] || ''
        if (value === baseline) return
        // Computed styles expand url(#paint) to an absolute page URL. Convert
        // it back to a local fragment for the self-contained, sanitized image.
        const selfContainedValue = value.replace(
          /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
          (_match, _quote, resource: string) => {
            const fragmentAt = resource.lastIndexOf('#')
            return fragmentAt >= 0 ? 'url(#' + resource.slice(fragmentAt + 1) + ')' : 'none'
          },
        )
        target.style.setProperty(property, selfContainedValue)
      })
    })
  }
  // A selected SVG can reference a shared sprite symbol or document-level
  // paint server outside its own subtree. Copy a bounded dependency closure
  // into the snapshot so local href/url(#id) references still resolve after
  // the preview is moved into a self-contained data URL.
  appendExternalSvgPreviewResources(preview, el)
  // Preserve the authored viewport. Reframing from runtime geometry bounds can include
  // layout helpers or exclude painted overflow and show only one fragment.
  const markup = preview.outerHTML
  if (markup.length <= 200_000) return markup
  // Do not turn a valid SVG into an empty picker just because inlining its
  // rendered styles exceeded the bridge message budget.
  return originalMarkup.length <= 200_000 ? originalMarkup : null
}

// Feature discovery remains independent of the selected DOM layer. Editing
// still targets one unique source owner, whose CSS variables can feed its subtree.
function dynamicRegistration(el: HTMLElement): string | null {
  if (!dynamicControlsEnabled || el.getAttribute(DYNAMIC_CONTROLS_SOURCE_ATTRIBUTE) !== 'true'
    || el.getAttribute('data-oid-shared') === 'true' || el.hasAttribute('data-oid-component')) return null
  const oid = el.getAttribute('data-oid')
  const raw = el.getAttribute(DYNAMIC_CONTROLS_ATTRIBUTE)
  return oid && findOidNodes(oid).length === 1 && parseDynamicControls(raw) ? raw : null
}

let dynamicFeatureObserver: MutationObserver | null = null
function syncDynamicFeatureObserver(): void {
  dynamicFeatureObserver?.disconnect()
  dynamicFeatureObserver = null
  if (!dynamicControlsEnabled) return
  dynamicFeatureObserver = new MutationObserver(() => publishDynamicFeatures())
  dynamicFeatureObserver.observe(document.documentElement, { subtree: true, attributes: true,
    attributeFilter: [DYNAMIC_CONTROLS_ATTRIBUTE, DYNAMIC_CONTROLS_SOURCE_ATTRIBUTE, 'data-oid'] })
}
let lastDynamicFeatures = ''
function publishDynamicFeatures(force = false): void {
  if (!dynamicControlsEnabled) return
  const features: Array<{ oid: string; registration: string }> = []
  const nodes = document.querySelectorAll<HTMLElement>('[' + DYNAMIC_CONTROLS_SOURCE_ATTRIBUTE + '="true"][' + DYNAMIC_CONTROLS_ATTRIBUTE + '][data-oid]')
  let truncated = false
  for (const node of nodes) {
    const registration = dynamicRegistration(node)
    const oid = node.getAttribute('data-oid')
    if (!oid || !registration) continue
    if (features.length === DYNAMIC_FEATURE_LIMIT) { truncated = true; break }
    features.push({ oid, registration })
  }
  const serialized = JSON.stringify({ features, truncated })
  if (!force && serialized === lastDynamicFeatures) return
  lastDynamicFeatures = serialized
  post({ source: 'mercury-bridge', type: 'dynamic-features', features, truncated })
}

function extractProps(el: HTMLElement): BridgeProps {
  // Computed once: both the instance path and the per-site ordinal/count are
  // derived from it, and computeSiteLocalCounts walks every same-oid node, so
  // recomputing it per field was quadratic on a page with many copies.
  const instancePathForEl = computeReactInstancePath(el)
  const siteLocal = computeSiteLocalCounts(el, el.getAttribute('data-oid'), instancePathForEl)
  const ancestorContext = extractAncestorContext(el)
  const oid = el.getAttribute('data-oid')
  let instanceCount = 1
  // Default 0 covers the "only instance" case and is a safe no-op for
  // backend per-instance edits (idx === 0 still targets exactly the
  // single rendered element).
  let instanceIndex = 0
  if (oid) {
    try {
      // Resolve through the canonical enumeration rather than a local copy:
      // an earlier version filtered deleted nodes here only, so the index this
      // reported drifted one ahead of the node findOidNodes returned for it the
      // moment any instance was hidden.
      const matches = findOidNodes(oid)
      instanceCount = matches.length || 1
      // Walk the NodeList to find which entry is the clicked element. We
      // deliberately use identity comparison (===) rather than matching
      // by bounding rect / textContent because:
      //   - Two .map()'d elements can have identical text ("Buy" buttons).
      //   - Their bounding rects are different, but a text search would
      //     hit the first one every time, making per-instance edits
      //     land on the wrong row.
      for (let i = 0; i < matches.length; i++) {
        if (matches[i] === el) {
          instanceIndex = i
          break
        }
      }
    } catch {
      instanceCount = 1
      instanceIndex = 0
    }
  }
  // Walk only direct children to compute (a) whether any non-text element
  // is nested inside, and (b) the concatenated direct text. Comments are
  // ignored. Element nodes — including Mercury's own injected overlays —
  // count as non-text children. The overlays live on documentElement, not
  // inside content nodes, so they won't affect this check.
  let hasNonTextChildren = false
  let directTextBuf = ''
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i]
    if (child.nodeType === 1 /* ELEMENT_NODE */) {
      hasNonTextChildren = true
    } else if (child.nodeType === 3 /* TEXT_NODE */) {
      directTextBuf += child.nodeValue || ''
    }
  }
  // We use trim() ONLY to decide "is there any meaningful direct text?";
  // the value we ship is the original (non-trimmed) string so the panel's
  // textarea round-trips trailing whitespace the user may have intended.
  // null means "no direct text"; '' would be ambiguous with "has direct
  // text consisting only of whitespace", which we want to treat as null.
  const hasMeaningfulDirectText = directTextBuf.trim().length > 0
  // directText is the slice the panel's Text editor binds to and rewrites
  // on commit, so we intentionally use a much higher cap than textContent
  // (which is only used for preview/aggregate context, 200 chars is fine).
  // 10 KB is well past realistic inline-JSX text sizes while still
  // bounding a pathological <pre> buried under a <p>. When the direct
  // text exceeds the cap we ship directText: null plus
  // directTextTruncated: true (see BridgeProps) rather than a sliced
  // prefix — a partial textarea bind would let a Save silently persist
  // the truncation, destroying the back half of the user's content in
  // both the optimistic DOM mutation and the source-of-truth JSX edit.
  const MAX_DIRECT_TEXT_CHARS = 10000
  const isDirectTextTruncated =
    hasMeaningfulDirectText && directTextBuf.length > MAX_DIRECT_TEXT_CHARS
  const directTextSegments = isDirectTextTruncated ? [] : readDirectTextSegments(el)
  const semanticStateVariant = selectedStateVariant(el)
  const svgExtractionContext = createSvgExtractionContext(el)
  const svgColorFacts = extractSvgColorFacts(el, svgExtractionContext)
  const svgPreviewMarkup = extractSvgPreviewMarkup(el, svgExtractionContext)
  const availableTypography = extractAvailableTypography(el)
  return {
    routePath: appRelativePath(location.pathname),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    tagName: el.tagName.toLowerCase(),
    className: el.getAttribute('class'),
    attributes: extractAttributes(el),
    dynamicControls: dynamicRegistration(el),
    oidAttributes: extractOidAttributes(el),
    instanceLocator: extractInstanceLocator(el),
    rect: extractRect(el),
    domContext: extractDomContext(el),
    textContent: (el.textContent || '').slice(0, 200),
    ancestorContext,
    hasNonTextChildren,
    directText:
      hasMeaningfulDirectText && !isDirectTextTruncated ? directTextBuf : null,
    directTextSegments,
    directTextStructure:
      directTextSegments.length > 0 ? readDirectTextStructure(el) : null,
    textSourceStructure: el.getAttribute('data-oid-text-source'),
    directTextTruncated: isDirectTextTruncated,
    styleText: el.getAttribute('style'),
    computedStyle: extractComputedStyle(el),
    semanticStateActive: semanticStateVariant !== null,
    semanticStateVariant,
    // True when the OID stamper marked this JSX node as emitted inside a
    // loop callback (data-oid-shared="true"). We also fall back to
    // instanceCount > 1 so reused components keep showing the
    // multi-instance warning UX in the panel until the new stamper
    // rolls out everywhere; the edit-routing decision still gates on the
    // explicit attribute via the panel-side isSharedSelection check.
    isShared: el.getAttribute('data-oid-shared') === 'true' || instanceCount > 1,
    isLoopShared: el.getAttribute('data-oid-shared') === 'true',
    // Stamped server-side from the edit pipeline's own predicates: true only
    // when a single rendered instance can provably be targeted. Absent (older
    // bundles) reads as false so the panel fails closed.
    instanceTargetable: el.getAttribute('data-oid-instance-targetable') === 'true',
    // True when deleting this element would blank its whole component.
    isComponentRoot: el.getAttribute('data-oid-component-root') === 'true',
    callSiteDeletable: el.getAttribute('data-oid-callsite-deletable') === 'true',
    callSiteEditable: el.getAttribute('data-oid-callsite-editable') === 'true',
    callSiteRequiresSingleInstance: el.getAttribute('data-oid-callsite-single') === 'true',
    instanceCount,
    instanceIndex,
    // The OID stamper emits data-oid-text-editable="false" for text-source
    // shapes the panel cannot safely map to a single string edit (mixed
    // text+binding, multiple bindings, spread). Absence means "editable".
    textEditable: el.getAttribute('data-oid-text-editable') !== 'false',
    dynamicStyleKeys: (el.getAttribute('data-oid-style-dynamic') || '').split(',').filter(Boolean),
    classNameDynamic: el.getAttribute('data-oid-classname-dynamic') === 'true',
    ...svgColorFacts,
    supportsInlineSvgReplacement: el.tagName.toLowerCase() === 'svg',
    svgPreviewMarkup,
    ...availableTypography,
    resolvedBackgroundColor: extractResolvedBackgroundColor(el),
    // Shared identity of the component this node was rendered from, present
    // only when PascalCase call-site stamping is on. data-oid addresses this
    // one instance; this addresses every instance of the component, which is
    // what group edit targets. Null → no component-level target, so the panel
    // must not offer group edit.
    componentOid: el.getAttribute('data-oid-component'),
    // Capability tokens proven for this element's call site, e.g.
    // ['class','style','text']. Null means "ordinary DOM element" — the panel
    // then behaves exactly as before. A non-null list is exhaustive: anything
    // absent from it was NOT proven and must not be offered.
    editableCapabilities: readCapabilityTokens(el),
    // Slow-tier identification. Consumed by planCallSiteTarget and the frontend
    // delete gate -- see the contract note above FIBER_KEY_PREFIXES.
    instancePath: instancePathForEl,
    siteLocalIndex: siteLocal ? siteLocal.index : null,
    // How many nodes this ONE call site rendered. A non-loop site renders one per
    // render of its owner, so above one means the owner is duplicated and no
    // single instance can be named -- which the ordinal alone cannot express,
    // since the first of three reads 0 just as the only one of one does.
    siteLocalCount: siteLocal ? siteLocal.count : null,
  }
}

class DomEvidenceManager {
  capture(el: HTMLElement): BridgeProps {
    return extractProps(el)
  }
}

const domEvidenceManager = new DomEvidenceManager()

function readCapabilityTokens(el: HTMLElement): string[] | null {
  const raw = el.getAttribute('data-oid-caps')
  if (raw == null) return null
  const tokens = raw
    .split(',')
    .map(function (token) { return token.trim() })
    .filter(function (token) { return token.length > 0 })
  // An empty attribute means "proven, but nothing is editable" — distinct from
  // absent, which means "not a gated call site at all".
  return tokens
}

function truthyAttr(el: HTMLElement, name: string): boolean {
  const value = el.getAttribute(name)
  if (value == null) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== 'false'
}

function safeVariantValue(value: string | null): string | null {
  const normalized = (value || '').trim()
  return /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : null
}

function selectedAriaCurrentVariant(value: string | null): string | null {
  const normalized = safeVariantValue(value)?.toLowerCase() ?? null
  if (
    normalized === 'page' ||
    normalized === 'step' ||
    normalized === 'location' ||
    normalized === 'date' ||
    normalized === 'time' ||
    normalized === 'true'
  ) {
    return normalized
  }
  return null
}

function selectedStateVariant(el: HTMLElement): string | null {
  const ariaSelected = el.getAttribute('aria-selected') === 'true'
  const ariaPressed = el.getAttribute('aria-pressed') === 'true'
  const ariaChecked = el.getAttribute('aria-checked') === 'true'
  const ariaCurrent = selectedAriaCurrentVariant(el.getAttribute('aria-current'))
  const dataSelected = truthyAttr(el, 'data-selected')
  const dataActive = truthyAttr(el, 'data-active')
  const dataChecked = truthyAttr(el, 'data-checked')
  const dataPressed = truthyAttr(el, 'data-pressed')
  const dataState = safeVariantValue(el.getAttribute('data-state'))?.toLowerCase() ?? null
  if (ariaSelected) return 'aria-selected'
  if (ariaPressed) return 'aria-pressed'
  if (ariaChecked) return 'aria-checked'
  if (ariaCurrent) return 'aria-[current=' + ariaCurrent + ']'
  if (dataState === 'active' || dataState === 'selected' || dataState === 'checked' || dataState === 'on') {
    return 'data-[state=' + dataState + ']'
  }
  if (dataSelected) return 'data-[selected]'
  if (dataActive) return 'data-[active]'
  if (dataChecked) return 'data-[checked]'
  if (dataPressed) return 'data-[pressed]'
  return null
}

// ---------------------------------------------------------------------------
// Slow-tier instance identification (React Fiber).
//
// Source location alone cannot distinguish two rendered copies that come from
// the same JSX. The per-instance AST rewrite handles the .map() case by keying
// on the loop index, but there is a shape it structurally cannot reach: a
// <Toolbar> containing one <Button>, used three times. Three buttons on screen,
// one call site, no loop to key on. Nothing in the source distinguishes them.
//
// React does know. Every DOM node it renders carries a __reactFiber$… back-link,
// and walking the fiber's return chain yields the actual render ancestry —
// which Toolbar this Button came from. That answer only exists at runtime.
//
// This computes that path and ships it with the selection.
//
// CONTRACT, and it is no longer advisory-only. It was when this landed; it is
// not now. instancePath and the siteLocalIndex derived from it are consumed
// by planCallSiteTarget to choose between several call sites, and by the
// frontend delete gate in use-selected-element-delete.ts. Treat a change here
// as changing which instance an edit lands on.
//
// What this depends on is PRIVATE React internals: the __reactFiber$…
// property, and the fiber fields return, index, key, type and
// elementType. None of these are public API and none carry a compatibility
// guarantee. Generated projects pin React 19 (see the e2b template), which is
// the version the contract is pinned against by the compatibility test in
// apps/web/src/services/iframe-bridge/__tests__/react-fiber-contract.test.tsx.
//
// It fails CLOSED, and that is the property to preserve. If React stops exposing
// the property, fiberFromNode returns null, computeReactInstancePath returns
// null, and every consumer refuses rather than guessing:
//   - siteLocalIndex becomes null, so the planner takes its file-scoped
//     fallback and refuses outright when more than one call site could match
//   - the frontend delete gate requires instancePath, so delete is disabled
// A React upgrade therefore withdraws per-instance editing; it does not silently
// select the wrong call site. Any change to this code must keep that true —
// returning a PARTIAL path would break it, which is why every failure path here
// returns null rather than what it managed to collect.
//
// Deliberately positional rather than name-based. Component names survive in the
// dev server but are mangled by the production build, so a readable name is only
// sometimes available; child index within the parent fiber is stable in both.
// Names are included when present purely to make the path readable in logs.
// ---------------------------------------------------------------------------

const FIBER_KEY_PREFIXES = ['__reactFiber$', '__reactInternalInstance$']
const INSTANCE_PATH_MAX_DEPTH = 40

type MinimalFiber = {
  return?: MinimalFiber | null
  index?: number
  key?: string | null
  type?: unknown
  elementType?: unknown
}

function fiberFromNode(el: Element): MinimalFiber | null {
  try {
    for (const key of Object.keys(el)) {
      for (const prefix of FIBER_KEY_PREFIXES) {
        if (key.startsWith(prefix)) {
          return (el as unknown as Record<string, MinimalFiber>)[key] ?? null
        }
      }
    }
  } catch {
    return null
  }
  return null
}

function fiberDisplayName(fiber: MinimalFiber): string | null {
  const candidate = fiber.type ?? fiber.elementType
  if (typeof candidate === 'string') return candidate
  if (typeof candidate === 'function') {
    const fn = candidate as { displayName?: string; name?: string }
    return fn.displayName || fn.name || null
  }
  if (candidate && typeof candidate === 'object') {
    const obj = candidate as { displayName?: string; render?: { name?: string } }
    return obj.displayName || obj.render?.name || null
  }
  return null
}

/**
 * Stable-ish identifier for *this rendered instance*, independent of source
 * location. Shape: "App/Toolbar:1/Button:0", root first.
 *
 * Returns null when React internals are unavailable (non-React page, or a React
 * build that stopped exposing the property). Null is the fail-closed signal: it
 * must never be substituted with a partial or guessed path, because consumers
 * cannot tell a wrong path from a right one. See the contract note above the
 * FIBER_KEY_PREFIXES declaration for what now depends on this.
 */
function computeReactInstancePath(el: Element): string | null {
  const start = fiberFromNode(el)
  if (!start) return null

  const segments: string[] = []
  let current: MinimalFiber | null | undefined = start
  let depth = 0
  try {
    while (current && depth < INSTANCE_PATH_MAX_DEPTH) {
      const name = fiberDisplayName(current)
      // Host fibers (plain div/span) add noise without adding identity; the
      // component boundaries are what disambiguate one Toolbar from another.
      if (name && /^[A-Z]/.test(name)) {
        // A React key is authored identity and beats positional index, which
        // shifts when siblings are added or reordered.
        const discriminator = current.key != null && current.key !== ''
          ? 'k' + current.key
          : String(current.index ?? 0)
        segments.push(name + ':' + discriminator)
      }
      current = current.return
      depth += 1
    }
  } catch {
    return null
  }

  if (segments.length === 0) return null
  return segments.reverse().join('/')
}

/**
 * Ordinal of this node among the nodes its OWN call site rendered.
 *
 * instanceIndex counts every node carrying the oid, in document order. That is
 * what a single-call-site component needs, and it is wrong the moment a second
 * site renders: with primary.map before secondary.map, secondary's first card
 * reads as index 2 while its callback passes 0, so a conditional keyed on the
 * loop index never matches it. Reducing one to the other needs the node counts of
 * the earlier sites -- runtime collection lengths, which the server cannot know.
 *
 * The runtime can, though. Nodes rendered by one call site share an ancestor
 * component chain; only their own position differs. Dropping the last segment's
 * discriminator leaves a key equal for exactly those nodes, so counting within a
 * key yields the per-site ordinal the server needs:
 *
 *   Page:0/Primary:0/Card:0   -> Page:0/Primary:0/Card     ordinal 0
 *   Page:0/Primary:0/Card:1   -> Page:0/Primary:0/Card     ordinal 1
 *   Page:0/Secondary:1/Card:0 -> Page:0/Secondary:1/Card   ordinal 0  (restarts)
 *
 * Null whenever the path is unavailable, or any same-oid node lacks one: a
 * partial count is worse than none, because a count taken over a subset of the
 * nodes is indistinguishable from a correct one. Null makes the planner fall
 * back to its file-scoped rule, which refuses when the answer is ambiguous.
 */
function sitePathKey(instancePath: string): string {
  // EVERY discriminator is dropped, not just the last one.
  //
  // Nodes rendered by one call site share the chain of component NAMES above
  // them; what differs is the position of whichever ancestor the loop wraps. When
  // the loop is above the component -- items.map(item => <Box key={item}><Card/></Box>)
  // -- that ancestor is Box, so the paths read .../Box:kNova/Card:0 and
  // .../Box:kEmber/Card:0. Stripping only the last discriminator left those keys
  // different, so every node was alone in its group and every ordinal came back
  // 0: the first card was editable and the rest silently reused its branch.
  //
  // Stripping all of them groups exactly the nodes one site produced, and their
  // document order is the iteration. Sibling call sites in one parent also share
  // the key -- deliberately, since the server's sibling and owner-ordinal paths
  // both want a position among them.
  const parts = instancePath.split('/')
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string
    const cut = part.indexOf(':')
    if (cut >= 0) parts[i] = part.slice(0, cut)
  }
  return parts.join('/')
}

function siteLocalIndexIsRecoverable(paths: string[]): boolean {
  // Exactly ONE segment position may vary across the group. That position is the
  // loop, and a node's rank within the group is its iteration.
  //
  // Two or more varying positions means something above the loop is repeated too
  // -- App renders <Panel/><Panel/> and Panel maps its items -- and the product
  // of the two cannot be reduced to one iteration. Ranking the group anyway
  // yielded 0,1,2,3 for cards whose own loop index was 0,1, so the server keyed
  // the edit on an iteration no card had. Refusing is the only safe answer; a
  // correct one needs an address that names the call site and the loop position
  // separately rather than a single ordinal.
  if (paths.length < 2) return true
  const columns = paths[0].split('/').length
  let varying = 0
  for (let i = 0; i < columns; i++) {
    const seen: Record<string, true> = {}
    let distinct = 0
    for (let j = 0; j < paths.length; j++) {
      const segment = paths[j].split('/')[i]
      if (segment === undefined) return false
      const cut = segment.indexOf(':')
      const disc = cut >= 0 ? segment.slice(cut + 1) : ''
      if (!seen[disc]) { seen[disc] = true; distinct++ }
    }
    if (distinct > 1) varying++
    if (varying > 1) return false
  }
  return true
}

/**
 * This node's ordinal among its own call site's nodes, AND how many there are.
 *
 * The count is not decoration. A non-loop call site renders one node per render
 * of its OWNER, so a count above one means the owner is duplicated -- one
 * <Chip/> inside <Toolbar>, three <Toolbar>s. The ordinal alone cannot say that:
 * the first of three reads 0, exactly as the only one of one does, and the
 * planner accepted index 0 on the strength of that. It then wrote a condition at
 * the single call site, which every one of the three instances satisfies, so the
 * edit hit all of them. Reporting the count lets the planner tell the two apart.
 */
function computeSiteLocalCounts(
  el: Element,
  oid: string | null,
  instancePath: string | null,
): { index: number; count: number } | null {
  if (!oid || !instancePath) return null
  // findOidNodes, not a raw query: it is the single source for oid lookups and it
  // drops optimistically-deleted nodes, so this ordinal counts SURVIVORS -- the
  // same semantics every other index in the payload uses.
  const matches = findOidNodes(oid)
  const key = sitePathKey(instancePath)
  const group: string[] = []
  let ordinal: number | null = null
  for (let i = 0; i < matches.length; i++) {
    const node = matches[i]
    const otherPath = node === el ? instancePath : computeReactInstancePath(node)
    // One unreadable sibling makes the whole count untrustworthy.
    if (otherPath === null) return null
    if (sitePathKey(otherPath) !== key) continue
    if (node === el) ordinal = group.length
    group.push(otherPath)
  }
  if (ordinal === null) return null
  if (!siteLocalIndexIsRecoverable(group)) return null
  return { index: ordinal, count: group.length }
}

function isInteractiveInspectTarget(node: HTMLElement): boolean {
  const tagName = node.tagName.toLowerCase()
  if (
    tagName === 'button' ||
    tagName === 'a' ||
    tagName === 'input' ||
    tagName === 'select' ||
    tagName === 'textarea' ||
    tagName === 'summary'
  ) return true
  const role = node.getAttribute('role')
  if (role === 'button' || role === 'link' || role === 'menuitem' || role === 'option' || role === 'tab') return true
  if (node.tabIndex >= 0 || node.hasAttribute('onclick')) return true
  const className = typeof node.className === 'string' ? node.className : ''
  if (/(?:^|\s)cursor-pointer(?:\s|$)/.test(className) || node.style.cursor === 'pointer') return true
  try {
    const reactPropsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'))
    const reactProps = reactPropsKey
      ? (node as unknown as Record<string, unknown>)[reactPropsKey]
      : null
    if (reactProps && typeof reactProps === 'object') {
      const props = reactProps as Record<string, unknown>
      return typeof props.onClick === 'function' ||
        typeof props.onPointerDown === 'function' ||
        typeof props.onMouseDown === 'function' ||
        typeof props.onKeyDown === 'function'
    }
  } catch { /* noop */ }
  return false
}

const SVG_NAMESPACE_URI = 'http://www.w3.org/2000/svg'

type SvgInspectElement = HTMLElement & {
  ownerSVGElement?: SvgInspectElement | null
}

function findSvgVisualRoot(start: EventTarget | null): HTMLElement | null {
  const element = start as SvgInspectElement | null
  if (!element || element.nodeType !== 1 || element.namespaceURI !== SVG_NAMESPACE_URI) return null
  return element.tagName.toLowerCase() === 'svg'
    ? element
    : element.ownerSVGElement ?? null
}

/**
 * Runtime namespace is the only reliable way to distinguish an extracted SVG
 * <a>/<title>/<style>/<script> from the same tag rendered as HTML. Normalize
 * authored SVG descendants to the outer stamped SVG; HTML descendants of a
 * foreignObject use the HTML namespace and deliberately bypass this rule.
 */
function findStampedSvgRoot(start: EventTarget | null): HTMLElement | null {
  let svg = findSvgVisualRoot(start) as SvgInspectElement | null
  while (svg?.ownerSVGElement) svg = svg.ownerSVGElement
  return svg?.hasAttribute('data-oid') ? svg : null
}

/**
 * Resolve a pointer hit to the deepest stamped element under it.
 *
 * One rule for every container, clickable or not. The event target is already
 * the deepest painted node, so its nearest stamped ancestor is the deepest
 * stamped element: identical content is equally selectable in a paragraph and
 * in a clickable card. Selecting a container itself -- a button, a card, a
 * section -- is Shift+Enter (parent) or the Layers panel.
 *
 * Known limit: a wrapper chain with coincident bounds
 * (section > div.mx-auto > div.grid > div) lands on the innermost stamped box,
 * which can be an unpainted layout wrapper rather than the box the user means.
 * Shift+Enter walks out of it.
 *
 * Comment mode promotes instead: see findCommentOidTarget.
 */
function findOidTarget(start: EventTarget | null): HTMLElement | null {
  // Icons stay atomic: an inner <path> hit normalizes to the stamped <svg>.
  const svgRoot = findStampedSvgRoot(start)
  if (svgRoot) return svgRoot

  let node: HTMLElement | null = start as HTMLElement | null
  while (node && node !== document.body) {
    if (node.hasAttribute && node.hasAttribute('data-oid')) return node
    node = node.parentElement
  }
  return null
}

/**
 * Resolve a comment hit, promoting to the interactive control that owns it.
 *
 * The two modes want different things, which is why this is not findOidTarget.
 * Inspect resolves what the user is about to EDIT, and an over-wide landing is
 * free to correct: the outline shows it before anything is committed, and
 * Shift+Enter or the Layers panel moves off it. A comment resolves what the
 * user is TALKING ABOUT, is placed in one gesture with no walk out of it, and
 * hands that element to the agent as the thing to change. A pin dropped on a
 * CTA's label should ask the agent to restyle the button, not the span inside.
 *
 * The audit states the same split: comment mode has its own targeting and
 * anchoring requirements (docs/architecture/inspect-edit-hit-testing-audit.md).
 */
function findCommentOidTarget(start: EventTarget | null): HTMLElement | null {
  const svgRoot = findStampedSvgRoot(start)
  if (svgRoot) return svgRoot

  let node: HTMLElement | null = start as HTMLElement | null
  let nearestOidTarget: HTMLElement | null = null
  while (node && node !== document.body) {
    if (node.hasAttribute && node.hasAttribute('data-oid')) {
      if (!nearestOidTarget) nearestOidTarget = node
      if (isInteractiveInspectTarget(node)) return node
    }
    node = node.parentElement
  }
  return nearestOidTarget
}

function isDecorativeMediaCover(node: HTMLElement): boolean {
  if (
    (node.tagName !== 'DIV' && node.tagName !== 'SPAN') ||
    node.childElementCount !== 0 ||
    Boolean(node.textContent?.trim()) ||
    node.getAttributeNames().some((name) =>
      name === 'role' ||
      name === 'title' ||
      name === 'contenteditable' ||
      name === 'tabindex' ||
      name.startsWith('aria-') ||
      name.startsWith('on')
    ) ||
    isInteractiveInspectTarget(node)
  ) return false
  try {
    const propsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'))
    const props = propsKey ? (node as unknown as Record<string, unknown>)[propsKey] : null
    if (props && typeof props === 'object') {
      return !Object.entries(props).some(([name, value]) => name.startsWith('on') && typeof value === 'function')
    }
  } catch { /* noop */ }
  return true
}

function findInspectTargetAtPoint(
  start: EventTarget | null,
  clientX: number,
  clientY: number,
  drillDown = false,
): HTMLElement | null {
  const overlay = start as HTMLElement | null
  const oidTarget = findOidTarget(start)
  // A stamped cover always resolves to itself, since the walk stops at the
  // deepest stamped node, so hover, click and double-click all reach this
  // branch alike and no drillDown clause is needed to let the last one in.
  // (drillDown still decides the deeper drill at the end of this function.)
  if (
    oidTarget === overlay &&
    overlay?.nodeType === 1 &&
    overlay.hasAttribute('data-oid') &&
    isDecorativeMediaCover(overlay)
  ) {
    const position = getComputedStyle(overlay).position
    if (position === 'absolute' || position === 'fixed') {
      const stack = document.elementsFromPoint(clientX, clientY)
      const overlayIndex = stack.indexOf(overlay)
      const overlayRect = overlay.getBoundingClientRect()
      if (overlayIndex >= 0) {
        for (let i = overlayIndex + 1; i < stack.length; i += 1) {
          const media = stack[i] as HTMLElement
          if (!media.hasAttribute('data-oid')) continue
          if (media.tagName === 'IMG' || media.tagName === 'VIDEO') {
            const mediaRect = media.getBoundingClientRect()
            const coveredWidth = Math.max(0, Math.min(overlayRect.right, mediaRect.right) - Math.max(overlayRect.left, mediaRect.left))
            const coveredHeight = Math.max(0, Math.min(overlayRect.bottom, mediaRect.bottom) - Math.max(overlayRect.top, mediaRect.top))
            const coveredArea = coveredWidth * coveredHeight
            const mediaArea = mediaRect.width * mediaRect.height
            const overlayArea = overlayRect.width * overlayRect.height
            if (
              mediaArea > 0 &&
              overlayArea > 0 &&
              coveredArea >= mediaArea * 0.9 &&
              coveredArea >= overlayArea * 0.9
            ) return media
          }
          break
        }
      }
    }
  }
  return drillDown ? findDeepestOidTargetAtPoint(clientX, clientY) : oidTarget
}

function normalizeInspectCandidates(nodes: readonly HTMLElement[]): HTMLElement[] {
  const normalized = new Set<HTMLElement>()
  for (const node of nodes) normalized.add(findStampedSvgRoot(node) ?? node)
  return [...normalized]
}

function inspectDomDepth(node: HTMLElement): number {
  let depth = 0
  let current: HTMLElement | null = node
  while (current && current !== document.body) {
    depth += 1
    current = current.parentElement
  }
  return depth
}

function resolveInspectPointFromFractions(
  fractionX: unknown,
  fractionY: unknown,
) {
  // Validate both coordinates are finite numbers within 0..1. The parent's
  // client pixels are scaled by canvas zoom and the frame's device preset,
  // so only this document can convert a normalized point into its own
  // client coordinates.
  if (
    typeof fractionX !== 'number' ||
    typeof fractionY !== 'number' ||
    !Number.isFinite(fractionX) ||
    !Number.isFinite(fractionY) ||
    fractionX < 0 ||
    fractionX > 1 ||
    fractionY < 0 ||
    fractionY > 1
  ) {
    return null
  }
  // Clamp to the last addressable pixel so a click on the frame's exact
  // right/bottom edge still resolves an element instead of silently hitting
  // nothing outside the viewport.
  const x = Math.min(fractionX * window.innerWidth, window.innerWidth - 1)
  const y = Math.min(fractionY * window.innerHeight, window.innerHeight - 1)
  return { x, y }
}

const INSPECT_TRAVERSAL_MAX_NODES = 750
const INSPECT_TRAVERSAL_MAX_DEPTH = 60
const INSPECT_TRAVERSAL_MAX_MS = 8

type InspectTraversalBudget = {
  visited: number
  deadlineAt: number
  exhausted: boolean
  hiddenCache: Map<HTMLElement, boolean>
}

function createInspectTraversalBudget(): InspectTraversalBudget {
  return {
    visited: 0,
    deadlineAt: Date.now() + INSPECT_TRAVERSAL_MAX_MS,
    exhausted: false,
    hiddenCache: new Map(),
  }
}

function consumeInspectTraversalNode(budget: InspectTraversalBudget, depth: number): boolean {
  if (
    budget.exhausted ||
    budget.visited >= INSPECT_TRAVERSAL_MAX_NODES ||
    depth > INSPECT_TRAVERSAL_MAX_DEPTH ||
    Date.now() > budget.deadlineAt
  ) {
    budget.exhausted = true
    return false
  }
  budget.visited += 1
  return true
}

function isInspectSubtreeHidden(
  node: HTMLElement,
  budget?: InspectTraversalBudget,
): boolean {
  if (node.closest('[data-mercury-overlay]')) return true
  const cached = budget?.hiddenCache.get(node)
  if (cached !== undefined) return cached
  const visited: HTMLElement[] = []
  let current: HTMLElement | null = node
  let depth = 0
  let hidden = false
  while (current) {
    const currentCached = budget?.hiddenCache.get(current)
    if (currentCached !== undefined) {
      hidden = currentCached
      break
    }
    if (budget && depth > INSPECT_TRAVERSAL_MAX_DEPTH) {
      budget.exhausted = true
      hidden = true
      break
    }
    visited.push(current)
    const style = getComputedStyle(current)
    const opacity = Number.parseFloat(style.opacity)
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      (Number.isFinite(opacity) && opacity <= 0)
    ) {
      hidden = true
      break
    }
    current = current.parentElement
    depth += 1
  }
  if (budget) {
    for (const visitedNode of visited) budget.hiddenCache.set(visitedNode, hidden)
  }
  return hidden
}

function isRenderedInspectCandidate(
  node: HTMLElement,
  budget?: InspectTraversalBudget,
): boolean {
  if (node.closest('[data-mercury-overlay]')) return false
  const rect = node.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  return !isInspectSubtreeHidden(node, budget)
}

function isVisibleInspectCandidate(node: HTMLElement, clientX: number, clientY: number): boolean {
  if (!isRenderedInspectCandidate(node)) return false
  const rect = node.getBoundingClientRect()
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
}

/**
 * Double-click drill-down cannot rely on event.target: the browser omits
 * pointer-transparent elements from hit-testing. Instead, inspect the stamped
 * visual layers whose rectangles contain the pointer and choose the deepest,
 * smallest authored surface. This also reaches overlapping siblings such as
 * an absolute pointer-events:none icon drawn over an input.
 */
function findDeepestOidTargetAtPoint(clientX: number, clientY: number): HTMLElement | null {
  const candidates = normalizeInspectCandidates(
    Array.from(document.querySelectorAll<HTMLElement>('[data-oid]')),
  )
    .filter((node) => isVisibleInspectCandidate(node, clientX, clientY))
  candidates.sort((left, right) => {
    if (left.contains(right)) return 1
    if (right.contains(left)) return -1
    const leftRect = left.getBoundingClientRect()
    const rightRect = right.getBoundingClientRect()
    const areaDelta = leftRect.width * leftRect.height - rightRect.width * rightRect.height
    if (areaDelta !== 0) return areaDelta
    const depthDelta = inspectDomDepth(right) - inspectDomDepth(left)
    if (depthDelta !== 0) return depthDelta
    return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1
  })
  return candidates[0] ?? null
}

function distanceSquaredToInspectRect(node: HTMLElement, clientX: number, clientY: number): number {
  const rect = node.getBoundingClientRect()
  const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0
  const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0
  return dx * dx + dy * dy
}

function findNearestDeepestOidDescendant(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const candidates = normalizeInspectCandidates(
    Array.from(root.querySelectorAll<HTMLElement>('[data-oid]')),
  )
    .filter((node) => node !== root)
    .filter((node) => isRenderedInspectCandidate(node))
  candidates.sort((left, right) => {
    const distanceDelta = distanceSquaredToInspectRect(left, clientX, clientY) -
      distanceSquaredToInspectRect(right, clientX, clientY)
    if (distanceDelta !== 0) return distanceDelta
    const depthDelta = inspectDomDepth(right) - inspectDomDepth(left)
    if (depthDelta !== 0) return depthDelta
    const leftRect = left.getBoundingClientRect()
    const rightRect = right.getBoundingClientRect()
    return leftRect.width * leftRect.height - rightRect.width * rightRect.height
  })
  return candidates[0] ?? null
}

const COMMENT_VISUAL_TARGET_TAGS = new Set([
  'IMG',
  'VIDEO',
  'AUDIO',
  'CANVAS',
  'OBJECT',
  'EMBED',
  'IFRAME',
])

function findCommentVisualTarget(start: EventTarget | null, oidTarget: HTMLElement): HTMLElement {
  const element = start as HTMLElement | null
  if (!element || element.nodeType !== 1) return oidTarget

  if (element.namespaceURI === SVG_NAMESPACE_URI) {
    return findStampedSvgRoot(element) ?? findSvgVisualRoot(element) ?? oidTarget
  }

  return COMMENT_VISUAL_TARGET_TAGS.has(element.tagName) ? element : oidTarget
}

function findCommentTarget(start: EventTarget | null): { element: HTMLElement; oidTarget: HTMLElement } | null {
  const oidTarget = findCommentOidTarget(start)
  if (!oidTarget) return null
  const element = findCommentVisualTarget(start, oidTarget)
  return { element, oidTarget: findCommentOidTarget(element) ?? oidTarget }
}

function formatTargetLabel(target: HTMLElement): string {
  const tagName = (target.tagName || 'element').toLowerCase()
  if (tagName === 'input') {
    // The IDL property, not the attribute: it carries HTML's own resolution, so
    // it names the control actually on the page. <input type=" image "> is not
    // parseable and paints a plain text field, and .type says so.
    return (target as HTMLInputElement).type === 'image' ? 'Image' : 'Div'
  }
  return DIRECT_EDIT_ELEMENT_CATEGORY_BY_TAG[tagName] ?? 'Div'
}

/**
 * The outline carries no transition, because every way it moves wants to be
 * instant:
 *
 * - Between elements (onPointerMove and the hover-at-point message both call
 *   positionOverlay only when the target changed) the move is a jump, and
 *   animating it glides the outline across the page -- worst between an icon
 *   and the card that owns it, where a 16px box and a 300px box are
 *   consecutive targets and each crossing sweeps the whole card.
 * - Within one element (schedulePositionSync, once per frame during scroll,
 *   resize and layout settle) a tween trails the element it is tracking.
 *
 * The label pill and the selection bound carry none either, so an animated
 * outline would also be the one adornment arriving late beside the rest.
 */
function ensureHoverOutline(): HTMLElement {
  if (hoverOutlineEl) return hoverOutlineEl
  const el = document.createElement('div')
  el.setAttribute('data-mercury-overlay', 'hover')
  el.style.position = 'fixed'
  el.style.pointerEvents = 'none'
  el.style.zIndex = '2147483646'
  el.style.boxSizing = 'border-box'
  el.style.border = '1px solid #3b63fb'
  el.style.background = 'transparent'
  el.style.borderRadius = '2px'
  el.style.display = 'none'
  document.documentElement.appendChild(el)
  hoverOutlineEl = el
  return el
}

function styleOverlayLabel(el: HTMLElement): void {
  // One pill for both states: the spec draws the same 24px Adobe Clean badge whether the
  // element is pre-selected or selected, so hover must not fall back to a monospace chip.
  el.style.position = 'fixed'
  el.style.pointerEvents = 'none'
  el.style.zIndex = '2147483647'
  el.style.display = 'none'
  el.style.boxSizing = 'border-box'
  el.style.height = '24px'
  el.style.padding = '3px 10px'
  el.style.borderRadius = '999px'
  el.style.background = '#3b63fb'
  el.style.color = '#ffffff'
  el.style.fontFamily = 'Adobe Clean Spectrum VF, Adobe Clean, sans-serif'
  el.style.fontSize = '12px'
  el.style.fontWeight = '400'
  el.style.lineHeight = '16px'
  el.style.boxShadow = '0 2px 8px rgba(15, 23, 42, 0.18)'
}

function ensureHoverLabel(): HTMLElement {
  if (hoverLabelEl) return hoverLabelEl
  const el = document.createElement('div')
  el.setAttribute('data-mercury-overlay', 'hover-label')
  styleOverlayLabel(el)
  document.documentElement.appendChild(el)
  hoverLabelEl = el
  return el
}

function createSelectedLabel(): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-mercury-overlay', 'selected-label')
  styleOverlayLabel(el)
  document.documentElement.appendChild(el)
  return el
}

function positionOverlayLabel(
  label: HTMLElement,
  target: HTMLElement,
  rect: DOMRect,
  gap = 2,
): void {
  const text = formatTargetLabel(target)
  // Skip the no-op write: assigning textContent replaces the child text node even
  // when the value is identical, and three observers rooted at documentElement
  // watch childList (comment anchors, inspect animations, the pages scan), so a
  // reposition would wake all three on every hover pointermove for no change.
  if (label.textContent !== text) label.textContent = text
  label.style.display = 'block'
  label.style.top = Math.max(4, rect.top - label.offsetHeight - gap) + 'px'
  label.style.left = Math.max(4, rect.left) + 'px'
}

function positionOverlay(target: HTMLElement): void {
  const overlay = ensureHoverOutline()
  const rect = target.getBoundingClientRect()
  overlay.style.display = 'block'
  overlay.style.top = rect.top + 'px'
  overlay.style.left = rect.left + 'px'
  overlay.style.width = rect.width + 'px'
  overlay.style.height = rect.height + 'px'
  positionOverlayLabel(ensureHoverLabel(), target, rect)
}

function hideOverlay(): void {
  if (hoverOutlineEl) hoverOutlineEl.style.display = 'none'
  if (hoverLabelEl) hoverLabelEl.style.display = 'none'
  lastHoverTarget = null
}

function createSelectedOutline(): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-mercury-overlay', 'selected')
  el.style.position = 'fixed'
  el.style.boxSizing = 'border-box'
  el.style.pointerEvents = 'none'
  // One below the hover overlay so hover on NON-selected elements still
  // reads visually on top; our pointermove handler hides hover when the
  // cursor is on the selected element, so the two never stack visibly.
  el.style.zIndex = '2147483645'
  // Spec: the 2px bound alone — no halo, no fill (guarded in injectBridge.test.ts).
  el.style.border = '2px solid #3b63fb'
  el.style.borderRadius = '2px'
  el.style.display = 'none'
  document.documentElement.appendChild(el)
  return el
}

function createInspectResizeHandle(handle: InspectResizeHandle): HTMLElement {
  const el = document.createElement('div')
  const isCorner = handle.length === 2
  el.setAttribute('data-mercury-overlay', 'resize-handle')
  el.setAttribute('data-mercury-resize-handle', handle)
  el.style.position = 'fixed'
  el.style.boxSizing = 'border-box'
  el.style.pointerEvents = 'auto'
  el.style.touchAction = 'none'
  el.style.zIndex = '2147483647'
  el.style.width = isCorner ? '10px' : '8px'
  el.style.height = isCorner ? '10px' : '8px'
  el.style.border = isCorner ? '1px solid #3b63fb' : 'none'
  el.style.borderRadius = isCorner ? '50%' : '0'
  el.style.background = isCorner ? '#ffffff' : 'transparent'
  el.style.boxShadow = 'none'
  el.style.cursor = handle === 'n' || handle === 's'
    ? 'ns-resize'
    : handle === 'e' || handle === 'w'
      ? 'ew-resize'
      : handle === 'nw' || handle === 'se'
        ? 'nwse-resize'
        : 'nesw-resize'
  el.style.display = 'none'
  document.documentElement.appendChild(el)
  return el
}

function createInspectResizeHandles(): HTMLElement[] {
  return [
    createInspectResizeHandle('nw'),
    createInspectResizeHandle('n'),
    createInspectResizeHandle('ne'),
    createInspectResizeHandle('e'),
    createInspectResizeHandle('se'),
    createInspectResizeHandle('s'),
    createInspectResizeHandle('sw'),
    createInspectResizeHandle('w'),
  ]
}

function createSelectedOverlayEntry(target: HTMLElement): SelectedOverlayEntry {
  return {
    target,
    outlineEl: createSelectedOutline(),
    labelEl: createSelectedLabel(),
    resizeHandles: [],
  }
}

function removeSelectedOverlayEntry(entry: SelectedOverlayEntry): void {
  try { entry.outlineEl.remove() } catch { /* noop */ }
  try { entry.labelEl.remove() } catch { /* noop */ }
  for (const handle of entry.resizeHandles) {
    try { handle.remove() } catch { /* noop */ }
  }
}

function positionInspectResizeHandles(handles: HTMLElement[], rect: DOMRect): void {
  if (!inspectResizeEnabled) return
  const positions: Record<InspectResizeHandle, { left: number; top: number }> = {
    nw: { left: rect.left, top: rect.top },
    n: { left: rect.left + rect.width / 2, top: rect.top },
    ne: { left: rect.right, top: rect.top },
    e: { left: rect.right, top: rect.top + rect.height / 2 },
    se: { left: rect.right, top: rect.bottom },
    s: { left: rect.left + rect.width / 2, top: rect.bottom },
    sw: { left: rect.left, top: rect.bottom },
    w: { left: rect.left, top: rect.top + rect.height / 2 },
  }
  for (const handle of handles) {
    const key = handle.getAttribute('data-mercury-resize-handle') as InspectResizeHandle | null
    const position = key ? positions[key] : null
    if (!key || !position) continue
    const isCorner = key.length === 2
    const isHorizontalEdge = key === 'n' || key === 's'
    const edgeInset = 6
    handle.style.display = 'block'
    if (isCorner) {
      handle.style.left = position.left - 5 + 'px'
      handle.style.top = position.top - 5 + 'px'
      handle.style.width = '10px'
      handle.style.height = '10px'
    } else if (isHorizontalEdge) {
      const hitWidth = Math.max(0, rect.width - edgeInset * 2)
      handle.style.left = rect.left + edgeInset + 'px'
      handle.style.top = position.top - 4 + 'px'
      handle.style.width = hitWidth + 'px'
      handle.style.height = '8px'
      handle.style.display = hitWidth > 0 ? 'block' : 'none'
    } else {
      const hitHeight = Math.max(0, rect.height - edgeInset * 2)
      handle.style.left = position.left - 4 + 'px'
      handle.style.top = rect.top + edgeInset + 'px'
      handle.style.width = '8px'
      handle.style.height = hitHeight + 'px'
      handle.style.display = hitHeight > 0 ? 'block' : 'none'
    }
  }
}

function syncInspectResizeHandles(): void {
  const shouldShowResizeHandles =
    inspectResizeEnabled && selectedOverlayEntries.length === 1
  for (const entry of selectedOverlayEntries) {
    if (shouldShowResizeHandles && !hasDynamicSizeBinding(entry.target)) {
      if (entry.resizeHandles.length === 0) entry.resizeHandles = createInspectResizeHandles()
      continue
    }
    for (const handle of entry.resizeHandles) {
      try { handle.remove() } catch { /* noop */ }
    }
    entry.resizeHandles = []
  }
}

function positionSelectedOverlayEntry(entry: SelectedOverlayEntry): boolean {
  if (!entry.target.isConnected) {
    removeSelectedOverlayEntry(entry)
    return false
  }
  if (interactionPreview) {
    entry.outlineEl.style.display = 'none'
    entry.labelEl.style.display = 'none'
    for (const handle of entry.resizeHandles) handle.style.display = 'none'
    return true
  }
  const rect = entry.target.getBoundingClientRect()
  entry.outlineEl.style.display = 'block'
  entry.outlineEl.style.top = rect.top + 'px'
  entry.outlineEl.style.left = rect.left + 'px'
  entry.outlineEl.style.width = rect.width + 'px'
  entry.outlineEl.style.height = rect.height + 'px'
  positionOverlayLabel(entry.labelEl, entry.target, rect, 8)
  positionInspectResizeHandles(entry.resizeHandles, rect)
  return true
}

function positionSelectedOverlay(): void {
  let pruned = false
  selectedOverlayEntries = selectedOverlayEntries.filter((entry) => {
    const kept = positionSelectedOverlayEntry(entry)
    if (!kept) pruned = true
    return kept
  })
  selectedTarget = selectedOverlayEntries.at(-1)?.target ?? null
  if (pruned) {
    syncInspectResizeHandles()
    for (const entry of selectedOverlayEntries) positionSelectedOverlayEntry(entry)
    refreshSelectedObservers()
  }
  positionSvgPreviewOverlays()
}

function hideSelectedOverlay(): void {
  for (const entry of selectedOverlayEntries) removeSelectedOverlayEntry(entry)
  selectedOverlayEntries = []
  selectedTarget = null
}

const MERCURY_COMMENT_CURSOR_ARROW = 'M0 0L0 13.5L3.2 10.6L5.6 16.4L8 15.4L5.7 9.7L9.9 9.7Z'
const MERCURY_COMMENT_CURSOR_SILHOUETTE =
  'M5.625 17.1C5.53579 17.1 5.44614 17.0824 5.36089 17.0464C5.11171 16.94 4.95 16.6957 4.95 16.425V13.5H4.275C2.41392 13.5 0.9 11.9856 0.9 10.125V5.175C0.9 3.31436 2.41392 1.8 4.275 1.8H13.725C15.5861 1.8 17.1 3.31436 17.1 5.175V10.125C17.1 11.9856 15.5861 13.5 13.725 13.5H9.63633L6.09302 16.911C5.9647 17.035 5.79639 17.1 5.625 17.1Z'
const MERCURY_COMMENT_CURSOR_GLYPH =
  MERCURY_COMMENT_CURSOR_SILHOUETTE +
  'M4.275 3.15C3.15835 3.15 2.25 4.05879 2.25 5.175V10.125C2.25 11.2412 3.15835 12.15 4.275 12.15H5.625C5.99765 12.15 6.3 12.4523 6.3 12.825V14.8386L8.89629 12.339C9.02198 12.2177 9.18985 12.15 9.36431 12.15H13.725C14.8416 12.15 15.75 11.2412 15.75 10.125V5.175C15.75 4.05879 14.8416 3.15 13.725 3.15H4.275Z'
const MERCURY_COMMENT_CURSOR =
  'url("data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      '<path d="' + MERCURY_COMMENT_CURSOR_ARROW + '" fill="#ffffff" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<path d="' + MERCURY_COMMENT_CURSOR_ARROW + '" fill="#292929"/>' +
      '<g transform="translate(13,13) scale(0.6)">' +
      '<path d="' + MERCURY_COMMENT_CURSOR_SILHOUETTE + '" fill="#ffffff"/>' +
      '<path d="' + MERCURY_COMMENT_CURSOR_GLYPH + '" fill="#292929"/>' +
      '</g></svg>',
  ) +
  '") 0 0, default'

function ensureInspectCursorStyle(): HTMLStyleElement {
  if (inspectCursorStyleEl && inspectCursorStyleEl.isConnected) return inspectCursorStyleEl
  const existing = document.getElementById('mercury-inspect-cursor-override')
  if (existing instanceof HTMLStyleElement) {
    inspectCursorStyleEl = existing
    return existing
  }
  const el = document.createElement('style')
  el.id = 'mercury-inspect-cursor-override'
  el.textContent = [
    'html[data-mercury-inspect-mode="true"],',
    'html[data-mercury-inspect-mode="true"] body,',
    'html[data-mercury-inspect-mode="true"] * {',
    '  cursor: crosshair !important;',
    '}',
    'html[data-mercury-inspect-mode="true"] [data-mercury-inline-editing="true"] {',
    '  cursor: text !important;',
    '  user-select: text !important;',
    // The generated app may supply its own focus ring (often using its accent
    // colour). Mercury already keeps the blue Inspect selection overlay around
    // this target, so a native/authored outline would draw a second, ambiguous
    // bounding box for the temporary contenteditable session.
    '  outline: 0 !important;',
    '  outline-offset: 0 !important;',
    // outline alone does not reach shadcn, and generated output is always
    // shadcn: its focus ring is a box-shadow, and the same base class that
    // draws it sets focus-visible:outline-none, so there is no outline left to
    // reset. Zero the ring layers rather than box-shadow itself, which is how
    // Tailwind's own ring-0 works -- blanking box-shadow would also erase the
    // element's real elevation for as long as its text is being edited.
    //
    // Accepted cost, same trade-off one layer down: the ring variables carry
    // authored rings too, so a static `ring-1 ring-inset` used as a border also
    // disappears while the text is edited, and comes back on commit or cancel.
    // CSS cannot tell the focus ring from the authored one -- both are the same
    // variable, the focus-visible variant only assigns it conditionally -- so
    // separating them would mean reading the computed ring before focus and
    // re-asserting it inline for the session. Not worth that machinery for a
    // border that returns the moment editing ends, while an accent focus ring
    // drawn beside Mercury's blue bound is ambiguous for the whole session.
    '  --tw-ring-shadow: 0 0 #0000 !important;',
    '  --tw-ring-offset-shadow: 0 0 #0000 !important;',
    '  --tw-inset-ring-shadow: 0 0 #0000 !important;',
    '}',
    'html[data-mercury-comment-mode="true"],',
    'html[data-mercury-comment-mode="true"] body,',
    'html[data-mercury-comment-mode="true"] * {',
    '  cursor: ' + MERCURY_COMMENT_CURSOR + ' !important;',
    '}',
  ].join('\n')
  ;(document.head || document.documentElement).appendChild(el)
  inspectCursorStyleEl = el
  return el
}

function setInspectCursorOverride(enabled: boolean, mode: 'inspect' | 'comment'): void {
  document.documentElement.removeAttribute('data-mercury-inspect-mode')
  document.documentElement.removeAttribute('data-mercury-comment-mode')
  if (!enabled) return
  ensureInspectCursorStyle()
  const attr = mode === 'comment' ? 'data-mercury-comment-mode' : 'data-mercury-inspect-mode'
  document.documentElement.setAttribute(attr, 'true')
}

function teardownSelectedObservers(): void {
  if (selectedPropsRefreshTimer !== null) {
    window.clearTimeout(selectedPropsRefreshTimer)
    selectedPropsRefreshTimer = null
  }
  if (selectedResizeObs) {
    try { selectedResizeObs.disconnect() } catch { /* noop */ }
    selectedResizeObs = null
  }
  if (selectedMutationObs) {
    try { selectedMutationObs.disconnect() } catch { /* noop */ }
    selectedMutationObs = null
  }
}

/** Re-publish computed values after an optimistic style mutation. */
function queueSelectedPropsRefresh(): void {
  // Dynamic adjustments edit a single owner. A synthetic replacement pick must
  // never change the membership of a user's additive selection.
  if (selectedOverlayEntries.length !== 1 || selectedPropsRefreshTimer !== null) return
  selectedPropsRefreshTimer = window.setTimeout(() => {
    selectedPropsRefreshTimer = null
    // Selection may have changed while this refresh was queued.
    if (selectedOverlayEntries.length !== 1) return
    const target = selectedTarget
    const oid = target?.getAttribute('data-oid')
    if (!target || !oid || target.isConnected === false) return
    post({
      source: 'mercury-bridge',
      type: 'element-props-updated',
      oid,
      props: domEvidenceManager.capture(target),
    })
  }, 50)
}

function refreshSelectedObservers(): void {
  teardownSelectedObservers()
  if (selectedOverlayEntries.length === 0) return
  try {
    selectedResizeObs = new ResizeObserver(() => positionSelectedOverlay())
    for (const entry of selectedOverlayEntries) selectedResizeObs.observe(entry.target)
  } catch { /* noop */ }
  // Re-measure when any class/style attribute in the subtree changes — the
  // optimistic mutate-dom channel rewrites className on selected targets (and
  // their shared-oid siblings), which shifts layout around them.
  try {
    selectedMutationObs = new MutationObserver(() => {
      positionSelectedOverlay()
    })
    selectedMutationObs.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
      childList: true,
    })
  } catch { /* noop */ }
}

function isSelectedTarget(target: HTMLElement): boolean {
  return selectedOverlayEntries.some((entry) => entry.target === target)
}

function setSelectedTarget(target: HTMLElement | null, append = false): void {
  if (!target) {
    hideSelectedOverlay()
    teardownSelectedObservers()
    return
  }
  if (!append) hideSelectedOverlay()

  const existingIndex = selectedOverlayEntries.findIndex((entry) => entry.target === target)
  if (append && existingIndex >= 0) {
    const [existing] = selectedOverlayEntries.splice(existingIndex, 1)
    if (existing) removeSelectedOverlayEntry(existing)
  } else if (existingIndex >= 0) {
    const [existing] = selectedOverlayEntries.splice(existingIndex, 1)
    if (existing) selectedOverlayEntries.push(existing)
  } else {
    selectedOverlayEntries.push(createSelectedOverlayEntry(target))
  }
  selectedTarget = selectedOverlayEntries.at(-1)?.target ?? null
  syncInspectResizeHandles()
  positionSelectedOverlay()
  refreshSelectedObservers()
}

function restoreSelectedTargets(
  selections: Array<{ oid: string; instanceIndex?: number | null }>,
): void {
  hideSelectedOverlay()
  for (const selection of selections) {
    const targets = findOidNodes(selection.oid)
    if (targets.length === 0) continue
    const index =
      typeof selection.instanceIndex === 'number' &&
      Number.isInteger(selection.instanceIndex) &&
      selection.instanceIndex >= 0
        ? selection.instanceIndex
        : 0
    const target = targets[index] ?? targets[0]
    if (target) setSelectedTarget(target, true)
  }
}

// Runtime targets the parent tracks for comment markers. The locator is
// mandatory: data-oid identifies source code, while this identifies one live
// rendered occurrence.
type TrackedCommentTarget = { oid: string; instanceLocator: BridgeInstanceLocator }
let trackedCommentTargets: TrackedCommentTarget[] = []
let lastPublishedAnchors = ''
let commentMutationObs: MutationObserver | null = null
let commentMutationTimer: ReturnType<typeof setTimeout> | null = null
let commentObserverNeedsResync = false
let commentFingerprintByNode = new WeakMap<HTMLElement, string>()
let highlightedCommentTarget: HTMLElement | null = null
let commentTargetHighlightOverlay: HTMLElement | null = null
let commentTargetHighlightLabel: HTMLElement | null = null
let highlightedCommentTargetSpec: TrackedCommentTarget | null = null
let commentTargetHighlightObserver: MutationObserver | null = null

function ensureCommentTargetHighlightOverlay(): HTMLElement {
  if (commentTargetHighlightOverlay) return commentTargetHighlightOverlay
  // An element overlay is reliable for SVG and replaced elements, whose own
  // outlines/shadows can be clipped or omitted by their rendering engines.
  const overlay = document.createElement('div')
  overlay.setAttribute('data-mercury-overlay', 'comment-target')
  overlay.style.position = 'fixed'
  overlay.style.pointerEvents = 'none'
  // One below the hover overlay, like the pinned selection: hovering a different
  // element must still draw its outline on top of this ring.
  overlay.style.zIndex = '2147483645'
  overlay.style.boxSizing = 'border-box'
  overlay.style.border = '2px solid #3b63fb'
  overlay.style.borderRadius = '2px'
  overlay.style.display = 'none'
  document.documentElement.appendChild(overlay)
  commentTargetHighlightOverlay = overlay
  commentTargetHighlightLabel = createSelectedLabel()
  // Same hover-precedence rule the outline above follows: the shared builder puts
  // every label at the top of the stack, but this one must not cover the hover
  // pill for whatever element is currently under the pointer, or the UI names the
  // wrong element. One below the hover label, still above this overlay's outline.
  commentTargetHighlightLabel.style.zIndex = '2147483646'
  return overlay
}

function positionCommentTargetHighlight(): void {
  const overlay = commentTargetHighlightOverlay
  const label = commentTargetHighlightLabel
  const element = highlightedCommentTarget
  if (!overlay) return
  if (!element || !element.isConnected) {
    overlay.style.display = 'none'
    if (label) label.style.display = 'none'
    return
  }
  const rect = element.getBoundingClientRect()
  overlay.style.display = 'block'
  overlay.style.top = rect.top + 'px'
  overlay.style.left = rect.left + 'px'
  overlay.style.width = rect.width + 'px'
  overlay.style.height = rect.height + 'px'
  if (label) positionOverlayLabel(label, element, rect, 8)
}

function syncCommentTargetHighlight(): void {
  if (!highlightedCommentTargetSpec) return
  highlightedCommentTarget = findCommentAnchorElement(highlightedCommentTargetSpec)
  positionCommentTargetHighlight()
}

function clearCommentTargetHighlight(): void {
  highlightedCommentTargetSpec = null
  highlightedCommentTarget = null
  if (commentTargetHighlightOverlay) commentTargetHighlightOverlay.style.display = 'none'
  if (commentTargetHighlightLabel) commentTargetHighlightLabel.style.display = 'none'
  if (commentTargetHighlightObserver) {
    commentTargetHighlightObserver.disconnect()
    commentTargetHighlightObserver = null
  }
}

function setCommentTargetHighlight(target: TrackedCommentTarget | null): void {
  clearCommentTargetHighlight()
  if (!target) return
  highlightedCommentTargetSpec = target
  ensureCommentTargetHighlightOverlay()
  syncCommentTargetHighlight()
  try {
    commentTargetHighlightObserver = new MutationObserver(syncCommentTargetHighlight)
    // Observe head and body, never documentElement: the overlay and its label are
    // documentElement children and this callback repositions them, so that root
    // would make the callback retrigger itself forever. Anchors live under body;
    // head carries the stylesheets whose swaps reflow them.
    commentTargetHighlightObserver.observe(document.body, { subtree: true, childList: true })
    commentTargetHighlightObserver.observe(document.head, { subtree: true, childList: true })
  } catch { /* noop */ }
  // If the cursor is already over this element the hover overlay is visible;
  // drop it so only the comment-target ring shows (no double border).
  if (lastHoverTarget === highlightedCommentTarget) hideOverlay()
}

function commentAnchorCandidates(node: HTMLElement): HTMLElement[] {
  const descendants =
    typeof node.querySelectorAll === 'function'
      ? Array.from(node.querySelectorAll('img, svg, video, audio, canvas, object, embed, iframe')) as HTMLElement[]
      : []
  return [node, ...descendants]
}

function isCommentAnchorAncestor(ancestor: HTMLElement, node: HTMLElement): boolean {
  let current: HTMLElement | null = node
  while (current) {
    if (current === ancestor) return true
    current = current.parentElement
  }
  return false
}

function commentAnchorObservationRoot(): HTMLElement {
  const context = createCommentAnchorResolutionContext()
  const nodes: HTMLElement[] = []
  for (const target of trackedCommentTargets) {
    const node = findCommentAnchorElement(target, context)
    if (!node) return document.documentElement
    nodes.push(node)
  }

  let common: HTMLElement | null = nodes[0] ?? null
  while (common && !nodes.every((node) => isCommentAnchorAncestor(common!, node))) {
    common = common.parentElement
  }
  if (!common) return document.documentElement
  // Observe one level above the common subtree so replacing that subtree is
  // itself visible to the observer.
  return common.parentElement ?? common
}

function scheduleCommentAnchorSync(records: MutationRecord[] = []): void {
  if (records.some((record) => record.type === 'childList')) {
    commentFingerprintByNode = new WeakMap()
    commentObserverNeedsResync = true
  }
  if (commentMutationTimer != null) clearTimeout(commentMutationTimer)
  commentMutationTimer = setTimeout(() => {
    commentMutationTimer = null
    const needsResync = commentObserverNeedsResync
    commentObserverNeedsResync = false
    publishCommentAnchors()
    if (needsResync) syncCommentAnchorObserver()
  }, 120)
}

function syncCommentAnchorObserver(): void {
  commentObserverNeedsResync = false
  if (commentMutationObs) {
    commentMutationObs.disconnect()
    commentMutationObs = null
  }
  if (commentMutationTimer != null) {
    clearTimeout(commentMutationTimer)
    commentMutationTimer = null
  }
  if (trackedCommentTargets.length === 0) return
  try {
    // Route transitions and generated-app panning commonly move/replace targets
    // without scrolling the window. Re-measure on those DOM changes so an
    // immediate pre-render publish cannot leave a marker hidden indefinitely.
    commentMutationObs = new MutationObserver(scheduleCommentAnchorSync)
    commentMutationObs.observe(commentAnchorObservationRoot(), {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    })
  } catch { /* noop */ }
}

type CommentAnchorResolutionContext = {
  nodesByOid: Map<string, HTMLElement[]>
  fingerprintByNode: WeakMap<HTMLElement, string>
  fallbackByLocator: Map<string, HTMLElement | null>
}

function createCommentAnchorResolutionContext(): CommentAnchorResolutionContext {
  return {
    nodesByOid: new Map(),
    fingerprintByNode: commentFingerprintByNode,
    fallbackByLocator: new Map(),
  }
}

// Comment markers are drawn by the PARENT, which can't see this cross-origin
// document's scroll offset. Rects are viewport-relative, so one is only valid at
// the current scroll position — hence re-publishing on every scroll/resize, with
function findElementAtPath(path: number[]): HTMLElement | null {
  let current: HTMLElement = document.body
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0 || index >= current.children.length) return null
    current = current.children[index] as HTMLElement
  }
  return current
}

function findCommentAnchorElement(
  target: TrackedCommentTarget,
  context: CommentAnchorResolutionContext = createCommentAnchorResolutionContext(),
): HTMLElement | null {
  try {
    // Comments resolve to the nearest stamped source ancestor, irrespective of
    // whether it is currently interactive in inspect mode. Keep this separate
    // from findOidTarget, whose interactive-target preference is only for
    // inspector selection.
    const nearestOidTarget = (start: HTMLElement): HTMLElement | null => {
      let node: HTMLElement | null = start
      while (node && node !== document.body) {
        if (node.hasAttribute?.('data-oid')) return node
        node = node.parentElement
      }
      return null
    }
    const locator = target.instanceLocator
    const pathNode = findElementAtPath(locator.path)
    if (pathNode && nearestOidTarget(pathNode)?.getAttribute('data-oid') === target.oid) {
      const pathLocator = extractInstanceLocator(pathNode)
      context.fingerprintByNode.set(pathNode, pathLocator.fingerprint)
      if (pathLocator.fingerprint === locator.fingerprint) return pathNode
    }

    let nodes = context.nodesByOid.get(target.oid)
    if (!nodes) {
      // Same enumeration as every other oid lookup, so an anchor never resolves
      // onto a node the panel has optimistically deleted.
      nodes = findOidNodes(target.oid)
      context.nodesByOid.set(target.oid, nodes)
    }
    const fallbackKey = target.oid + ' ' + locator.fingerprint
    if (context.fallbackByLocator.has(fallbackKey)) return context.fallbackByLocator.get(fallbackKey) ?? null

    let match: HTMLElement | null = null
    let matchCount = 0
    for (const node of nodes) {
      for (const candidate of commentAnchorCandidates(node)) {
        if (nearestOidTarget(candidate)?.getAttribute('data-oid') !== target.oid) continue
        let fingerprint = context.fingerprintByNode.get(candidate)
        if (!fingerprint) {
          fingerprint = extractInstanceLocator(candidate).fingerprint
          context.fingerprintByNode.set(candidate, fingerprint)
        }
        if (fingerprint !== locator.fingerprint) continue
        match = candidate
        matchCount += 1
        if (matchCount > 1) {
          match = null
          break
        }
      }
      if (matchCount > 1) break
    }
    context.fallbackByLocator.set(fallbackKey, matchCount === 1 ? match : null)
    return matchCount === 1 ? match : null
  } catch {
    return null
  }
}

function publishCommentAnchors(): void {
  if (trackedCommentTargets.length === 0) return
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
  const resolutionContext = createCommentAnchorResolutionContext()
  const anchors = trackedCommentTargets.map((target) => {
    const el = findCommentAnchorElement(target, resolutionContext)
    const locator = target.instanceLocator
    if (!el) return { oid: target.oid, instanceLocator: locator, rect: null, visible: false, viewport: null }
    const rect = extractRect(el)
    if (!rect) return { oid: target.oid, instanceLocator: locator, rect: null, visible: false, viewport: null }
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.x < viewportWidth &&
      rect.y < viewportHeight &&
      rect.x + rect.width > 0 &&
      rect.y + rect.height > 0
    return { oid: target.oid, instanceLocator: locator, rect, visible, viewport: { width: viewportWidth, height: viewportHeight } }
  })
  // Scroll fires this ~60x/sec and most ticks move nothing; skip the cross-origin
  // post on an unchanged payload so the parent isn't woken for no reason.
  const serialised = JSON.stringify(anchors)
  if (serialised === lastPublishedAnchors) return
  lastPublishedAnchors = serialised
  post({ source: 'mercury-bridge', type: 'comment-anchors', anchors })
}

function schedulePositionSync(): void {
  if (repositionRafPending) return
  repositionRafPending = true
  bridgeRequestAnimationFrame(() => {
    repositionRafPending = false
    publishCommentAnchors()
    if (selectedOverlayEntries.length > 0) positionSelectedOverlay()
    else positionSvgPreviewOverlays()
    positionCommentTargetHighlight()
    // Keep hover movable after a selection so users can switch targets
    // without clearing the current one first.
    if (lastHoverTarget && !isSelectedTarget(lastHoverTarget)) positionOverlay(lastHoverTarget)
  })
}

function scheduleCommentTargetScroll(): void {
  if (!highlightedCommentTarget || commentTargetScrollRafPending) return
  commentTargetScrollRafPending = true
  bridgeRequestAnimationFrame(() => {
    commentTargetScrollRafPending = false
    if (highlightedCommentTarget) {
      post({ source: 'mercury-bridge', type: 'comment-target-scroll' })
    }
  })
}

function onFrameScroll(): void {
  scheduleCommentTargetScroll()
  schedulePositionSync()
}

function onPointerMove(e: PointerEvent): void {
  if (!inspectEnabled) return
  if (isInlineTextEventTarget(e.target)) return
  if (cursorMode === 'comment') setCommentPointerEngaged(true)
  stopInspectInteraction(e)
  if (activeInspectResize) {
    if (e.pointerId !== activeInspectResize.pointerId) return
    activeInspectResize.latestClientX = e.clientX
    activeInspectResize.latestClientY = e.clientY
    activeInspectResize.latestShiftKey = e.shiftKey
    scheduleInspectResizeFrame()
    return
  }
  if (activeInspectMove) {
    if (e.pointerId !== activeInspectMove.pointerId) return
    activeInspectMove.latestClientX = e.clientX
    activeInspectMove.latestClientY = e.clientY
    scheduleInspectMoveFrame()
    return
  }
  const commentTarget = cursorMode === 'comment' ? findCommentTarget(e.target) : null
  const target = commentTarget?.element ?? findInspectTargetAtPoint(e.target, e.clientX, e.clientY)
  // MagicPath-style behaviour:
  // - selected element stays pinned
  // - hover preview still follows other selectable elements
  if (!target) {
    hideOverlay()
    return
  }
  if (isSelectedTarget(target)) {
    hideOverlay()
    return
  }
  // The comment-target highlight already rings this element; showing the hover
  // outline on top would double-draw the border, so hover stays hidden for that
  // element.
  if (target === highlightedCommentTarget) {
    hideOverlay()
    return
  }
  if (target !== lastHoverTarget) {
    lastHoverTarget = target
    positionOverlay(target)
  }
}

function directMovableSiblings(move: ActiveInspectMove): HTMLElement[] {
  return Array.from(move.parent.children).filter((child): child is HTMLElement =>
    child instanceof HTMLElement &&
    child !== move.target &&
    child !== move.placeholder &&
    Boolean(child.getAttribute('data-oid')),
  )
}

function moveAnchorAtPoint(move: ActiveInspectMove, clientX: number, clientY: number): HTMLElement | null {
  const siblings = directMovableSiblings(move)
  const style = getComputedStyle(move.parent)
  if (style.display === 'flex') {
    // siblings is DOM (logical) order. In a reverse container the visual
    // order is inverted relative to DOM order, so the drop anchor -- the first
    // DOM sibling the dragged element should be inserted *before* -- is found by
    // flipping the midpoint comparison. Without this, the row prefix check also
    // matched row-reverse (and the block-flow fallback matched
    // column-reverse) and the placeholder landed at the wrong end.
    const reverse = style.flexDirection.endsWith('reverse')
    if (style.flexDirection.startsWith('row')) {
      return siblings.find((sibling) => {
        const rect = sibling.getBoundingClientRect()
        const mid = rect.left + rect.width / 2
        return reverse ? clientX > mid : clientX < mid
      }) ?? null
    }
    // column / column-reverse
    return siblings.find((sibling) => {
      const rect = sibling.getBoundingClientRect()
      const mid = rect.top + rect.height / 2
      return reverse ? clientY > mid : clientY < mid
    }) ?? null
  }
  if (style.display === 'grid') {
    return siblings.find((sibling) => {
      const rect = sibling.getBoundingClientRect()
      const sameRow = clientY >= rect.top && clientY <= rect.bottom
      return clientY < rect.top + rect.height / 2 || (sameRow && clientX < rect.left + rect.width / 2)
    }) ?? null
  }
  return siblings.find((sibling) => clientY < sibling.getBoundingClientRect().top + sibling.getBoundingClientRect().height / 2) ?? null
}

function createMovePlaceholder(target: HTMLElement, rect: DOMRect): HTMLElement {
  const placeholder = document.createElement('div')
  placeholder.setAttribute('data-mercury-overlay', 'move-placeholder')
  placeholder.style.boxSizing = 'border-box'
  placeholder.style.width = rect.width + 'px'
  placeholder.style.height = rect.height + 'px'
  placeholder.style.minWidth = rect.width + 'px'
  placeholder.style.minHeight = rect.height + 'px'
  placeholder.style.flex = '0 0 ' + rect.width + 'px'
  placeholder.style.border = '2px dashed #3b63fb'
  placeholder.style.borderRadius = '4px'
  placeholder.style.background = 'repeating-linear-gradient(135deg, rgba(59,99,251,.20) 0 4px, rgba(59,99,251,.04) 4px 8px)'
  placeholder.style.pointerEvents = 'none'
  const style = getComputedStyle(target)
  placeholder.style.gridColumn = style.gridColumn
  placeholder.style.gridRow = style.gridRow
  return placeholder
}

/**
 * The selected element a press belongs to, which is not always the element
 * pressed.
 *
 * Reorder targets are cards, nav links and list rows, and their stamped
 * children -- a heading, a label, an icon -- cover nearly all of their area.
 * Inspect hover resolves to the deepest of those, so requiring the press to
 * land on the selected element itself would leave most selected containers
 * with nowhere left to grab.
 */
function selectedMoveTargetFor(target: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = target
  while (node && node !== document.body) {
    if (isSelectedTarget(node)) return node
    node = node.parentElement
  }
  return null
}

function startInspectMove(e: PointerEvent, target: HTMLElement, pressedTarget = target): boolean {
  if (!inspectMoveEnabled) return false
  const oid = target.getAttribute('data-oid')
  const parent = target.parentElement
  const parentOid = parent?.getAttribute('data-oid')
  const props = domEvidenceManager.capture(target)
  if (!oid || !parent || !parentOid) return false
  // map()/forEach() output (marked by the stamper, distinct from the
  // broader isShared, which also covers repeated static component call
  // sites via instanceCount > 1) always fails closed server-side: its parent
  // has a dynamic JSX child, so applyReorderEdit refuses the resulting
  // fromIndex/beforeIndex reorder. Refuse to even start the drag rather than
  // showing a valid-looking drop that can never persist.
  if (target.getAttribute('data-oid-shared') === 'true') return false
  const directOidChildren = Array.from(parent.children).filter((child) => child instanceof HTMLElement && child.hasAttribute('data-oid'))
  if (directOidChildren.length < 2) return false
  const sourceSiblings = directOidChildren as HTMLElement[]
  const fromIndex = sourceSiblings.indexOf(target)
  if (fromIndex < 0) return false
  const originalAnchor = sourceSiblings[fromIndex + 1] ?? null
  const originalBeforeIndex = originalAnchor ? fromIndex + 1 : null
  const rect = target.getBoundingClientRect()
  const placeholder = createMovePlaceholder(target, rect)
  activeInspectMove = {
    target,
    parent,
    sourceSiblings,
    parentOid,
    oid,
    isShared: props.isShared,
    fromIndex,
    originalBeforeIndex,
    beforeIndex: originalBeforeIndex,
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    latestClientX: e.clientX,
    latestClientY: e.clientY,
    startRect: rect,
    parentRect: parent.getBoundingClientRect(),
    originalStyleAttr: target.getAttribute('style'),
    originalNextSibling: target.nextSibling,
    originalBeforeOid: originalAnchor?.getAttribute('data-oid') ?? null,
    placeholder,
    activated: false,
    pressedTarget,
    beforeOid: originalAnchor?.getAttribute('data-oid') ?? null,
    rafId: null,
  }
  try { target.setPointerCapture(e.pointerId) } catch { /* noop */ }
  return true
}

function applyInspectMoveFrame(): void {
  const move = activeInspectMove
  if (!move) return
  markMercuryMutationTargets([move.target, move.parent])
  move.rafId = null
  const dx = move.latestClientX - move.startClientX
  const dy = move.latestClientY - move.startClientY
  if (!move.activated && Math.hypot(dx, dy) < 5) return
  if (!move.activated) {
    move.activated = true
    move.parent.insertBefore(move.placeholder, move.target)
    move.target.setAttribute('data-mercury-moving', 'true')
    move.target.style.position = 'fixed'
    move.target.style.left = move.startRect.left + 'px'
    move.target.style.top = move.startRect.top + 'px'
    move.target.style.width = move.startRect.width + 'px'
    move.target.style.height = move.startRect.height + 'px'
    move.target.style.margin = '0'
    move.target.style.zIndex = '2147483646'
    move.target.style.pointerEvents = 'none'
    move.target.style.opacity = '0.78'
  }
  const minX = move.parentRect.left - move.startRect.left
  const maxX = move.parentRect.right - move.startRect.right
  const minY = move.parentRect.top - move.startRect.top
  const maxY = move.parentRect.bottom - move.startRect.bottom
  move.target.style.transform = 'translate(' + Math.max(minX, Math.min(maxX, dx)) + 'px,' + Math.max(minY, Math.min(maxY, dy)) + 'px)'
  const anchor = moveAnchorAtPoint(move, move.latestClientX, move.latestClientY)
  if (anchor) move.parent.insertBefore(move.placeholder, anchor)
  else move.parent.appendChild(move.placeholder)
  move.beforeOid = anchor?.getAttribute('data-oid') ?? null
  move.beforeIndex = anchor ? move.sourceSiblings.indexOf(anchor) : null
}

function scheduleInspectMoveFrame(): void {
  const move = activeInspectMove
  if (!move || move.rafId !== null) return
  move.rafId = bridgeRequestAnimationFrame(applyInspectMoveFrame)
}

function cancelInspectMove(): void {
  const move = activeInspectMove
  if (!move) return
  markMercuryMutationTargets([move.target, move.parent])
  if (move.rafId !== null) bridgeCancelAnimationFrame(move.rafId)
  try { move.target.releasePointerCapture(move.pointerId) } catch { /* noop */ }
  move.placeholder.remove()
  if (move.originalNextSibling) move.parent.insertBefore(move.target, move.originalNextSibling)
  else move.parent.appendChild(move.target)
  move.target.removeAttribute('data-mercury-moving')
  if (move.originalStyleAttr === null) move.target.removeAttribute('style')
  else move.target.setAttribute('style', move.originalStyleAttr)
  activeInspectMove = null
  positionSelectedOverlay()
}

// pointercancel means the browser aborted the gesture (capture loss, OS
// interruption, etc.) — unlike pointerup, this is not a user-confirmed
// drop, so it must roll back rather than commit whatever partial
// position/size the last pointer coordinates happened to reach.
function onInspectMovePointerCancel(e: PointerEvent): void {
  if (!activeInspectMove || e.pointerId !== activeInspectMove.pointerId) return
  cancelInspectMove()
}

function finishInspectMove(e: PointerEvent): void {
  const move = activeInspectMove
  if (!move || e.pointerId !== move.pointerId) return
  markMercuryMutationTargets([move.target, move.parent])
  stopInspectInteraction(e)
  if (move.rafId !== null) bridgeCancelAnimationFrame(move.rafId)
  applyInspectMoveFrame()
  try { move.target.releasePointerCapture(e.pointerId) } catch { /* noop */ }
  const beforeOid = move.beforeOid
  const changed = move.activated && (
    move.isShared
      ? move.beforeIndex !== move.originalBeforeIndex
      : beforeOid !== move.originalBeforeOid
  )
  const reorderedProps = domEvidenceManager.capture(move.target)
  if (move.isShared) {
    const postMoveSiblings = move.sourceSiblings.filter((sibling) => sibling !== move.target)
    const postMoveIndex = move.beforeIndex === null
      ? postMoveSiblings.length
      : move.beforeIndex > move.fromIndex
        ? move.beforeIndex - 1
        : move.beforeIndex
    reorderedProps.instanceIndex = postMoveSiblings
      .slice(0, postMoveIndex)
      .filter((sibling) => sibling.getAttribute('data-oid') === move.oid)
      .length
  }
  move.placeholder.remove()
  if (move.originalNextSibling) move.parent.insertBefore(move.target, move.originalNextSibling)
  else move.parent.appendChild(move.target)
  move.target.removeAttribute('data-mercury-moving')
  if (move.originalStyleAttr === null) move.target.removeAttribute('style')
  else move.target.setAttribute('style', move.originalStyleAttr)
  activeInspectMove = null
  positionSelectedOverlay()
  // Pointer capture was taken on move.target, and a captured pointer sends its
  // compatibility click to the CAPTURING element -- the container -- not to
  // whatever is under the pointer, even with pointer-down and pointer-up both
  // default-prevented. Left alone, that click reaches onInspectClickCapture,
  // resolves to the container, finds it is not the selection this gesture just
  // made, and selects it right back: a descendant of a selected container
  // could never be clicked. This gesture already decided what is selected, so
  // its trailing click has nothing left to say.
  suppressNextClickTarget = move.target
  if (!move.activated) {
    // The press never travelled, so it was a click on a descendant of the
    // selected container rather than the start of a drag. Pointer-down handed
    // this gesture to the move and returned before selecting, so do it here.
    if (move.pressedTarget !== move.target && move.pressedTarget.isConnected) {
      selectInspectTarget(move.pressedTarget, isAdditiveSelectionEvent(e), e)
    }
    return
  }
  if (!changed) return
  post({
    source: 'mercury-bridge',
    type: 'element-move-commit',
    oid: move.oid,
    parentOid: move.parentOid,
    beforeOid,
    ...(move.isShared ? {
      fromIndex: move.fromIndex,
      beforeIndex: move.beforeIndex,
      siblingCount: move.sourceSiblings.length,
    } : {}),
    props: reorderedProps,
  })
}

function inspectResizeHandleFromTarget(target: EventTarget | null): InspectResizeHandle | null {
  if (!(target instanceof HTMLElement)) return null
  const handle = target.closest('[data-mercury-resize-handle]')
  const value = handle?.getAttribute('data-mercury-resize-handle')
  return value === 'nw' || value === 'n' || value === 'ne' || value === 'e' ||
    value === 'se' || value === 's' || value === 'sw' || value === 'w'
    ? value
    : null
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function resolvedGridTracks(value: string): number[] {
  return value
    .trim()
    .split(/\s+/)
    .map(cssPixels)
    .filter((value) => value > 0)
}

function gridTrackIndex(
  tracks: number[],
  gap: number,
  contentStart: number,
  targetCenter: number,
): number {
  let cursor = contentStart
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index] || 0
    if (targetCenter <= cursor + track + gap / 2) return index
    cursor += track + gap
  }
  return Math.max(0, tracks.length - 1)
}

function resizeAdjacentGridTracks(
  tracks: number[],
  index: number,
  delta: number,
  adjacentOffset: -1 | 1,
): number[] {
  if (tracks.length < 2 || index < 0 || index >= tracks.length) return tracks
  const requestedAdjacentIndex = index + adjacentOffset
  const adjacentIndex = requestedAdjacentIndex >= 0 && requestedAdjacentIndex < tracks.length
    ? requestedAdjacentIndex
    : index - adjacentOffset
  const current = tracks[index] || 0
  const adjacent = tracks[adjacentIndex] || 0
  const pairTotal = current + adjacent
  const nextCurrent = Math.max(8, Math.min(pairTotal - 8, current + delta))
  const next = [...tracks]
  next[index] = nextCurrent
  next[adjacentIndex] = pairTotal - nextCurrent
  return next
}

function gridTrackStyle(tracks: number[]): string {
  return tracks.map((track) => Math.round(track) + 'px').join(' ')
}

function inspectResizeOffsetProperty(
  style: CSSStyleDeclaration,
  axis: 'horizontal' | 'vertical',
): InspectResizeOffsetProperty | null {
  if (style.position === 'static') {
    return axis === 'horizontal' ? 'marginLeft' : 'marginTop'
  }
  const leading = axis === 'horizontal' ? style.left : style.top
  const opposite = axis === 'horizontal' ? style.right : style.bottom
  // An absolute/fixed element anchored only from the opposite side already
  // keeps that edge fixed when its size changes; adding a leading offset would
  // over-constrain it.
  if (leading === 'auto' && opposite !== 'auto') return null
  return axis === 'horizontal' ? 'left' : 'top'
}

function inspectResizeStartOffset(
  target: HTMLElement,
  style: CSSStyleDeclaration,
  property: InspectResizeOffsetProperty | null,
  rect: DOMRect,
): number {
  if (!property) return 0
  const computedOffset = Number.parseFloat(style[property])
  if (Number.isFinite(computedOffset)) return computedOffset
  if (property === 'marginLeft' || property === 'marginTop') return 0
  if (style.position !== 'absolute' && style.position !== 'fixed') return 0

  const horizontal = property === 'left'
  const rectStart = horizontal ? rect.left : rect.top
  const margin = cssPixels(horizontal ? style.marginLeft : style.marginTop)
  const offsetParent = target.offsetParent
  if (!(offsetParent instanceof HTMLElement)) return rectStart - margin

  const offsetParentRect = offsetParent.getBoundingClientRect()
  const offsetParentStyle = getComputedStyle(offsetParent)
  const border = cssPixels(
    horizontal ? offsetParentStyle.borderLeftWidth : offsetParentStyle.borderTopWidth,
  )
  const parentStart = horizontal ? offsetParentRect.left : offsetParentRect.top
  return rectStart - parentStart - border - margin
}

function constrainInspectResizeToAspectRatio(
  resize: ActiveInspectResize,
  widthDelta: number,
  heightDelta: number,
): [number, number] {
  const isCorner = resize.handle.length === 2
  if (!resize.latestShiftKey || !isCorner || resize.startWidth <= 0 || resize.startHeight <= 0) {
    return [widthDelta, heightDelta]
  }

  const widthScale = (resize.startWidth + widthDelta) / resize.startWidth
  const heightScale = (resize.startHeight + heightDelta) / resize.startHeight
  const widthChange = Math.abs(widthScale - 1)
  const heightChange = Math.abs(heightScale - 1)
  const minimumScale = Math.max(8 / resize.startWidth, 8 / resize.startHeight)
  const scale = Math.max(minimumScale, widthChange >= heightChange ? widthScale : heightScale)
  return [
    resize.startWidth * (scale - 1),
    resize.startHeight * (scale - 1),
  ]
}

function applyInspectResizeFrame(): void {
  const resize = activeInspectResize
  if (!resize) return
  markMercuryMutationTargets([resize.target, resize.parent])
  resize.rafId = null
  const dx = resize.latestClientX - resize.startClientX
  const dy = resize.latestClientY - resize.startClientY
  const resizesFromLeft = resize.handle === 'nw' || resize.handle === 'sw' || resize.handle === 'w'
  const resizesFromTop = resize.handle === 'nw' || resize.handle === 'ne' || resize.handle === 'n'
  const resizesWidth = resize.handle !== 'n' && resize.handle !== 's'
  const resizesHeight = resize.handle !== 'e' && resize.handle !== 'w'
  const unconstrainedWidthDelta = resizesFromLeft ? -dx : dx
  const unconstrainedHeightDelta = resizesFromTop ? -dy : dy
  const [widthDelta, heightDelta] = constrainInspectResizeToAspectRatio(
    resize,
    unconstrainedWidthDelta,
    unconstrainedHeightDelta,
  )
  if (resizesWidth) {
    if (resize.parentDisplay === 'grid' && resize.parent && resize.parentOid && resize.gridColumns.length > 1) {
      resize.parent.style.gridTemplateColumns = gridTrackStyle(
        resizeAdjacentGridTracks(
          resize.gridColumns,
          resize.gridColumnIndex,
          widthDelta,
          resizesFromLeft ? -1 : 1,
        ),
      )
    } else {
      const width = Math.max(8, Math.round(resize.startWidth + widthDelta))
      resize.target.style.width = width + 'px'
      if (resizesFromLeft && resize.horizontalOffsetProperty) {
        const actualWidthDelta = width - resize.startWidth
        resize.target.style[resize.horizontalOffsetProperty] =
          Math.round(resize.startHorizontalOffset - actualWidthDelta) + 'px'
      }
      if (resize.parentDisplay === 'flex' && resize.parentFlexDirection.startsWith('row')) {
        resize.target.style.flexBasis = width + 'px'
      }
    }
  }
  if (resizesHeight) {
    if (resize.parentDisplay === 'grid' && resize.parent && resize.parentOid && resize.gridRows.length > 1) {
      resize.parent.style.gridTemplateRows = gridTrackStyle(
        resizeAdjacentGridTracks(
          resize.gridRows,
          resize.gridRowIndex,
          heightDelta,
          resizesFromTop ? -1 : 1,
        ),
      )
    } else {
      const height = Math.max(8, Math.round(resize.startHeight + heightDelta))
      resize.target.style.height = height + 'px'
      if (resizesFromTop && resize.verticalOffsetProperty) {
        const actualHeightDelta = height - resize.startHeight
        resize.target.style[resize.verticalOffsetProperty] =
          Math.round(resize.startVerticalOffset - actualHeightDelta) + 'px'
      }
      if (resize.parentDisplay === 'flex' && resize.parentFlexDirection.startsWith('column')) {
        resize.target.style.flexBasis = height + 'px'
      }
    }
  }
  positionSelectedOverlay()
}

function scheduleInspectResizeFrame(): void {
  const resize = activeInspectResize
  if (!resize || resize.rafId !== null) return
  resize.rafId = bridgeRequestAnimationFrame(applyInspectResizeFrame)
}

function inspectResizeStyleBaseline(
  element: HTMLElement,
  computed: CSSStyleDeclaration,
  properties: readonly string[],
): Record<string, string> {
  return Object.fromEntries(properties.map((property) => {
    const cssName = property.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())
    const inline = element.style.getPropertyValue(cssName)
    return [property, inline || computed.getPropertyValue(cssName)]
  }))
}

function hasDynamicSizeBinding(target: HTMLElement): boolean {
  return dynamicControlsEnabled
    && (isDynamicControlBinding(target.style.width) || isDynamicControlBinding(target.style.height))
}

function startInspectResize(e: PointerEvent, handle: InspectResizeHandle): void {
  if (!inspectResizeEnabled || selectedOverlayEntries.length !== 1) return
  const entry = selectedOverlayEntries.find((candidate) =>
    candidate.resizeHandles.some((resizeHandle) => resizeHandle === e.target),
  )
  if (!entry || hasDynamicSizeBinding(entry.target)) return
  const oid = entry.target.getAttribute('data-oid')
  if (!oid) return
  const props = domEvidenceManager.capture(entry.target)
  const rect = entry.target.getBoundingClientRect()
  const parent = entry.target.parentElement
  const parentRect = parent?.getBoundingClientRect() ?? null
  const parentStyle = parent ? getComputedStyle(parent) : null
  const targetStyle = getComputedStyle(entry.target)
  const parentProps = parent ? domEvidenceManager.capture(parent) : null
  const paddingLeft = parentStyle ? cssPixels(parentStyle.paddingLeft) : 0
  const paddingTop = parentStyle ? cssPixels(parentStyle.paddingTop) : 0
  const columnGap = parentStyle ? cssPixels(parentStyle.columnGap) : 0
  const rowGap = parentStyle ? cssPixels(parentStyle.rowGap) : 0
  const gridColumns = parentStyle ? resolvedGridTracks(parentStyle.gridTemplateColumns) : []
  const gridRows = parentStyle ? resolvedGridTracks(parentStyle.gridTemplateRows) : []
  const horizontalOffsetProperty = inspectResizeOffsetProperty(targetStyle, 'horizontal')
  const verticalOffsetProperty = inspectResizeOffsetProperty(targetStyle, 'vertical')
  const captureEl = e.target instanceof HTMLElement ? e.target : entry.outlineEl
  try { captureEl.setPointerCapture(e.pointerId) } catch { /* noop */ }
  activeInspectResize = {
    target: entry.target,
    captureEl,
    oid,
    instanceIndex: props.instanceIndex,
    handle,
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startWidth: rect.width,
    startHeight: rect.height,
    latestClientX: e.clientX,
    latestClientY: e.clientY,
    latestShiftKey: e.shiftKey,
    horizontalOffsetProperty,
    verticalOffsetProperty,
    startHorizontalOffset: inspectResizeStartOffset(
      entry.target,
      targetStyle,
      horizontalOffsetProperty,
      rect,
    ),
    startVerticalOffset: inspectResizeStartOffset(
      entry.target,
      targetStyle,
      verticalOffsetProperty,
      rect,
    ),
    beforeStyle: inspectResizeStyleBaseline(entry.target, targetStyle, [
      'width',
      'height',
      'flexBasis',
      'left',
      'top',
      'marginLeft',
      'marginTop',
    ]),
    originalStyleAttr: entry.target.getAttribute('style'),
    parent,
    parentOid: parent?.getAttribute('data-oid') ?? null,
    parentInstanceIndex: parentProps?.instanceIndex ?? 0,
    parentIsShared: parentProps?.isShared ?? false,
    parentBeforeStyle: parent && parentStyle
      ? inspectResizeStyleBaseline(parent, parentStyle, [
          'gridTemplateColumns',
          'gridTemplateRows',
        ])
      : {},
    originalParentStyleAttr: parent?.getAttribute('style') ?? null,
    parentDisplay: parentStyle?.display ?? '',
    parentFlexDirection: parentStyle?.flexDirection ?? '',
    columnGap,
    rowGap,
    gridColumns,
    gridRows,
    gridColumnIndex: parentRect
      ? gridTrackIndex(gridColumns, columnGap, parentRect.left + paddingLeft, rect.left + rect.width / 2)
      : 0,
    gridRowIndex: parentRect
      ? gridTrackIndex(gridRows, rowGap, parentRect.top + paddingTop, rect.top + rect.height / 2)
      : 0,
    rafId: null,
  }
}

function cancelInspectResize(): void {
  const resize = activeInspectResize
  if (!resize) return
  // A new drag may begin before the prior pointer-up handoff is consumed. Its
  // cancel path explicitly retires that timer before restoring this drag.
  consumeInspectStyleHandoff(resize.target)
  if (resize.rafId !== null) bridgeCancelAnimationFrame(resize.rafId)
  try { resize.captureEl.releasePointerCapture(resize.pointerId) } catch { /* noop */ }
  if (resize.originalStyleAttr === null) resize.target.removeAttribute('style')
  else resize.target.setAttribute('style', resize.originalStyleAttr)
  if (resize.parent) {
    if (resize.originalParentStyleAttr === null) resize.parent.removeAttribute('style')
    else resize.parent.setAttribute('style', resize.originalParentStyleAttr)
  }
  activeInspectResize = null
  positionSelectedOverlay()
}

/**
 * Store a handoff and arm the rollback that bounds its wait.
 *
 * The parent drops a mutation it cannot enqueue and sends nothing back, and a
 * message can be lost outright. The deadline is what keeps either from leaving
 * an unsaved value painted that no mutation log can revert, and from leaving
 * the handoff armed to hand its before-value to a later mutation on this node.
 *
 * `readPainted` re-reads the property this gesture painted; its value here is
 * the ownership mark. The rollback is skipped when it no longer matches, or
 * when the node has left the document, because a newer render or user mutation
 * owns the node by then. A mutate-dom that arrives after the deadline still
 * applies correctly: it reads the restored authored DOM, which is what it read
 * before handoffs existed.
 */
function stageOptimisticHandoff<T extends OptimisticHandoff>(
  handoffs: WeakMap<HTMLElement, T>,
  el: HTMLElement,
  payload: Omit<T, 'rollbackTimer'>,
  readPainted: () => string | null,
  restore: () => void,
): void {
  const existing = handoffs.get(el)
  if (existing) clearTimeout(existing.rollbackTimer)
  const painted = readPainted()
  const handoff = { ...payload } as T
  handoff.rollbackTimer = setTimeout(function () {
    if (handoffs.get(el) !== handoff) return
    handoffs.delete(el)
    if (!el.isConnected || readPainted() !== painted) return
    restore()
    positionSelectedOverlay()
  }, OPTIMISTIC_HANDOFF_TIMEOUT_MS)
  handoffs.set(el, handoff)
}

/** Take the handoff and disarm its rollback: the echo it waited for is here. */
function consumeOptimisticHandoff<T extends OptimisticHandoff>(
  handoffs: WeakMap<HTMLElement, T>,
  el: HTMLElement,
): T | null {
  const handoff = handoffs.get(el) ?? null
  if (!handoff) return null
  clearTimeout(handoff.rollbackTimer)
  handoffs.delete(el)
  return handoff
}

// Pointer-up hands the final drag geometry to the parent's ordinary optimistic
// edit pipeline. Keep that geometry painted until mutate-dom arrives; restoring
// the authored style here produced a visible b -> a -> b flash between the two
// cross-frame messages. The handoff preserves the true pre-drag attribute so
// the optimistic mutation can still roll back exactly on undo/save failure.
function stageInspectStyleHandoff(el: HTMLElement, prevStyleAttr: string | null): void {
  stageOptimisticHandoff(
    inspectStyleHandoffs,
    el,
    { prevStyleAttr },
    function () { return el.getAttribute('style') },
    function () {
      if (prevStyleAttr === null) el.removeAttribute('style')
      else el.setAttribute('style', prevStyleAttr)
    },
  )
}

function consumeInspectStyleHandoff(el: HTMLElement): InspectStyleHandoff | null {
  return consumeOptimisticHandoff(inspectStyleHandoffs, el)
}

// See onInspectMovePointerCancel: pointercancel must roll back, not commit.
function onInspectResizePointerCancel(e: PointerEvent): void {
  if (!activeInspectResize || e.pointerId !== activeInspectResize.pointerId) return
  cancelInspectResize()
}

function finishInspectResize(e: PointerEvent): void {
  const resize = activeInspectResize
  if (!resize || e.pointerId !== resize.pointerId) return
  stopInspectInteraction(e)
  if (resize.rafId !== null) bridgeCancelAnimationFrame(resize.rafId)
  // A pointer-up with no movement on the handle's active axis is a plain
  // click, not a resize — applyInspectResizeFrame() would still stamp the
  // element's current computed size as an explicit inline pixel value (e.g.
  // turning class/flex/grid-driven sizing into a fixed size) even though
  // nothing visually changed. Roll back instead of committing.
  const dx = resize.latestClientX - resize.startClientX
  const dy = resize.latestClientY - resize.startClientY
  const resizesFromLeft = resize.handle === 'nw' || resize.handle === 'sw' || resize.handle === 'w'
  const resizesFromTop = resize.handle === 'nw' || resize.handle === 'ne' || resize.handle === 'n'
  const resizesWidth = resize.handle !== 'n' && resize.handle !== 's'
  const resizesHeight = resize.handle !== 'e' && resize.handle !== 'w'
  const movedOnActiveAxis = (resizesWidth && dx !== 0) || (resizesHeight && dy !== 0)
  if (!movedOnActiveAxis) {
    cancelInspectResize()
    return
  }
  applyInspectResizeFrame()
  const rect = resize.target.getBoundingClientRect()
  const resizesGridColumns = resizesWidth && resize.parentDisplay === 'grid' && Boolean(resize.parentOid) && resize.gridColumns.length > 1
  const resizesGridRows = resizesHeight && resize.parentDisplay === 'grid' && Boolean(resize.parentOid) && resize.gridRows.length > 1
  const width = resizesWidth && !resizesGridColumns ? Math.round(rect.width) : undefined
  const height = resizesHeight && !resizesGridRows ? Math.round(rect.height) : undefined
  const horizontalOffsetProperty =
    resizesFromLeft && width !== undefined ? resize.horizontalOffsetProperty : null
  const verticalOffsetProperty =
    resizesFromTop && height !== undefined ? resize.verticalOffsetProperty : null
  const horizontalOffset = horizontalOffsetProperty
    ? cssPixels(resize.target.style[horizontalOffsetProperty])
    : undefined
  const verticalOffset = verticalOffsetProperty
    ? cssPixels(resize.target.style[verticalOffsetProperty])
    : undefined
  const flexBasis =
    (width !== undefined && resize.parentDisplay === 'flex' && resize.parentFlexDirection.startsWith('row')) ||
    (height !== undefined && resize.parentDisplay === 'flex' && resize.parentFlexDirection.startsWith('column'))
      ? width ?? height
      : undefined
  const flexBasisDimension = flexBasis === undefined
    ? undefined
    : resize.parentFlexDirection.startsWith('row')
      ? 'width' as const
      : 'height' as const
  const parentStylePatch: Record<string, string> = {}
  const parentBeforeStyle: Record<string, string> = {}
  if (resizesGridColumns && resize.parent) {
    parentStylePatch.gridTemplateColumns = resize.parent.style.gridTemplateColumns
    parentBeforeStyle.gridTemplateColumns = resize.parentBeforeStyle.gridTemplateColumns ?? ''
  }
  if (resizesGridRows && resize.parent) {
    parentStylePatch.gridTemplateRows = resize.parent.style.gridTemplateRows
    parentBeforeStyle.gridTemplateRows = resize.parentBeforeStyle.gridTemplateRows ?? ''
  }
  const parentEdit = resize.parentOid && Object.keys(parentStylePatch).length > 0
    ? {
        oid: resize.parentOid,
        ...(resize.parentIsShared ? { instanceIndex: resize.parentInstanceIndex } : {}),
        style: parentStylePatch,
        beforeStyle: parentBeforeStyle,
      }
    : undefined
  const beforeStyle = {
    ...(width !== undefined ? {
      width: resize.beforeStyle.width ?? '',
      ...(horizontalOffsetProperty
        ? { [horizontalOffsetProperty]: resize.beforeStyle[horizontalOffsetProperty] ?? '' }
        : {}),
      ...(flexBasis !== undefined && flexBasisDimension === 'width'
        ? { flexBasis: resize.beforeStyle.flexBasis ?? '' }
        : {}),
    } : {}),
    ...(height !== undefined ? {
      height: resize.beforeStyle.height ?? '',
      ...(verticalOffsetProperty
        ? { [verticalOffsetProperty]: resize.beforeStyle[verticalOffsetProperty] ?? '' }
        : {}),
      ...(flexBasis !== undefined && flexBasisDimension === 'height'
        ? { flexBasis: resize.beforeStyle.flexBasis ?? '' }
        : {}),
    } : {}),
  }
  const props = domEvidenceManager.capture(resize.target)
  try { resize.captureEl.releasePointerCapture(e.pointerId) } catch { /* noop */ }
  if (width !== undefined || height !== undefined) {
    stageInspectStyleHandoff(resize.target, resize.originalStyleAttr)
  }
  if (parentEdit && resize.parent) {
    stageInspectStyleHandoff(resize.parent, resize.originalParentStyleAttr)
  }
  activeInspectResize = null
  positionSelectedOverlay()
  post({
    source: 'mercury-bridge',
    type: 'element-resize-commit',
    oid: resize.oid,
    width,
    height,
    flexBasis,
    flexBasisDimension,
    horizontalOffsetProperty,
    horizontalOffset,
    verticalOffsetProperty,
    verticalOffset,
    instanceIndex: resize.instanceIndex,
    beforeStyle,
    props,
    parentEdit,
  })
}

function stopInspectInteraction(e: Event): void {
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()
}

function isAdditiveSelectionEvent(e: MouseEvent | PointerEvent): boolean {
  return e.shiftKey || e.metaKey || e.ctrlKey
}

/**
 * Overflow values that clip descendants. "visible" does not; "overlay" is a
 * legacy alias for "auto" that some engines still report.
 */
const CLIPPING_OVERFLOW = /^(hidden|scroll|auto|clip|overlay)$/

/**
 * Bring a programmatically-selected element into view.
 *
 * Selecting from the Layers panel is the one path where the user has NOT just
 * clicked the element, so it may be anywhere in the document — including inside
 * a nested scroller. Drawing the selection ring on a node that is scrolled out
 * of sight looks like the click did nothing.
 *
 * Deliberately a no-op when the element is already fully visible: scrolling a
 * row the user can already see is disorienting, and Layers selection is often
 * used to step through siblings that are all on screen together.
 */
type InspectVisibleBox = { top: number; left: number; bottom: number; right: number }

function inspectVisibleBox(target: HTMLElement): InspectVisibleBox {
  // Start from the viewport, then shrink by every clipping ancestor. Anything
  // outside the result is hidden even if it sits inside the viewport.
  let top = 0
  let left = 0
  let bottom = window.innerHeight || document.documentElement.clientHeight || 0
  let right = window.innerWidth || document.documentElement.clientWidth || 0

  let node: HTMLElement | null = target.parentElement
  while (node && node !== document.documentElement) {
    let clips = false
    try {
      const cs = window.getComputedStyle(node)
      clips = CLIPPING_OVERFLOW.test(cs.overflowX) || CLIPPING_OVERFLOW.test(cs.overflowY)
    } catch {
      // Detached or cross-document node — treat as non-clipping rather than
      // abandoning the walk, so ancestors above it are still considered.
      clips = false
    }
    if (clips) {
      // Border box, not padding box: it over-estimates the visible area by the
      // scrollbar gutter. That errs toward scrolling slightly less often, and
      // scrollIntoView is idempotent when it does fire, so the cost is bounded
      // to a few pixels at the edge.
      const r = node.getBoundingClientRect()
      if (r.top > top) top = r.top
      if (r.left > left) left = r.left
      if (r.bottom < bottom) bottom = r.bottom
      if (r.right < right) right = r.right
    }
    node = node.parentElement
  }
  return { top, left, bottom, right }
}

function scrollInspectTargetIntoView(target: HTMLElement): void {
  const rect = target.getBoundingClientRect()
  // display:none / detached: nothing to reveal, and scrollIntoView on a
  // zero-box element scrolls to an arbitrary position.
  if (rect.width <= 0 && rect.height <= 0) return

  // Visibility is judged against the intersection of the viewport with every
  // clipping ancestor, NOT the viewport alone. A child at y=400 inside a
  // scroller whose visible area ends at y=300 is hidden, even though its rect
  // sits comfortably inside an 800px viewport — checking only the viewport
  // would take the early return and leave the selection ring out of sight, in
  // exactly the nested-scroller case this function exists to handle.
  const visible = inspectVisibleBox(target)
  const fullyVisible =
    rect.top >= visible.top &&
    rect.left >= visible.left &&
    rect.bottom <= visible.bottom &&
    rect.right <= visible.right
  if (fullyVisible) return

  // An element taller than the space available to it can never be "centred"
  // usefully — centring hides both its edges. Align to its start instead,
  // which is where the selection label and the resize handles are drawn. A
  // degenerate box (a collapsed or fully off-screen ancestor) also lands here.
  const visibleHeight = visible.bottom - visible.top
  const block: ScrollLogicalPosition =
    visibleHeight <= 0 || rect.height >= visibleHeight ? 'start' : 'center'

  let behavior: ScrollBehavior = 'smooth'
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) behavior = 'auto'
  } catch { /* matchMedia unavailable — keep the default */ }

  try {
    // Walks every scrollable ancestor, so an element inside a nested overflow
    // container is revealed too. Confined to this document: an iframe cannot
    // scroll its parent, so the canvas is never moved out from under the user.
    target.scrollIntoView({ block, inline: 'nearest', behavior })
  } catch {
    // Older engines reject the options object; the boolean form still helps.
    target.scrollIntoView(true)
  }
  // The overlay follows scroll via onFrameScroll, but a smooth scroll settles
  // over several frames — sync once now so the ring is not left behind for the
  // first frame, and let the scroll listener track the rest.
  schedulePositionSync()
}

function selectInspectTarget(
  target: HTMLElement,
  append = false,
  event?: MouseEvent,
  oidTarget: HTMLElement = target,
  keyboardDirection?: InspectHierarchyDirection,
): void {
  const oid = oidTarget.getAttribute('data-oid')
  if (!oid) return
  // Both PointerEvent types count. Pointer-down is the usual path, but an
  // unactivated move selects on pointer-up -- the press inside a selected
  // container that turned out to be a click on a descendant -- and that is just
  // as much a pointer selection: it has a real position, and it must take focus
  // the same way, or Shift+Enter afterwards never reaches the bridge because
  // focus is still in whatever Properties field the user came from.
  const isPointerSelection = Boolean(
    event && (event.type === 'pointerdown' || event.type === 'pointerup' || event.detail > 0),
  )
  if (cursorMode === 'inspect' && isPointerSelection) {
    // Inspect prevents the pointer's native focus change. Explicitly clear any
    // previously focused generated-app control, then focus this browsing
    // context so subsequent Tab presses reach the inspect key handler.
    const activeElement = document.activeElement as HTMLElement | null
    if (
      activeElement &&
      activeElement !== document.body &&
      typeof activeElement.blur === 'function'
    ) activeElement.blur()
    try { window.focus() } catch { /* focus may be denied by the embedder */ }
  }
  if (cursorMode !== 'comment') setSelectedTarget(target, append)
  // Hide the hover overlay so the selection ring shows cleanly on the
  // click target (the next pointermove will bring hover back if the
  // cursor moves to a different element).
  hideOverlay()
  let point: { xRatio: number; yRatio: number } | undefined
  // A real PointerEvent has detail === 0, so detail cannot decide whether an
  // event carries a usable pointer position -- its type does. Keyboard-initiated
  // click events still retain the marker's top-right fallback.
  if (event && isPointerSelection) {
    const rect = target.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1)
      point = {
        xRatio: clamp01((event.clientX - rect.left) / rect.width),
        yRatio: clamp01((event.clientY - rect.top) / rect.height),
      }
    }
  }
  post({
    source: 'mercury-bridge',
    type: 'element-selected',
    oid,
    append,
    props: domEvidenceManager.capture(target),
    ...(point ? { point } : {}),
    ...(keyboardDirection ? { inputType: 'keyboard', direction: keyboardDirection } : {}),
  })
}

function isInlineTextEventTarget(value: EventTarget | null): boolean {
  const active = activeInlineTextEdit
  // Native editing events for a direct Text node target its contenteditable
  // host. Authored child elements are deliberately excluded so clicking one
  // exits the parent edit and lets Inspect select that child normally.
  return Boolean(
    active &&
    value instanceof Node &&
    active.editingHost.contains(value) &&
    !isProtectedInlineNode(value, active.target),
  )
}

type DynamicTextSourceKind = 'text' | 'expression';

type DynamicTextSourceTarget = {
  token: string;
  sourceIndex: number;
  sourceKind: DynamicTextSourceKind;
};

function isDynamicTextSourceToken(token: string): boolean {
  return token === 'text'
    || /^element:[a-z][a-z0-9-]*$/.test(token)
    || /^expression:[a-f0-9]{12}$/.test(token);
}

function dynamicTextSourceTargetForSegment(
  tokens: readonly string[],
  textSegmentIndex: number,
): DynamicTextSourceTarget | null {
  if (
    !Number.isInteger(textSegmentIndex)
    || textSegmentIndex < 0
    || !tokens.every(isDynamicTextSourceToken)
  ) return null;

  let currentTextIndex = 0;
  for (let sourceIndex = 0; sourceIndex < tokens.length; sourceIndex += 1) {
    const token = tokens[sourceIndex];
    if (!token || token.startsWith('element:')) continue;
    if (currentTextIndex === textSegmentIndex) {
      return {
        token,
        sourceIndex,
        sourceKind: token === 'text' ? 'text' : 'expression',
      };
    }
    currentTextIndex += 1;
  }
  return null;
}
/** Data-only POC contract. Shared with the web renderer; no runtime dependencies. */
const DYNAMIC_CONTROLS_ATTRIBUTE = 'data-mercury-controls';
const DYNAMIC_CONTROLS_MAX_LENGTH = 8192;
const DYNAMIC_CONTROL_PREFIX = '--mercury-control-';
const DYNAMIC_CONTROLS_SOURCE_ATTRIBUTE = 'data-oid-controls';
const DYNAMIC_FEATURE_LIMIT = 64;

/** Protect bindings even when the editor feature is off. */
function isDynamicControlBinding(value: unknown): boolean {
  return typeof value === 'string' && new RegExp('var\\(\\s*' + DYNAMIC_CONTROL_PREFIX, 'i').test(value);
}

// The contract declares what kind of VALUE a control holds, never which widget
// edits it; Mercury picks the UI per type. Version 1 widget names (`slider`,
// `select`) are still read as `number` / `choice`.
type NumberUnit = '' | 'px' | 's' | 'ms' | 'deg' | '%';
type DynamicControl = {
  id: string;
  label: string;
  property: string;
} & (
  /** A static quantity. */
  | { type: 'number'; min: number; max: number; step: number; unit: NumberUnit }
  /** One of a fixed set of CSS tokens. */
  | { type: 'choice'; options: Array<{ label: string; value: string }> }
  /** A three- or six-digit hex color. */
  | { type: 'color' }
  /** One of a fixed set of single CSS font-family names. */
  | { type: 'font'; options: Array<{ label: string; value: string }> }
  /** A timing function y(t), t in [0, 1], as a CSS <easing-function>. */
  | { type: 'easing' }
);
type DynamicControls = { version: 1 | 2; title: string; controls: DynamicControl[] };

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const label = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 80;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000;
const hexColor = (v: unknown): v is string => typeof v === 'string' && /^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/.test(v);
const fontFamily = (v: unknown): v is string => typeof v === 'string' && v === v.trim() && /^[a-zA-Z][a-zA-Z0-9 -]{0,63}$/.test(v) && !/^(inherit|initial|unset|revert|revert-layer|default)$/i.test(v);
const token = (v: unknown): v is string => typeof v === 'string' && v === v.trim() && /^[a-zA-Z0-9#.,% _-]{1,64}$/.test(v);
const TYPE_ALIASES: Record<string, string> = { slider: 'number', select: 'choice' };

function parseDynamicControls(raw: unknown): DynamicControls | null {
  if (typeof raw !== 'string' || raw.length > DYNAMIC_CONTROLS_MAX_LENGTH) return null;
  try {
    const doc: unknown = JSON.parse(raw);
    if (!object(doc) || (doc.version !== 1 && doc.version !== 2) || !label(doc.title) || !Array.isArray(doc.controls)
      || doc.controls.length < 1 || doc.controls.length > 8) return null;
    const ids = new Set<string>();
    const properties = new Set<string>();
    const controls: DynamicControl[] = [];
    for (const c of doc.controls) {
      if (!object(c) || typeof c.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(c.id)
        || !label(c.label) || typeof c.property !== 'string'
        || !/^--mercury-control-[a-z][a-z0-9-]{0,39}$/.test(c.property)
        || ids.has(c.id) || properties.has(c.property)) return null;
      ids.add(c.id); properties.add(c.property);
      const type = TYPE_ALIASES[String(c.type)] ?? c.type;
      const base = { id: c.id, label: c.label, property: c.property };
      if (type === 'number') {
        if (!finite(c.min) || !finite(c.max) || !finite(c.step) || c.min >= c.max || c.step <= 0
          || c.step > c.max - c.min
          || Math.abs((c.max - c.min) / c.step - Math.round((c.max - c.min) / c.step)) >= 0.00001 || !['', 'px', 's', 'ms', 'deg', '%'].includes(String(c.unit))) return null;
        controls.push({ ...base, type, min: c.min, max: c.max, step: c.step, unit: c.unit as NumberUnit });
      } else if (type === 'choice' || type === 'font') {
        const valid = type === 'font' ? fontFamily : token;
        if (!Array.isArray(c.options) || c.options.length < 2 || c.options.length > 12
          || c.options.some((o: unknown) => !object(o) || !label(o.label) || !valid(o.value))) return null;
        const options = (c.options as Array<{ label: string; value: string }>)
          .map(o => ({ label: o.label, value: o.value }));
        // Font families are case-insensitive in CSS.
        if (new Set(options.map(o => type === 'font' ? o.value.toLowerCase() : o.value)).size !== options.length) return null;
        controls.push({ ...base, type, options });
      } else if (type === 'color' || type === 'easing') {
        // No extra fields: the value type alone determines the editor. Color has
        // no agent-supplied palette (one consistent Mercury color UI).
        controls.push({ ...base, type });
      } else return null;
    }
    return { version: doc.version, title: doc.title, controls };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Easing values: the CSS standard forms, so the browser runs them natively.
//   cubic-bezier(x1, y1, x2, y2)  a formula with two control points
//   linear(y [x%], ...)           sampled points (springs, bounces)
//   linear | ease | ease-in | ease-out | ease-in-out
// ---------------------------------------------------------------------------

const EASING_MAX_LENGTH = 1024;
/** Output (y) bound; wide enough for overshoot/anticipation, narrow enough to stay sane. */
const EASING_Y_MIN = -2;
const EASING_Y_MAX = 3;
const MAX_LINEAR_STOPS = 32;

type Easing =
  | { kind: 'bezier'; points: [number, number, number, number] }
  /** Stops with every x resolved (0..1), in order. */
  | { kind: 'linear'; stops: Array<{ x: number; y: number }> };

const EASING_KEYWORDS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const num = (s: string): number | null => (NUMBER.test(s) ? Number(s) : null);
const pct = (s: string): number | null => (s.endsWith('%') ? num(s.slice(0, -1)) : null);
const inY = (y: number): boolean => y >= EASING_Y_MIN && y <= EASING_Y_MAX;

function parseEasing(value: unknown): Easing | null {
  if (typeof value !== 'string' || value.length > EASING_MAX_LENGTH) return null;
  const v = value.trim().toLowerCase();
  const keyword = Object.prototype.hasOwnProperty.call(EASING_KEYWORDS, v) ? EASING_KEYWORDS[v] : undefined;
  if (keyword) return { kind: 'bezier', points: [...keyword] };
  const call = /^(cubic-bezier|linear)\(([^()]*)\)$/.exec(v);
  if (!call) return null;
  const args = (call[2] ?? '').split(',').map(a => a.trim());
  if (call[1] === 'cubic-bezier') {
    const [x1, y1, x2, y2] = args.map(num);
    if (args.length !== 4 || x1 == null || y1 == null || x2 == null || y2 == null) return null;
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1 || !inY(y1) || !inY(y2)) return null;
    return { kind: 'bezier', points: [x1, y1, x2, y2] };
  }
  if (args.length < 2 || args.length > MAX_LINEAR_STOPS) return null;
  // Each stop: `y`, `y x%`, or `y x1% x2%` (two positions = a flat segment).
  const ys: number[] = [];
  const xs: Array<number | null> = [];
  for (const arg of args) {
    const [first = '', ...positions] = arg.split(/\s+/);
    const y = num(first);
    if (y === null || !inY(y) || positions.length > 2) return null;
    if (!positions.length) { ys.push(y); xs.push(null); }
    for (const position of positions) {
      const x = pct(position);
      if (x === null || x < 0 || x > 100) return null;
      ys.push(y); xs.push(x / 100);
    }
  }
  // CSS rules: first/last default to 0/1, positions never go backwards, and
  // runs of unpositioned stops are spread evenly between their neighbours.
  const n = xs.length;
  if (xs[0] == null) xs[0] = 0;
  if (xs[n - 1] == null) xs[n - 1] = 1;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    if (x != null) { last = Math.max(x, last); xs[i] = last; }
  }
  const stops: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    if (xs[i] == null) {
      let j = i;
      while (xs[j] == null) j++; // terminates: the last stop is positioned
      const from = xs[i - 1] ?? 0;
      const to = xs[j] ?? 1;
      for (let k = i; k < j; k++) xs[k] = from + ((to - from) * (k - i + 1)) / (j - i + 1);
    }
    stops.push({ x: xs[i] ?? 0, y: ys[i] ?? 0 });
  }
  return { kind: 'linear', stops };
}

const round = (n: number): number => Number(n.toFixed(3));
function formatBezier([x1, y1, x2, y2]: [number, number, number, number]): string {
  return `cubic-bezier(${round(x1)}, ${round(y1)}, ${round(x2)}, ${round(y2)})`;
}

/** Validate the serialized CSS value, including its unit, on both client and server. */
function acceptsDynamicValue(control: DynamicControl, value: unknown): value is string {
  if (control.type === 'easing') return parseEasing(value) !== null;
  if (typeof value !== 'string' || value.length > 64) return false;
  if (control.type === 'color') return hexColor(value);
  if (control.type === 'choice' || control.type === 'font') return control.options.some(o => o.value === value);
  if (control.unit && !value.endsWith(control.unit)) return false;
  const raw = control.unit ? value.slice(0, -control.unit.length) : value;
  if (!NUMBER.test(raw)) return false;
  const n = Number(raw);
  const steps = (n - control.min) / control.step;
  return Number.isFinite(n) && n >= control.min && n <= control.max
    && Math.abs(steps - Math.round(steps)) < 0.00001;
}

function validateDynamicControlWrite(raw: unknown, values: Record<string, unknown>): string | null {
  const keys = Object.keys(values).filter(key => key.startsWith(DYNAMIC_CONTROL_PREFIX));
  if (!keys.length) return null;
  const contract = parseDynamicControls(raw);
  if (!contract) return 'Dynamic controls changed or are unavailable. Ask the agent to prepare them again.';
  for (const key of keys) {
    const control = contract.controls.find(c => c.property === key);
    if (!control || !acceptsDynamicValue(control, values[key])) return `Unsupported dynamic control value for ${key}`;
  }
  return null;
}


function canEditDynamicTextSourceTarget(
  target: { sourceKind: 'text' | 'expression' } | null,
  isShared: boolean,
): boolean {
  return target !== null && (target.sourceKind !== 'text' || !isShared)
}

function readDynamicTextSourceTokens(target: HTMLElement): string[] | null {
  const structure = target.getAttribute('data-oid-text-source')
  const tokens = structure?.split('|') ?? []
  if (
    !structure ||
    structure.length > 2000 ||
    !tokens.every(isDynamicTextSourceToken)
  ) return null
  // Validate the complete direct-child shape, including intrinsic element
  // siblings. This lets a dynamic label beside a separator element target the
  // binding while expressions that unexpectedly render null, fragments, or
  // elements still fail closed.
  const liveStructure = readDirectTextStructure(target)
  const liveTokens = liveStructure ? liveStructure.split('|') : []
  if (
    tokens.length !== liveTokens.length ||
    tokens.some((token, index) => (
      token.startsWith('element:') ? token !== liveTokens[index] : liveTokens[index] !== 'text'
    ))
  ) return null
  return tokens.some((token) => token.startsWith('expression:')) ? tokens : null
}

function isSafeInlineTextTarget(target: HTMLElement): boolean {
  if (!inlineTextEditEnabled) return false
  if (
    target.getAttribute('data-oid-text-editable') === 'false' &&
    !readDynamicTextSourceTokens(target)
  ) return false
  if (isSafeInlinePlaceholderTarget(target)) return true
  const directText = readDirectText(target)
  if (directText.trim().length === 0 || directText.length > 10000) return false
  if (readDirectTextSegments(target).length === 0) return false
  return !target.matches(
    'input, textarea, select, option, script, style, template, img, svg, video, audio, canvas, iframe',
  )
}

function isSafeInlinePlaceholderTarget(
  target: HTMLElement,
): target is HTMLInputElement | HTMLTextAreaElement {
  if (!target.hasAttribute('placeholder')) return false
  if ((target.getAttribute('placeholder') || '').length > 10000) return false
  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLTextAreaElement)
  ) return false
  const dynamicAttributes = (target.getAttribute('data-oid-attr-dynamic') || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
  if (dynamicAttributes.includes('placeholder')) return false
  if (target.disabled || target.readOnly) return false
  if (target instanceof HTMLTextAreaElement) return true
  // Same reason as formatTargetLabel: .type is already lower-cased and already
  // carries HTML's fallback to 'text' for anything it cannot parse, so an
  // unparseable type keeps the placeholder editing a text field deserves.
  return INLINE_PLACEHOLDER_INPUT_TYPES.has(target.type)
}

function readDirectText(target: HTMLElement): string {
  let text = ''
  for (let i = 0; i < target.childNodes.length; i++) {
    const child = target.childNodes[i]
    if (child.nodeType === 3 /* TEXT_NODE */) text += child.nodeValue || ''
  }
  return text
}

function readDirectTextSegments(target: HTMLElement): BridgeDirectTextSegment[] {
  const segments: BridgeDirectTextSegment[] = []
  for (let i = 0; i < target.childNodes.length; i++) {
    const child = target.childNodes[i]
    if (child.nodeType !== 3 /* TEXT_NODE */) continue
    const text = child.nodeValue || ''
    if (text.trim().length === 0) continue
    segments.push({ index: segments.length, domIndex: i, text })
  }
  return segments
}

function pointFallsInsideTextNode(
  textNode: Text,
  clientX: number,
  clientY: number,
): boolean {
  const range = document.createRange()
  range.selectNodeContents(textNode)
  const rects = Array.from(range.getClientRects())
  range.detach?.()
  return rects.some((rect) => (
    clientX >= rect.left - 2 &&
    clientX <= rect.right + 2 &&
    clientY >= rect.top - 2 &&
    clientY <= rect.bottom + 2
  ))
}

/** Resolve the direct Text node beneath a double-click to its guarded source segment. */
function directTextSegmentAtPoint(
  target: HTMLElement,
  clientX?: number,
  clientY?: number,
): BridgeDirectTextSegment | null {
  const segments = readDirectTextSegments(target)
  if (segments.length === 0) return null
  if (typeof clientX !== 'number' || typeof clientY !== 'number') {
    return segments.length === 1 ? segments[0] ?? null : null
  }

  const caretDocument = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const caretNode = caretDocument.caretPositionFromPoint?.(clientX, clientY)?.offsetNode
    ?? caretDocument.caretRangeFromPoint?.(clientX, clientY)?.startContainer
    ?? null
  if (caretNode?.nodeType === 3 /* TEXT_NODE */ && caretNode.parentNode === target) {
    const domIndex = Array.prototype.indexOf.call(target.childNodes, caretNode) as number
    const segment = segments.find((candidate) => candidate.domIndex === domIndex)
    if (segment && pointFallsInsideTextNode(caretNode as Text, clientX, clientY)) return segment
  }

  // Caret APIs may return the parent at a text-node boundary. Geometry is a
  // bounded fallback over direct segments only, and still requires the point
  // to fall on a rendered text rect rather than snapping from empty space.
  for (const segment of segments) {
    const node = target.childNodes[segment.domIndex]
    if (
      node?.nodeType === 3 /* TEXT_NODE */ &&
      pointFallsInsideTextNode(node as Text, clientX, clientY)
    ) return segment
  }
  return null
}

function shouldEditDirectTextSegment(
  target: HTMLElement,
  segments: BridgeDirectTextSegment[],
): boolean {
  if (segments.length > 1) return true
  let directTextNodeCount = 0
  for (let i = 0; i < target.childNodes.length; i++) {
    const child = target.childNodes[i]
    if (child.nodeType === 1 /* ELEMENT_NODE */) return true
    if (child.nodeType === 3 /* TEXT_NODE */) directTextNodeCount += 1
  }
  return directTextNodeCount > 1
}

function readDirectTextStructure(target: HTMLElement): string {
  const tokens: string[] = []
  for (let i = 0; i < target.childNodes.length; i++) {
    const child = target.childNodes[i]
    if (child.nodeType === 3 /* TEXT_NODE */) {
      if ((child.nodeValue || '').trim().length > 0) tokens.push('text')
    } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
      tokens.push('element:' + (child as Element).tagName.toLowerCase())
    }
  }
  return tokens.join('|')
}

function readInlineText(active: ActiveInlineTextEdit): string {
  if (active.editTarget === 'placeholder') return active.editingHost.value
  let text = ''
  const append = (node: Node): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      text += node.nodeValue || ''
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.getAttribute('data-mercury-inline-protected') === 'true') return
    if (node.tagName === 'BR') {
      text += '\n'
      return
    }
    const startsAt = text.length
    for (let i = 0; i < node.childNodes.length; i++) append(node.childNodes[i])
    if (
      /^(DIV|P)$/.test(node.tagName) &&
      text.length > startsAt &&
      !text.endsWith('\n')
    ) text += '\n'
  }
  for (let i = 0; i < active.editingHost.childNodes.length; i++) {
    append(active.editingHost.childNodes[i])
  }
  return text
}

function inlineTextProps(active: ActiveInlineTextEdit, text: string): BridgeProps {
  // Selection metadata (including the site-wide typography scan and computed
  // styles) is stable for one inline-edit session. Reuse the snapshot captured
  // at edit start so an input event only reads the active text node instead of
  // scanning up to 1,000 stamped elements on every keystroke.
  const props = { ...active.baseProps }
  if (active.editTarget === 'placeholder') {
    props.attributes = { ...props.attributes, placeholder: text }
    return props
  }
  props.textContent = (active.target.textContent || '').slice(0, 200)
  if (active.textSegment) {
    props.directTextSegments = props.directTextSegments.map((segment) => (
      segment.index === active.textSegment?.index ? { ...segment, text } : segment
    ))
    props.directText = active.originalChildNodes.map((child, domIndex) => {
      if (child.nodeType !== 3 /* TEXT_NODE */) return ''
      if (domIndex === active.textSegment?.domIndex) return text
      return active.originalTextValues.get(child as Text) ?? child.nodeValue ?? ''
    }).join('')
  } else {
    props.directText = text
    props.hasNonTextChildren = active.protectedChildren.length > 0
  }
  props.directTextTruncated = false
  return props
}

// Match the parent queue's typing-burst boundary. The bridge observes the
// actual contenteditable input cadence, so it creates the rollback transaction
// here before handing the already-applied draft to Mercury history.
const INLINE_TEXT_HISTORY_IDLE_MS = 1_000

function inlineTextHistoryNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function beginInlineTextHistoryBurst(active: ActiveInlineTextContentEdit): string {
  const now = inlineTextHistoryNow()
  if (
    active.activeHistoryMutationId === null ||
    active.lastHistoryInputAt === null ||
    now - active.lastHistoryInputAt > INLINE_TEXT_HISTORY_IDLE_MS
  ) {
    let mutationId = ''
    do {
      inlineTextHistorySequence += 1
      mutationId =
        'inline-text-' + Date.now().toString(36) + '-' + inlineTextHistorySequence.toString(36)
    } while (mutationLog.has(mutationId))
    active.activeHistoryMutationId = mutationId
    active.activeHistoryBeforeText = active.lastPublishedText
    active.historyMutationIds.push(mutationId)
    // Native contenteditable has already applied this input by the time the
    // input event fires. lastPublishedText is the exact text from the prior
    // input, which is the correct baseline for this burst's Undo step.
    //
    // A burst holds its before-value as one string rather than a per-node map,
    // so it repaints instead of writing captured nodes back. The authored
    // children are the right structural baseline even though the session is
    // still open: a revert only ever arrives after the session tore down and
    // put them back, whereas the live children include the segment editing
    // host, which is gone by then.
    const burstTarget = active.target
    const burstChildNodes = active.originalChildNodes.slice()
    const burstPaint = directTextPainter(burstTarget, active.textSegment?.domIndex ?? null)
    const burstText = active.lastPublishedText
    mutationLog.set(mutationId, [{
      op: 'setText',
      el: burstTarget,
      restore: function (): boolean {
        return restorePaintedDirectText(burstTarget, burstChildNodes, burstPaint, burstText)
      },
    }])
  }
  active.lastHistoryInputAt = now
  return active.activeHistoryMutationId
}

function inlineTextHistoryHtml(active: ActiveInlineTextContentEdit, text: string): string {
  if (!active.textSegment) return active.target.innerHTML
  const clone = active.target.cloneNode(true) as HTMLElement
  const editor = clone.querySelector('[data-mercury-inline-segment-editor="true"]')
  if (editor) editor.replaceWith(document.createTextNode(text))
  return clone.innerHTML
}

function publishInlineTextDraft(): void {
  const active = activeInlineTextEdit
  if (!active) return
  const text = readInlineText(active)
  const mutationId = active.editTarget === 'text'
    ? beginInlineTextHistoryBurst(active)
    : null
  post({
    source: 'mercury-bridge',
    type: 'inline-text-draft',
    oid: active.oid,
    text,
    editTarget: active.editTarget,
    props: inlineTextProps(active, text),
    ...(active.editTarget === 'text' && active.textSegment
      ? { textSegment: active.textSegment }
      : {}),
    ...(mutationId ? { mutationId } : {}),
    ...(active.editTarget === 'placeholder'
      ? { historyBeforeText: active.originalText }
      : active.activeHistoryBeforeText !== null
        ? { historyBeforeText: active.activeHistoryBeforeText }
        : {}),
  })
  if (active.editTarget === 'text') {
    active.lastPublishedHtml = inlineTextHistoryHtml(active, text)
    active.lastPublishedText = text
  }
  positionSelectedOverlay()
}

function removeInlineTextListeners(active: ActiveInlineTextEdit): void {
  const editingHost: HTMLElement = active.editingHost
  editingHost.removeEventListener('input', onInlineTextInput)
  editingHost.removeEventListener('keydown', onInlineTextKeyDown)
  editingHost.removeEventListener('blur', onInlineTextBlur)
}

/**
 * Rewrite only an element's direct Text nodes, leaving every element child and
 * its slot alone. One surgery for three callers -- the mutate-dom setText
 * branch, the end of an inline edit, and a revert re-running it with the
 * before-value -- so the text the user sees while a commit is in flight is
 * byte-identical to the text the mutation applies and to the text a revert
 * puts back.
 */
function applyDirectTextEdit(el: HTMLElement, newText: string): void {
  let placed = false
  const toRemove: Node[] = []
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i]
    if (child.nodeType === 3 /* TEXT_NODE */) {
      if (!placed) {
        child.nodeValue = newText
        placed = true
      } else {
        toRemove.push(child)
      }
    }
  }
  for (let i = 0; i < toRemove.length; i++) {
    const n = toRemove[i]
    n.parentNode?.removeChild(n)
  }
  if (!placed) {
    el.appendChild(document.createTextNode(newText))
  }
}

/**
 * Whether an element's non-text children are still exactly the nodes captured
 * when a text mutation was recorded, in the same order.
 *
 * Text children are skipped deliberately: they are the slice a text edit owns,
 * so they are expected to differ. Everything else -- elements, comments -- must
 * match by node IDENTITY, not by markup, because identity is the thing a
 * restore has to preserve.
 */
function directTextSiblingsUnchanged(el: HTMLElement, expected: ChildNode[]): boolean {
  let expectedIndex = 0
  const skipText = function (): void {
    while (expectedIndex < expected.length && expected[expectedIndex]!.nodeType === 3) {
      expectedIndex += 1
    }
  }
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i]
    if (child.nodeType === 3 /* TEXT_NODE */) continue
    skipText()
    if (expected[expectedIndex] !== child) return false
    expectedIndex += 1
  }
  skipText()
  return expectedIndex === expected.length
}

/**
 * Whether an element's children are still, node for node, the list left behind
 * by a write -- the exact question 'has anyone else touched this since?'.
 *
 * Text nodes are compared by identity here, unlike directTextSiblingsUnchanged.
 * Restoring by reinstating captured nodes has to know that React has not
 * rendered new Text nodes of its own: they carry host fibers, and reattaching
 * the captured ones would detach them -- the same defect, one node type over.
 */
function childNodesUnchanged(el: HTMLElement, expected: ChildNode[]): boolean {
  if (el.childNodes.length !== expected.length) return false
  for (let i = 0; i < expected.length; i++) {
    if (el.childNodes[i] !== expected[i]) return false
  }
  return true
}

/**
 * Same contract as restoreDirectTextValues, for the caller that holds the
 * before-value as one string rather than a per-node map: an in-progress typing
 * burst knows only `lastPublishedText`. Repaints through the same writer the
 * forward edit used, so the restored DOM matches what the edit would have left.
 */
function restorePaintedDirectText(
  el: HTMLElement,
  prevChildNodes: ChildNode[],
  paint: (value: string) => void,
  text: string,
): boolean {
  if (!directTextSiblingsUnchanged(el, prevChildNodes)) return false
  paint(text)
  return true
}

/**
 * The writer a text restore should use for this element: a lone segment Text
 * node when the edit targeted one, otherwise the element's whole direct text.
 *
 * The segment node is resolved when the restore RUNS, not when it is captured.
 * During an inline session that slot holds the editing host rather than a Text
 * node; by the time a revert arrives the session has ended and the authored
 * child has been put back.
 */
function directTextPainter(
  el: HTMLElement,
  segmentDomIndex: number | null,
): (value: string) => void {
  if (segmentDomIndex === null) {
    return function (value: string): void {
      applyDirectTextEdit(el, value)
    }
  }
  return function (value: string): void {
    const node = el.childNodes[segmentDomIndex]
    if (node?.nodeType === 3 /* TEXT_NODE */) node.nodeValue = value
  }
}

type TextMutationRecorder = {
  snapshot: RecordedSnapshot
  /**
   * Freeze the child list the forward write left behind. Called straight after
   * that write, because only then is the baseline known: the write itself may
   * drop Text children, or append one where the element had none, and neither
   * can be predicted from the pre-edit list.
   */
  seal: () => void
}

/**
 * Record a text mutation so it can be undone without reparsing the element.
 *
 * The live DOM is usually still the pre-edit DOM at this point -- an inline
 * session rewinds to the authored children before asking for the mutation --
 * so the before-values can be read straight off it. The exception is a commit
 * that painted its text early: the authored CHILDREN are back, but the Text
 * nodes hold the committed value, so that caller passes the authored values it
 * kept in its handoff and only the child list is read live.
 *
 * The restore refuses unless the children are still EXACTLY what the write
 * left. Anything else means another writer has been here, and the only
 * writer that reaches into a Mercury-edited element is React: its render is
 * authoritative and has already replaced the optimistic text, so there is
 * nothing left to undo.
 */
function textMutationSnapshot(
  el: HTMLElement,
  authoredTextValues?: Map<Text, string> | null,
): TextMutationRecorder {
  const childNodes = Array.from(el.childNodes)
  const textValues = new Map<Text, string>()
  if (authoredTextValues) {
    for (const [textNode, value] of authoredTextValues) textValues.set(textNode, value)
  } else {
    for (const child of childNodes) {
      if (child.nodeType === 3 /* TEXT_NODE */) {
        textValues.set(child as Text, child.nodeValue ?? '')
      }
    }
  }
  let expected: ChildNode[] | null = null
  return {
    snapshot: {
      op: 'setText',
      el,
      restore: function (): boolean {
        if (!expected || !childNodesUnchanged(el, expected)) return false
        for (const [textNode, value] of textValues) textNode.nodeValue = value
        // The captured nodes are the original objects, so this reinstates
        // dropped Text children and their order without touching identity.
        el.replaceChildren(...childNodes)
        return true
      },
    },
    seal: function (): void {
      expected = Array.from(el.childNodes)
    },
  }
}

/**
 * The authored before-values of an element whose inline edit is committing,
 * handed to the mutate-dom that follows.
 *
 * Committing puts the authored child nodes back: a contenteditable gesture can
 * move or drop a React-owned child, and only the original node objects carry
 * its identity and listeners. It does NOT put the authored text back, because
 * mutate-dom only arrives on a later task and the old text would be painted in
 * the meantime -- committing an edit flashed new -> old -> new, and the reflow
 * gave the selection overlay a degenerate rect for a frame.
 *
 * So the children are rewound and the committed text is painted in the same
 * task, and the authored Text values travel out of band here. They are exactly
 * what textMutationSnapshot would have read off the element had nothing been
 * painted, which is what lets the mutation record an undo against the values
 * the user actually started from.
 *
 * Same shape as inspectStyleHandoffs, and sharing its rollback: the parent
 * drops a commit it cannot enqueue (oversized text, a stale selection,
 * component editing disabled) and sends nothing back.
 */
const inlineTextHandoffs = new WeakMap<HTMLElement, InlineTextHandoff>()

/**
 * Paint the committed text and arm its rollback.
 *
 * The restore re-runs the same surgical text write with the AUTHORED value
 * rather than assigning innerHTML, because the rewind above exists precisely to
 * keep the authored child nodes -- and their React identities -- intact.
 * Reparsing them here would undo the thing the commit path is careful to do.
 *
 * Painting and restoring are separate callbacks, not one function run with a
 * different argument: they differ in more than the text, since only the commit
 * decides white-space from it.
 */
function stageInlineTextHandoff(
  el: HTMLElement,
  authoredTextValues: Map<Text, string>,
  paintCommitted: (value: string) => void,
  restoreAuthored: (value: string) => void,
  committedText: string,
  originalText: string,
  segment: InlineTextCommitIdentity['segment'],
): void {
  paintCommitted(committedText)
  stageOptimisticHandoff(
    inlineTextHandoffs,
    el,
    { authoredTextValues, committedText, segment },
    function () { return el.innerHTML },
    function () { restoreAuthored(originalText) },
  )
}

/** Whether this handoff is the one a given mutate-dom echo is answering. */
function inlineTextHandoffAnswers(
  handoff: InlineTextHandoff | null,
  committedText: string,
  segment: { index: number; domIndex: number; expectedText: string } | null,
): boolean {
  if (!handoff || handoff.committedText !== committedText) return false
  if (!handoff.segment || !segment) return handoff.segment === null && segment === null
  return handoff.segment.index === segment.index &&
    handoff.segment.domIndex === segment.domIndex &&
    handoff.segment.expectedText === segment.expectedText
}

/**
 * Read the handoff without taking it.
 *
 * A guarded mutation must not consume what it may still reject: a stale or
 * out-of-order setTextSegment that fails its expected-text check would
 * otherwise disarm the rollback and steal the before-value from the commit
 * echo still in flight.
 */
function peekInlineTextHandoff(el: HTMLElement): InlineTextHandoff | null {
  return inlineTextHandoffs.get(el) ?? null
}

function consumeInlineTextHandoff(el: HTMLElement): InlineTextHandoff | null {
  return consumeOptimisticHandoff(inlineTextHandoffs, el)}

function finishInlineTextEdit(commit: boolean): void {
  const active = activeInlineTextEdit
  if (!active) return
  activeInlineTextEdit = null
  const text = readInlineText(active)
  const props = inlineTextProps(active, text)
  removeInlineTextListeners(active)
  if (active.editTarget === 'placeholder') {
    active.stopPositioning()
    active.editingHost.remove()
  } else {
    if (active.editingHost === active.target) {
      if (active.originalContentEditable === null) {
        active.target.removeAttribute('contenteditable')
      } else {
        active.target.setAttribute('contenteditable', active.originalContentEditable)
      }
    }
    for (const child of active.protectedChildren) {
      if (child.contentEditable === null) child.element.removeAttribute('contenteditable')
      else child.element.setAttribute('contenteditable', child.contentEditable)
      if (child.protectedMarker === null) {
        child.element.removeAttribute('data-mercury-inline-protected')
      } else {
        child.element.setAttribute('data-mercury-inline-protected', child.protectedMarker)
      }
    }
    // Put back the exact authored child nodes before either cancelling or
    // asking the parent to run its normal optimistic setText mutation. This
    // preserves React-owned element identities/listeners even if a browser
    // editing gesture temporarily removed a protected child from the DOM.
    for (const [textNode, value] of active.originalTextValues) textNode.nodeValue = value
    active.target.replaceChildren(...active.originalChildNodes)
    // The authored Text values, snapshotted off the freshly rewound DOM. This
    // is exactly what textMutationSnapshot would read if nothing were painted
    // over it, and unlike lastPublishedText (which tracks the latest draft) it
    // is not a keystroke behind. It is copied because the paint below is about
    // to overwrite the very nodes it maps.
    const authoredTextValues = new Map(active.originalTextValues)
    // The rewind above is for node identity, not for what the user sees. On a
    // commit, put the edited text straight back in the same task so the old
    // value is never painted while mutate-dom crosses the frame boundary, and
    // hand the authored values to that mutation instead of making it read a
    // DOM that no longer holds them. Cancels skip this and keep the rewind,
    // which is the whole point of cancelling.
    if (commit && text !== active.originalText) {
      const target = active.target
      const segmentNode = active.textSegment
        ? target.childNodes[active.textSegment.domIndex]
        : null
      const segmentTextNode = segmentNode?.nodeType === 3 /* TEXT_NODE */
        ? segmentNode
        : null
      const paintText = active.textSegment
        ? function (value: string): void {
            if (segmentTextNode) segmentTextNode.nodeValue = value
          }
        : function (value: string): void {
            applyDirectTextEdit(target, value)
          }
      // Line breaks were <br>/<div> children while the gesture was live; the
      // committed value is one Text node holding \n, which collapses onto one
      // line under the app's default white-space. The parent sends
      // whiteSpace: pre-wrap alongside a multi-line commit, but only on a later
      // task, so paint it here too or the edit reflows twice before it settles.
      const prevStyleAttr = target.getAttribute('style')
      const prevWhiteSpace = target.style.whiteSpace
      const paintCommitted = function (value: string): void {
        paintText(value)
        if (/[\r\n]/.test(value)) target.style.whiteSpace = 'pre-wrap'
      }
      // Rolling back restores the AUTHORED white-space rather than deciding
      // again from the text: authored text can hold newlines of its own, and
      // re-deciding would leave pre-wrap on an element that was authored
      // pre-line -- turning a declined commit into a style edit nobody made.
      const restoreAuthored = function (value: string): void {
        paintText(value)
        target.style.whiteSpace = prevWhiteSpace
      }
      stageInlineTextHandoff(
        target,
        authoredTextValues,
        paintCommitted,
        restoreAuthored,
        text,
        active.originalText,
        active.textSegment
          ? {
              index: active.textSegment.index,
              domIndex: active.textSegment.domIndex,
              expectedText: active.originalText,
            }
          : null,
      )
      // Hand the authored style attribute to that setStyle the same way the
      // text hands over its authored values, so the snapshot is the authored
      // value rather than the pre-wrap this just painted -- otherwise undo
      // restores a style attribute that still carries it.
      if (target.getAttribute('style') !== prevStyleAttr) {
        stageInspectStyleHandoff(target, prevStyleAttr)
      }
    }
  }
  active.target.removeAttribute('data-mercury-inline-editing')

  if (!commit || text === active.originalText) {
    const historyMutationIds = active.editTarget === 'text'
      ? active.historyMutationIds
      : []
    // Placeholder drafts update the parent selection snapshot even though the
    // authored control never changes. Publish an empty-transaction cancel too
    // so Escape (or returning to the original value) restores that snapshot.
    if (active.editTarget === 'placeholder' || historyMutationIds.length > 0) {
      post({
        source: 'mercury-bridge',
        type: 'inline-text-cancel',
        oid: active.oid,
        editTarget: active.editTarget,
        mutationIds: historyMutationIds,
        props: inlineTextProps(active, active.originalText),
      })
    }
    positionSelectedOverlay()
    return
  }

  // The committed text is already painted and the authored child nodes are
  // already back in place; what crosses here is the request to make it real.
  // The DOM this mutation will read holds the NEW text, so the true
  // before-value travels out of band in the handoff staged above, and the
  // mutation log takes it from there -- a failed source edit still rolls back
  // exactly.
  post({
    source: 'mercury-bridge',
    type: 'inline-text-commit',
    oid: active.oid,
    text,
    editTarget: active.editTarget,
    props,
    ...(active.editTarget === 'text' && active.textSegment
      ? { textSegment: active.textSegment }
      : {}),
    ...(active.editTarget === 'text' && active.activeHistoryMutationId
      ? { mutationId: active.activeHistoryMutationId }
      : {}),
    ...(active.editTarget === 'placeholder'
      ? { historyBeforeText: active.originalText }
      : active.activeHistoryBeforeText !== null
        ? { historyBeforeText: active.activeHistoryBeforeText }
        : {}),
  })
  positionSelectedOverlay()
}

function onInlineTextInput(e: Event): void {
  e.stopPropagation()
  publishInlineTextDraft()
}

type InspectHistoryShortcut = {
  action: 'undo' | 'redo'
  modifier: 'cmd' | 'ctrl'
  redoKey?: 'shift-z' | 'y'
}

function readInspectHistoryShortcut(e: KeyboardEvent): InspectHistoryShortcut | null {
  if ((!e.metaKey && !e.ctrlKey) || e.altKey || e.isComposing) return null
  const letter = e.key.toLowerCase()
  const isUndo = letter === 'z' && !e.shiftKey
  const isRedo = (letter === 'y' && !e.shiftKey) || (letter === 'z' && e.shiftKey)
  if (!isUndo && !isRedo) return null
  const modifier: 'cmd' | 'ctrl' = e.metaKey ? 'cmd' : 'ctrl'
  if (!isRedo) return { action: 'undo', modifier }
  return {
    action: 'redo',
    modifier,
    redoKey: letter === 'y' ? 'y' : 'shift-z',
  }
}

function postInspectHistoryShortcut(
  shortcut: InspectHistoryShortcut,
  resumeInlineEditing = false,
): void {
  post({
    source: 'mercury-bridge',
    type: 'history-shortcut',
    ...shortcut,
    ...(resumeInlineEditing ? { resumeInlineEditing: true as const } : {}),
  })
}

function onInlineTextKeyDown(e: KeyboardEvent): void {
  e.stopPropagation()
  if (e.key === 'Escape') {
    e.preventDefault()
    finishInlineTextEdit(false)
    return
  }
  if (
    activeInlineTextEdit?.editTarget === 'placeholder' &&
    activeInlineTextEdit.editingHost instanceof HTMLInputElement &&
    e.key === 'Enter' &&
    !e.isComposing
  ) {
    e.preventDefault()
    finishInlineTextEdit(true)
    return
  }

  // This contenteditable lives in a cross-origin iframe, so Mercury's parent
  // keydown listener cannot observe its Cmd/Ctrl+Z. Commit the aggregate draft
  // first, then forward the intent. postMessage preserves ordering, allowing
  // the parent to enqueue the commit before its direct-edit history handler
  // immediately undoes (or redoes) it. Suppressing the native action also
  // prevents the browser's private contenteditable history from diverging from
  // Mercury's source-backed edit queue.
  const shortcut = readInspectHistoryShortcut(e)
  if (!shortcut) return
  e.preventDefault()
  finishInlineTextEdit(true)
  postInspectHistoryShortcut(shortcut, true)
}

function onInlineTextBlur(): void {
  finishInlineTextEdit(true)
}

function isProtectedInlineNode(node: Node, target: HTMLElement): boolean {
  const element = node instanceof HTMLElement ? node : node.parentElement
  const protectedChild = element?.closest('[data-mercury-inline-protected="true"]')
  return Boolean(protectedChild && target.contains(protectedChild))
}

function placeInlineCaret(
  target: HTMLElement,
  clientX?: number,
  clientY?: number,
): void {
  window.focus()
  target.focus({ preventScroll: true })
  const caretDocument = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const pointRange = typeof clientX === 'number' && typeof clientY === 'number'
    ? caretDocument.caretRangeFromPoint?.(clientX, clientY) ?? null
    : null
  const range = pointRange &&
    target.contains(pointRange.startContainer) &&
    !isProtectedInlineNode(pointRange.startContainer, target)
    ? pointRange
    : (() => {
        const fallback = document.createRange()
        let lastEditableText: Text | null = null
        for (let i = target.childNodes.length - 1; i >= 0; i--) {
          const child = target.childNodes[i]
          if (child.nodeType === 3 /* TEXT_NODE */) {
            lastEditableText = child as Text
            break
          }
        }
        if (lastEditableText) {
          fallback.setStart(lastEditableText, lastEditableText.nodeValue?.length ?? 0)
          fallback.collapse(true)
        } else {
          fallback.selectNodeContents(target)
          fallback.collapse(false)
        }
        return fallback
      })()
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function placeInlinePlaceholderCaret(target: HTMLInputElement | HTMLTextAreaElement): void {
  window.focus()
  target.focus({ preventScroll: true })
  try {
    const end = target.value.length
    target.setSelectionRange(end, end)
  } catch {
    // Focus still starts editing if a browser rejects the selection range.
  }
}

function positionInlinePlaceholderEditingHost(
  target: HTMLInputElement | HTMLTextAreaElement,
  host: HTMLInputElement | HTMLTextAreaElement,
): void {
  const rect = target.getBoundingClientRect()
  host.style.setProperty('top', rect.top + 'px', 'important')
  host.style.setProperty('left', rect.left + 'px', 'important')
  host.style.setProperty('width', rect.width + 'px', 'important')
  host.style.setProperty('height', rect.height + 'px', 'important')
}

function createInlinePlaceholderEditingHost(
  target: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): {
  host: HTMLInputElement | HTMLTextAreaElement
  stopPositioning: () => void
} {
  const host = target instanceof HTMLTextAreaElement
    ? document.createElement('textarea')
    : document.createElement('input')
  if (host instanceof HTMLInputElement) host.type = 'text'
  host.value = text
  host.setAttribute('aria-label', 'Edit placeholder')
  host.setAttribute('data-mercury-overlay', 'inline-placeholder-editor')
  host.style.cssText = [
    'position:fixed !important',
    'display:block !important',
    'box-sizing:border-box !important',
    'margin:0 !important',
    'z-index:2147483644 !important',
    'pointer-events:auto !important',
    'cursor:text !important',
    'resize:none !important',
  ].join(';')

  const computed = window.getComputedStyle(target)
  const copiedProperties = [
    'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight',
    'font-stretch', 'line-height', 'letter-spacing', 'word-spacing',
    'text-align', 'text-indent', 'text-transform', 'text-decoration',
    'direction', 'writing-mode', 'padding-top', 'padding-right',
    'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
    'border-bottom-width', 'border-left-width', 'border-top-style',
    'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color',
    'border-left-color', 'border-radius', 'box-shadow', 'background-image',
    'background-position', 'background-size', 'background-repeat', 'opacity',
    'overflow',
  ]
  for (const property of copiedProperties) {
    host.style.setProperty(property, computed.getPropertyValue(property), 'important')
  }
  let placeholderColor = computed.color
  try {
    placeholderColor = window.getComputedStyle(target, '::placeholder').color || placeholderColor
  } catch {
    // Browsers without pseudo-element computed styles use the control colour.
  }
  host.style.setProperty('color', placeholderColor, 'important')
  host.style.setProperty('caret-color', computed.caretColor || computed.color, 'important')
  host.style.setProperty(
    'background-color',
    extractResolvedBackgroundColor(target) || computed.backgroundColor,
    'important',
  )

  document.documentElement.appendChild(host)
  positionInlinePlaceholderEditingHost(target, host)

  let rafId: number | null = null
  const syncPosition = (): void => {
    rafId = null
    positionInlinePlaceholderEditingHost(target, host)
  }
  const schedulePosition = (): void => {
    if (rafId !== null) return
    rafId = bridgeRequestAnimationFrame(syncPosition)
  }
  document.addEventListener('scroll', schedulePosition, true)
  window.addEventListener('resize', schedulePosition)
  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(schedulePosition)
    : null
  resizeObserver?.observe(target)

  return {
    host,
    stopPositioning: () => {
      document.removeEventListener('scroll', schedulePosition, true)
      window.removeEventListener('resize', schedulePosition)
      resizeObserver?.disconnect()
      if (rafId !== null) bridgeCancelAnimationFrame(rafId)
    },
  }
}

function createInlineSegmentEditingHost(textNode: Text): HTMLElement {
  const host = document.createElement('mercury-inline-text-editor')
  host.setAttribute('data-mercury-inline-segment-editor', 'true')
  // Keep the temporary wrapper visually equivalent to an anonymous text run.
  // A Mercury-only custom tag avoids authored element selectors; important
  // inline properties also keep broad child selectors from changing layout.
  host.style.cssText = [
    'display:inline !important',
    'position:static !important',
    'float:none !important',
    'flex:0 1 auto !important',
    'align-self:auto !important',
    'justify-self:auto !important',
    'margin:0 !important',
    'padding:0 !important',
    'border:0 !important',
    'outline:0 !important',
    'background:transparent !important',
    'box-shadow:none !important',
    'opacity:1 !important',
    'transform:none !important',
    'filter:none !important',
    'font:inherit !important',
    'color:inherit !important',
    'letter-spacing:inherit !important',
    'text-transform:inherit !important',
    'text-decoration:inherit !important',
    'line-height:inherit !important',
    'vertical-align:baseline !important',
    'white-space:pre-wrap !important',
  ].join(';')
  textNode.replaceWith(host)
  host.appendChild(textNode)
  return host
}

function startInlineTextEdit(
  target: HTMLElement,
  clientX?: number,
  clientY?: number,
): boolean {
  if (!isSafeInlineTextTarget(target)) return false
  if (activeInlineTextEdit?.target === target) {
    if (activeInlineTextEdit.editTarget === 'placeholder') {
      placeInlinePlaceholderCaret(activeInlineTextEdit.editingHost)
    } else {
      placeInlineCaret(activeInlineTextEdit.editingHost, clientX, clientY)
    }
    return true
  }
  finishInlineTextEdit(true)
  const oid = target.getAttribute('data-oid')
  if (!oid) return false
  if (isSafeInlinePlaceholderTarget(target)) {
    const originalPlaceholder = target.getAttribute('placeholder') || ''
    const { host: editingHost, stopPositioning } = createInlinePlaceholderEditingHost(
      target,
      originalPlaceholder,
    )
    activeInlineTextEdit = {
      target,
      editingHost,
      oid,
      baseProps: extractProps(target),
      originalText: originalPlaceholder,
      editTarget: 'placeholder',
      stopPositioning,
    }
    // Placeholder copy is edited in a Mercury-owned overlay. The authored
    // control stays mounted with its value, type, React state, event handlers,
    // and password masking completely untouched for the whole session.
    target.setAttribute('data-mercury-inline-editing', 'true')
    const listenerHost: HTMLElement = editingHost
    listenerHost.addEventListener('input', onInlineTextInput)
    listenerHost.addEventListener('keydown', onInlineTextKeyDown)
    listenerHost.addEventListener('blur', onInlineTextBlur)
    placeInlinePlaceholderCaret(editingHost)
    return true
  }
  const directTextSegments = readDirectTextSegments(target)
  const clickedSegment = directTextSegmentAtPoint(target, clientX, clientY)
  const useSegmentEditor = shouldEditDirectTextSegment(target, directTextSegments)
  if (useSegmentEditor && !clickedSegment) return false
  const dynamicSourceTokens = target.getAttribute('data-oid-text-editable') === 'false'
    ? readDynamicTextSourceTokens(target)
    : null
  const dynamicSourceTarget = clickedSegment && dynamicSourceTokens
    ? dynamicTextSourceTargetForSegment(dynamicSourceTokens, clickedSegment.index)
    : null
  const baseProps = domEvidenceManager.capture(target)
  // A source-backed literal can be edited directly after an earlier global
  // expression edit. A literal shared by any live instances cannot be
  // instance-targeted safely, including reused components that are shared at
  // runtime without carrying the lexical data-oid-shared marker.
  if (
    dynamicSourceTokens &&
    !canEditDynamicTextSourceTarget(dynamicSourceTarget, baseProps.isShared)
  ) return false
  const dynamicTextSegmentTarget = dynamicSourceTokens && dynamicSourceTarget
    ? {
        sourceIndex: dynamicSourceTarget.sourceIndex,
        sourceKind: dynamicSourceTarget.sourceKind,
      }
    : {}
  const originalHtml = target.innerHTML
  const originalChildNodes = Array.from(target.childNodes)
  const originalTextValues = new Map<Text, string>()
  const protectedChildren: ActiveInlineTextContentEdit['protectedChildren'] = []
  for (const child of originalChildNodes) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      originalTextValues.set(child as Text, child.nodeValue || '')
    } else if (!useSegmentEditor && child instanceof HTMLElement) {
      protectedChildren.push({
        element: child,
        contentEditable: child.getAttribute('contenteditable'),
        protectedMarker: child.getAttribute('data-mercury-inline-protected'),
      })
      child.setAttribute('contenteditable', 'false')
      child.setAttribute('data-mercury-inline-protected', 'true')
    }
  }
  const textSegment = useSegmentEditor && clickedSegment
    ? {
        ...clickedSegment,
        structureFingerprint: dynamicSourceTokens
          ? dynamicSourceTokens.join('|')
          : readDirectTextStructure(target),
        ...dynamicTextSegmentTarget,
      }
    : null
  const segmentTextNode = textSegment
    ? target.childNodes[textSegment.domIndex]
    : null
  if (textSegment && segmentTextNode?.nodeType !== 3 /* TEXT_NODE */) return false
  const editingHost = textSegment
    ? createInlineSegmentEditingHost(segmentTextNode as Text)
    : target
  activeInlineTextEdit = {
    target,
    editingHost,
    oid,
    baseProps,
    originalText: textSegment?.text ?? readDirectText(target),
    editTarget: 'text',
    textSegment,
    originalContentEditable: target.getAttribute('contenteditable'),
    originalChildNodes,
    originalTextValues,
    historyMutationIds: [],
    activeHistoryMutationId: null,
    activeHistoryBeforeText: null,
    lastHistoryInputAt: null,
    lastPublishedHtml: originalHtml,
    lastPublishedText: textSegment?.text ?? readDirectText(target),
    protectedChildren,
  }
  editingHost.setAttribute('contenteditable', 'plaintext-only')
  target.setAttribute('data-mercury-inline-editing', 'true')
  editingHost.addEventListener('input', onInlineTextInput)
  editingHost.addEventListener('keydown', onInlineTextKeyDown)
  editingHost.addEventListener('blur', onInlineTextBlur)
  placeInlineCaret(editingHost, clientX, clientY)
  return true
}

function onInspectPointerDownCapture(e: PointerEvent): void {
  if (!inspectEnabled) return
  if (isInlineTextEventTarget(e.target)) return
  // Touch has no hover, so this is the first signal that the pointer is in this
  // document. It runs before the target is resolved below, so the anchor is
  // computed against an already-frozen document.
  if (cursorMode === 'comment') setCommentPointerEngaged(true)
  finishInlineTextEdit(true)
  stopInspectInteraction(e)
  if (cursorMode === 'inspect') {
    const resizeHandle = inspectResizeHandleFromTarget(e.target)
    if (resizeHandle) {
      startInspectResize(e, resizeHandle)
      return
    }
  }
  const commentTarget = cursorMode === 'comment' ? findCommentTarget(e.target) : null
  const target = commentTarget?.element ?? findInspectTargetAtPoint(e.target, e.clientX, e.clientY)
  if (!target) {
    hideOverlay()
    return
  }
  if (cursorMode === 'inspect') {
    // Pressing inside a selected container arms its move, not the child's.
    // Selecting that child is still one click away: an unactivated move
    // selects whatever was pressed when the pointer comes up, so a press
    // chooses between the two gestures by whether it travels.
    const moveTarget = selectedMoveTargetFor(target)
    if (moveTarget && startInspectMove(e, moveTarget, target)) return
  }
  selectInspectTarget(target, isAdditiveSelectionEvent(e), e, commentTarget?.oidTarget)
  suppressNextClickTarget = commentTarget?.oidTarget ?? target
}

function inspectHierarchyParent(
  target: HTMLElement,
  budget?: InspectTraversalBudget,
): HTMLElement | null {
  const normalizedTarget = findStampedSvgRoot(target) ?? target
  let parent = normalizedTarget.parentElement
  let depth = 0
  while (parent && parent !== document.body) {
    if (budget && !consumeInspectTraversalNode(budget, depth)) return null
    if (parent.hasAttribute('data-oid')) {
      const candidate = findStampedSvgRoot(parent) ?? parent
      // Child traversal promotes rendered descendants through zero-box stamped
      // wrappers (for example display:contents). Apply the same rule in reverse
      // so Shift+Enter cannot select a wrapper with no visual geometry.
      if (isRenderedInspectCandidate(candidate, budget)) return candidate
    }
    parent = parent.parentElement
    depth += 1
  }
  return null
}

function walkInspectHierarchyChildren(
  parent: HTMLElement | null,
  budget: InspectTraversalBudget,
  onCandidate: (candidate: HTMLElement) => boolean,
): void {
  const roots = parent
    ? Array.from(parent.children) as HTMLElement[]
    : document.body ? Array.from(document.body.children) as HTMLElement[] : []
  const candidates = new Set<HTMLElement>()
  const visit = (node: HTMLElement, depth: number): boolean => {
    if (!consumeInspectTraversalNode(budget, depth)) return true
    const candidate = findStampedSvgRoot(node) ?? node
    if (
      candidate !== parent &&
      candidate.hasAttribute('data-oid') &&
      !candidates.has(candidate)
    ) {
      candidates.add(candidate)
      // A stamped node is the next hierarchy level. Do not scan its subtree;
      // this bounds layout/style work to the sibling frontier instead of the
      // entire document on every repeated keydown.
      if (isRenderedInspectCandidate(candidate, budget)) return onCandidate(candidate)
      // Zero-box wrappers such as display:contents are not selectable visual
      // layers, but their rendered stamped descendants still belong at this
      // hierarchy frontier. Only prune subtrees that are actually hidden.
      if (isInspectSubtreeHidden(candidate, budget)) return false
    }
    for (let index = 0; index < node.children.length; index += 1) {
      if (visit(node.children[index] as HTMLElement, depth + 1)) return true
    }
    return false
  }
  for (const root of roots) {
    if (visit(root, 0)) return
  }
}

function inspectHierarchyFirstChild(
  parent: HTMLElement | null,
  budget: InspectTraversalBudget,
): HTMLElement | null {
  let first: HTMLElement | null = null
  walkInspectHierarchyChildren(parent, budget, (candidate) => {
    first = candidate
    return true
  })
  return first
}

function inspectHierarchyLastChild(
  parent: HTMLElement | null,
  budget: InspectTraversalBudget,
): HTMLElement | null {
  let last: HTMLElement | null = null
  walkInspectHierarchyChildren(parent, budget, (candidate) => {
    last = candidate
    return false
  })
  return last
}

function inspectHierarchyAdjacent(
  parent: HTMLElement | null,
  target: HTMLElement,
  offset: -1 | 1,
  budget: InspectTraversalBudget,
): HTMLElement | null {
  const normalizedTarget = findStampedSvgRoot(target) ?? target
  let previous: HTMLElement | null = null
  let sawTarget = false
  let adjacent: HTMLElement | null = null
  walkInspectHierarchyChildren(parent, budget, (candidate) => {
    if (candidate === normalizedTarget) {
      if (offset === -1) adjacent = previous
      sawTarget = true
      return offset === -1
    }
    if (offset === 1 && sawTarget) {
      adjacent = candidate
      return true
    }
    previous = candidate
    return false
  })
  return adjacent
}

function inspectTraversalSibling(
  target: HTMLElement,
  offset: -1 | 1,
  budget: InspectTraversalBudget,
): HTMLElement | null {
  let current = findStampedSvgRoot(target) ?? target
  if (offset === 1) {
    const firstChild = inspectHierarchyFirstChild(current, budget)
    if (firstChild) return firstChild
    while (current) {
      const parent = inspectHierarchyParent(current, budget)
      const nextSibling = inspectHierarchyAdjacent(parent, current, 1, budget)
      if (nextSibling) return nextSibling
      if (!parent || budget.exhausted) return null
      current = parent
    }
    return null
  }

  const parent = inspectHierarchyParent(current, budget)
  let previous = inspectHierarchyAdjacent(parent, current, -1, budget)
  if (budget.exhausted) return null
  if (!previous) return parent
  while (true) {
    const lastChild = inspectHierarchyLastChild(previous, budget)
    if (!lastChild) return previous
    previous = lastChild
    if (budget.exhausted) return null
  }
}

type InspectHierarchyDirection =
  | 'next-sibling'
  | 'previous-sibling'
  | 'parent'
  | 'first-child'

function moveInspectSelection(
  direction: InspectHierarchyDirection,
  fallbackAnchor: HTMLElement | null = selectedTarget,
): boolean {
  // The live bridge selection advances synchronously, while the parent-store
  // acknowledgement is asynchronous. Prefer that live target so repeated keys
  // chain correctly; the supplied OID anchor remains the reload fallback.
  const anchor = selectedTarget && selectedTarget.isConnected !== false
    ? selectedTarget
    : fallbackAnchor
  if (!inspectEnabled || cursorMode !== 'inspect' || !anchor) return false
  const budget = createInspectTraversalBudget()
  let nextTarget: HTMLElement | null = null
  if (direction === 'next-sibling') {
    nextTarget = inspectTraversalSibling(anchor, 1, budget)
  } else if (direction === 'previous-sibling') {
    nextTarget = inspectTraversalSibling(anchor, -1, budget)
  } else if (direction === 'parent') {
    nextTarget = inspectHierarchyParent(anchor, budget)
  } else {
    nextTarget = inspectHierarchyFirstChild(anchor, budget)
  }
  // Expanded routes form one traversal across sibling iframes. The parent
  // owns tile ordering, so only it can hand a document boundary to the
  // adjacent route. Collapsed previews keep the selection at the boundary.
  if (!nextTarget) {
    // An exhausted search did not prove a document edge. Keep the current
    // selection instead of incorrectly handing traversal to another route.
    if (budget.exhausted) return true
    if (
      document.documentElement.getAttribute('data-mercury-expanded-route') === 'true' &&
      (direction === 'next-sibling' || direction === 'previous-sibling')
    ) {
      post({ source: 'mercury-bridge', type: 'inspect-selection-boundary', direction })
    }
    return true
  }
  selectInspectTarget(nextTarget, false, undefined, nextTarget, direction)
  scrollInspectTargetIntoView(nextTarget)
  return true
}

function selectInspectTraversalEdge(
  edge: 'first' | 'last',
  direction?: Extract<InspectHierarchyDirection, 'next-sibling' | 'previous-sibling'>,
): boolean {
  if (!inspectEnabled || cursorMode !== 'inspect') return false
  const budget = createInspectTraversalBudget()
  let target = edge === 'first'
    ? inspectHierarchyFirstChild(null, budget)
    : inspectHierarchyLastChild(null, budget)
  if (budget.exhausted) return false
  if (edge === 'last') {
    while (target) {
      const lastChild = inspectHierarchyLastChild(target, budget)
      if (!lastChild) break
      target = lastChild
      if (budget.exhausted) return false
    }
  }
  if (!target) return false
  selectInspectTarget(target, false, undefined, target, direction)
  scrollInspectTargetIntoView(target)
  // Cross-route traversal is initiated by the adjacent iframe. Move keyboard
  // focus with the selection so the inverse key (for example Shift+Tab after
  // Tab entered this route) is handled by this document, not the route that
  // just handed off the boundary.
  try { window.focus() } catch { /* focus may be denied by the embedder */ }
  return true
}

function onInspectKeyDownCapture(e: KeyboardEvent): void {
  if (!inspectEnabled) return
  if (cursorMode !== 'inspect') return
  // Never steal the key from text entry: the app's own inputs, a
  // contenteditable, or an in-progress inline text edit all consume it.
  if (activeInlineTextEdit) return
  if (isInlineTextEventTarget(e.target)) return
  const el = e.target instanceof Element ? e.target : null
  if (el?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return

  if (e.key === 'Escape') {
    if (!selectedTarget) return
    e.preventDefault()
    e.stopPropagation()
    setSelectedTarget(null)
    hideOverlay()
    post({ source: 'mercury-bridge', type: 'selection-cleared' })
    return
  }

  // The parent only owns hierarchy movement for a single selection. Preserve
  // native Tab/Enter behavior when additive inspect selection is active.
  if (
    !selectedTarget ||
    selectedOverlayEntries.length !== 1 ||
    e.isComposing ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey
  ) return
  // Enter has two inspect-mode meanings. Prefer editing when the selected
  // element supports it; otherwise preserve hierarchy navigation into the
  // element's first child. Shift+Enter always navigates to the parent.
  if (
    e.key === 'Enter' &&
    !e.shiftKey &&
    inlineTextEditEnabled &&
    startInlineTextEdit(selectedTarget)
  ) {
    stopInspectInteraction(e)
    return
  }
  let direction: InspectHierarchyDirection | null = null
  if (e.key === 'Tab') {
    direction = e.shiftKey ? 'previous-sibling' : 'next-sibling'
  } else if (e.key === 'Enter') {
    direction = e.shiftKey ? 'parent' : 'first-child'
  } else {
    return
  }
  // Relay movement intent to Mercury. Both parent-focus and iframe-focus paths
  // send the same command back here, where the live DOM resolves the target.
  e.preventDefault()
  e.stopPropagation()
  post({ source: 'mercury-bridge', type: 'inspect-selection-key', direction })
}

function onInspectSpacePanKeyCapture(e: KeyboardEvent): void {
  if (e.code !== 'Space') return

  if (e.type === 'keyup') {
    if (!inspectSpacePanActive) return
    e.preventDefault()
    e.stopImmediatePropagation()
    releaseInspectSpacePan()
    return
  }

  if (!inspectEnabled || cursorMode !== 'inspect') return
  // Mercury's temporary inline editor still needs native Space input. Outside
  // that editor, Inspect owns Space unconditionally so generated-app controls
  // and the browser's page-scroll default cannot observe it.
  if (activeInlineTextEdit || isInlineTextEventTarget(e.target)) return
  e.preventDefault()
  e.stopImmediatePropagation()
  // Auto-repeat must still be consumed. Returning before preventDefault lets
  // the browser apply Space's native page-scroll action for every repeat and
  // quickly moves the generated app to the bottom.
  if (e.repeat) return
  // A parent-window blur can close the canvas gesture without delivering the
  // matching keyup back to this iframe. A later physical Space press arrives
  // with repeat=false; publish it again even if the local flag is stale so the
  // next gesture self-heals instead of leaving Hand mode permanently inert.
  inspectSpacePanActive = true
  post({ source: 'mercury-bridge', type: 'canvas-pan-key', phase: 'down' })
}

function releaseInspectSpacePan(): void {
  if (!inspectSpacePanActive) return
  inspectSpacePanActive = false
  post({ source: 'mercury-bridge', type: 'canvas-pan-key', phase: 'up' })
}

function releaseInspectSpacePanWhenHidden(): void {
  if (document.hidden) releaseInspectSpacePan()
}

function onInspectDeleteKeyCapture(e: KeyboardEvent): void {
  if (!inspectEnabled) return
  if (cursorMode !== 'inspect') return
  if (e.key !== 'Delete' && e.key !== 'Backspace') return
  // Never steal the key from text entry: the app's own inputs, a
  // contenteditable, or an in-progress inline text edit all consume it.
  if (activeInlineTextEdit) return
  if (isInlineTextEventTarget(e.target)) return
  const el = e.target instanceof Element ? e.target : null
  if (el?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
  if (!selectedTarget) return
  const oid = selectedTarget.getAttribute('data-oid')
  if (!oid) return
  // Backspace navigates back in some browsers, so consume it. The parent owns
  // the decision of whether this selection is deletable at all -- it applies
  // the same gate the panel's Delete button uses -- so the bridge only reports
  // the intent.
  e.preventDefault()
  post({ source: 'mercury-bridge', type: 'delete-selection-key', oid })
}

function onInspectHistoryKeyCapture(e: KeyboardEvent): void {
  if (!inspectEnabled || cursorMode !== 'inspect') return
  // Inline editing commits its aggregate draft before relaying history and
  // then restores the caret after the source-backed step. Let its target-level
  // listener retain that special ordering.
  if (activeInlineTextEdit) return
  const shortcut = readInspectHistoryShortcut(e)
  if (!shortcut) return
  // This document is a separate browsing context, so the parent cannot see
  // the key event. Fully consume it here before the generated app or browser
  // can apply a private history step, then relay only the typed intent.
  e.preventDefault()
  e.stopImmediatePropagation()
  postInspectHistoryShortcut(shortcut)
}

function onInspectInteractionCapture(e: Event): void {
  if (!inspectEnabled) return
  if (isInlineTextEventTarget(e.target)) return
  stopInspectInteraction(e)
}

function onClickCapture(e: MouseEvent): void {
  if (!inspectEnabled) return
  // Pointer/mouse-down remain native inside the temporary contenteditable so
  // caret placement and word selection work. The resulting click must still
  // be consumed: an editable target can itself be an anchor/button (for
  // example "View selected work"), and letting this event through navigates
  // or invokes authored React handlers while the user is only editing text.
  if (isInlineTextEventTarget(e.target)) {
    stopInspectInteraction(e)
    return
  }
  stopInspectInteraction(e)
  const commentTarget = cursorMode === 'comment' ? findCommentTarget(e.target) : null
  const oidTarget = commentTarget?.oidTarget ?? findInspectTargetAtPoint(e.target, e.clientX, e.clientY)
  if (!oidTarget) {
    suppressNextClickTarget = null
    return
  }
  if (oidTarget === suppressNextClickTarget) {
    suppressNextClickTarget = null
    return
  }
  suppressNextClickTarget = null
  // Pointer selection usually fires first. Keep this click path as a
  // fallback for synthetic/keyboard clicks without double-posting.
  const target = commentTarget?.element ?? oidTarget
  if (target !== selectedTarget) {
    selectInspectTarget(target, isAdditiveSelectionEvent(e), e, commentTarget?.oidTarget)
  }
}

function onInspectDoubleClickCapture(e: MouseEvent): void {
  if (!inspectEnabled) return
  if (isInlineTextEventTarget(e.target)) {
    // Keep native double-click behavior inside the active editor (for example,
    // word selection) but do not let the generated app's React/DOM dblclick
    // handlers observe the same gesture. preventDefault() is deliberately
    // omitted so the browser can still update the text selection.
    e.stopPropagation()
    e.stopImmediatePropagation()
    return
  }
  stopInspectInteraction(e)
  // Comment mode borrows inspect's selection transport, not its editing gestures.
  // A double click must neither re-target the comment (its drill-down resolves a
  // deeper element than the single-click comment target) nor open an inline
  // editor. Suppression still runs first, like every other captured gesture, so
  // the generated app's own dblclick handlers stay inert while annotating.
  if (cursorMode !== 'inspect') return
  const pointTarget = findInspectTargetAtPoint(e.target, e.clientX, e.clientY, true)
  // A selected mixed-content element can have both its own direct Text nodes
  // and stamped element children. An exact hit on the parent's direct text
  // must reach the segment editor; the nearest-descendant drill-down would
  // otherwise redirect clicks on Hello / again to a nearby strong child.
  const hitsSelectedDirectText = Boolean(
    selectedTarget &&
    pointTarget === selectedTarget &&
    directTextSegmentAtPoint(selectedTarget, e.clientX, e.clientY),
  )
  const descendantTarget = selectedTarget && !hitsSelectedDirectText && (!pointTarget || pointTarget === selectedTarget)
    ? findNearestDeepestOidDescendant(selectedTarget, e.clientX, e.clientY)
    : null
  const target = descendantTarget ?? pointTarget
  if (!target) {
    hideOverlay()
    return
  }
  suppressNextClickTarget = null
  selectInspectTarget(target, isAdditiveSelectionEvent(e), e)
  startInlineTextEdit(target, e.clientX, e.clientY)
}

// ---------------------------------------------------------------------------
// Animation pause/resume for inspect mode.
// Freezes ALL animations globally so the user edits a static snapshot.
// ---------------------------------------------------------------------------

let animationPauseStyleEl: HTMLStyleElement | null = null
let animationPauseStyleFailureReported = false
const MERCURY_MUTATING_ATTR = 'data-mercury-mutating'
const MERCURY_MUTATING_SELECTOR = '[' + MERCURY_MUTATING_ATTR + ']'
const mercuryMutationClearFrames = new Map<Element, {
  frameId: number
  previousValue: string | null
}>()
let originalElementAnimate: typeof Element.prototype.animate | null = null
let originalAnimationPlay: typeof Animation.prototype.play | null = null
let originalAnimationPause: typeof Animation.prototype.pause | null = null
let originalAnimationReverse: typeof Animation.prototype.reverse | null = null
let mercuryElementAnimate: typeof Element.prototype.animate | null = null
let mercuryAnimationPlay: typeof Animation.prototype.play | null = null
let mercuryAnimationPause: typeof Animation.prototype.pause | null = null
let mercuryAnimationReverse: typeof Animation.prototype.reverse | null = null
let animationsPaused = false
const animationsPausedByMercury = new Set<Animation>()
let inspectAnimationObserver: MutationObserver | null = null
let inspectAnimationScanFrame: number | null = null
let viewportAnimationSettling = false
let viewportAnimationSettleGeneration = 0
let viewportAnimationSettleTimer: number | null = null
let viewportAnimationSettleWatchdogTimer: number | null = null
const INSPECT_REVEAL_SNAPSHOT_ATTR = 'data-mercury-inspect-reveal-snapshot'
let inspectRevealSnapshotLatched = false
let inspectRevealSnapshotStyleEl: HTMLStyleElement | null = null
let inspectRevealSnapshotStyleFailureReported = false
let inspectRevealSnapshotScanFrame: number | null = null
let inspectRevealSnapshotScanTimer: number | null = null
let inspectRevealSnapshotToken = 0
type InspectRevealSnapshot = {
  token: string
  opacity: number
  transform?: string
  translate?: string
}
type ObservedViewportToken = { id: number; active: boolean }
const inspectRevealSnapshotTargets = new Map<Element, InspectRevealSnapshot>()
let inspectRevealSnapshotSuppressedTargets = new WeakSet<Element>()
const pendingInspectRevealRoots = new Set<Element>()
const pendingInspectRevealAnimations = new Set<Animation>()
const pendingInspectRevealDiscoveryRoots = new Set<Element>()
let inspectRevealDiscoveryWalker: TreeWalker | null = null
let inspectRevealDiscoveryRoot: Element | null = null
let inspectRevealDiscoveryRootPending = false
let inspectRevealDiscoveryTimer: number | null = null
let inspectRevealDiscoveryVisited = new WeakSet<Element>()
let inspectRevealDiscoveryVisitCount = 0
let inspectRevealDocumentDiscoveryQueued = false
// Targets are weak keys so installing the bridge wrapper cannot extend an
// application's element lifetime beyond the native observer's weak tracking.
const observedViewportTargets = new WeakMap<
  Element,
  Map<ObservedViewportToken, boolean | null>
>()
// Framer's viewport={{ once: true }} can unobserve synchronously from its first
// intersection callback, before its suspended animation frame makes the node
// visible. Preserve only the initial-hidden fact with weak ownership so the
// post-freeze pass can still recover that target without extending its life.
const initiallyHiddenObservedViewportTargets = new WeakSet<Element>()
// Some motion runtimes can leave a while-in-view entrance in its authored
// inline initial state without ever registering an IntersectionObserver target
// or creating a Web Animation. Track that distinct dormant state separately so
// the freeze pass can restore visibility without replaying the animation.
let initiallyHiddenInlineRevealTargets = new WeakSet<Element>()
// An observer may explicitly unobserve a once-only target before the frozen
// snapshot pass runs. Keep that short-lived fact weakly, then promote only a
// target that is still visually hidden when the pass actually needs it.
const recentlyUnobservedViewportTargets = new WeakSet<Element>()
let intersectionObserverToken = 0
let inspectRenderPriming = false
let inspectRenderPrimeGeneration = 0
let inspectRenderPrimeTimer: number | null = null
let inspectRenderPrimeFrame: number | null = null
let inspectRenderPrimeFrameTimer: number | null = null
const INSPECT_RENDER_PRIME_MAX_MS = 200
const INSPECT_RENDER_PRIME_FRAME_LIMIT = 4
const INSPECT_RENDER_PRIME_FRAME_FALLBACK_MS = 40
const INSPECT_REVEAL_DESCENDANT_LIMIT = 512
const INSPECT_REVEAL_TARGET_LIMIT = 2_048
const INSPECT_REVEAL_ANIMATION_LIMIT = 2_048
const INSPECT_REVEAL_DISCOVERY_ROOT_LIMIT = 512
const INSPECT_REVEAL_DISCOVERY_CHUNK_SIZE = 256
const INSPECT_REVEAL_DISCOVERY_LIMIT = 20_000
const INSPECT_REVEAL_SCAN_FALLBACK_MS = 100
const VIEWPORT_ANIMATION_MIN_SETTLE_MS = 250
const VIEWPORT_ANIMATION_MAX_SETTLE_MS = 1_500
const VIEWPORT_ANIMATION_SETTLE_POLL_MS = 100
// How long the document must go without an app-owned style/class mutation
// before the entrance window is considered finished. Covers main-thread
// animation libraries, which write inline styles every frame and are invisible
// to getAnimations().
const VIEWPORT_ANIMATION_STYLE_QUIET_MS = 120

function clearMercuryMutationMarker(target: Element): void {
  const pending = mercuryMutationClearFrames.get(target)
  if (!pending) return
  mercuryMutationClearFrames.delete(target)
  if (pending.previousValue === null) target.removeAttribute(MERCURY_MUTATING_ATTR)
  else target.setAttribute(MERCURY_MUTATING_ATTR, pending.previousValue)
}

function markMercuryMutationTargets(targets: Array<Element | null | undefined>): void {
  if (!animationsPaused) return
  for (const target of new Set(targets.filter((value): value is Element => value instanceof Element))) {
    const existing = mercuryMutationClearFrames.get(target)
    if (existing) bridgeCancelAnimationFrame(existing.frameId)
    // Ternary, not `??`: the authored value is almost always null, and `??`
    // cannot tell "no entry yet" from "an entry holding null". It fell through
    // to the live attribute, which this function set to 'true' on the previous
    // mark, so a second mark arriving before the frame cleared adopted 'true'
    // as the value to restore -- and the marker stuck for good, leaving
    // transition-property: none on the element for the rest of the session.
    const previousValue = existing
      ? existing.previousValue
      : target.getAttribute(MERCURY_MUTATING_ATTR)
    target.setAttribute(MERCURY_MUTATING_ATTR, 'true')
    const frameId = bridgeRequestAnimationFrame(() => clearMercuryMutationMarker(target))
    mercuryMutationClearFrames.set(target, { frameId, previousValue })
  }
}

function clearAllMercuryMutationMarkers(): void {
  for (const [target, pending] of mercuryMutationClearFrames) {
    bridgeCancelAnimationFrame(pending.frameId)
    clearMercuryMutationMarker(target)
  }
}

function yieldInspectRevealSnapshotsToAuthoredEdits(targets: Iterable<Element | null | undefined>): void {
  let changed = false
  for (const target of targets) {
    if (target instanceof Element) {
      changed = clearInspectRevealSnapshotTarget(target, true) || changed
    }
  }
  if (changed) syncInspectRevealSnapshotStyle()
}

type AppAnimationFrameRecord = {
  callback: FrameRequestCallback
  nativeId: number | null
  allowedSuspensionGeneration: number | null
}

type AppAnimationFrameScheduler = {
  request: typeof window.requestAnimationFrame
  cancel: typeof window.cancelAnimationFrame
  suspend: () => void
  resume: () => void
  flushPendingFrame: (timestamp: number) => number
  runWithNativeRequestScope: <T>(operation: () => T) => T
}

// A normal self-scheduling rAF loop contributes only one suspended callback,
// because its producer is itself paused. Timer/event producers can contribute
// more. Bound that exceptional backlog without dropping accepted callbacks:
// once the limit is crossed, deliver the oldest callbacks in small native-frame
// batches and surface the degraded freeze once. Resume uses the same batching
// so a long freeze cannot create one enormous main-thread task.
const MAX_SUSPENDED_APP_ANIMATION_FRAMES = 2_048
const APP_ANIMATION_FRAME_DRAIN_BATCH_SIZE = 64
const MERCURY_APP_FRAME_SCHEDULER_KEY = '__mercuryAppFrameScheduler_v5__'

function createAppAnimationFrameScheduler(): AppAnimationFrameScheduler {
  let suspended = false
  let suspensionGeneration = 0
  let nativeRequestScopeDepth = 0
  let nextLogicalId = 1
  let overflowDrainFrame: number | null = null
  let resumeDrainFrame: number | null = null
  let overflowReported = false
  const records = new Map<number, AppAnimationFrameRecord>()

  const allocateId = (): number => {
    for (;;) {
      const id = nextLogicalId
      nextLogicalId = nextLogicalId >= Number.MAX_SAFE_INTEGER ? 1 : nextLogicalId + 1
      if (!records.has(id)) return id
    }
  }

  const queueSuspended = (id: number, record: AppAnimationFrameRecord): void => {
    record.nativeId = null
    record.allowedSuspensionGeneration = null
    records.set(id, record)
  }

  const scheduleNative = (
    id: number,
    record: AppAnimationFrameRecord,
    allowedGeneration: number | null = null,
  ): void => {
    record.allowedSuspensionGeneration = allowedGeneration
    record.nativeId = nativeBridgeRequestAnimationFrame.call(window, (timestamp) => {
      const current = records.get(id)
      if (!current) return
      current.nativeId = null
      const mayRunWhileSuspended =
        current.allowedSuspensionGeneration === suspensionGeneration
      if (suspended && !mayRunWhileSuspended) {
        queueSuspended(id, current)
        return
      }
      records.delete(id)
      // Preserve the browser clock contract. Virtualizing only the rAF
      // timestamp permanently desynchronizes it from performance.now(), the
      // document timeline, and Web Animations API currentTime values.
      current.callback(timestamp)
    })
  }

  const suspendedRecordCount = (): number => {
    let count = 0
    for (const record of records.values()) {
      if (record.nativeId === null) count += 1
    }
    return count
  }

  const scheduleOverflowDrain = (): void => {
    if (
      !suspended ||
      overflowDrainFrame !== null ||
      suspendedRecordCount() <= MAX_SUSPENDED_APP_ANIMATION_FRAMES
    ) return
    if (!overflowReported) {
      overflowReported = true
      console.warn(
        '[Mercury] The suspended animation-frame queue exceeded ' +
          MAX_SUSPENDED_APP_ANIMATION_FRAMES +
          ' callbacks; delivering the oldest callbacks gradually to protect preview responsiveness.',
      )
    }
    const generation = suspensionGeneration
    overflowDrainFrame = nativeBridgeRequestAnimationFrame.call(window, () => {
      overflowDrainFrame = null
      if (!suspended || generation !== suspensionGeneration) return
      let scheduled = 0
      for (const [id, record] of records) {
        if (record.nativeId !== null) continue
        scheduleNative(id, record, generation)
        scheduled += 1
        if (scheduled >= APP_ANIMATION_FRAME_DRAIN_BATCH_SIZE) break
      }
      if (suspendedRecordCount() > MAX_SUSPENDED_APP_ANIMATION_FRAMES) {
        scheduleOverflowDrain()
      }
    })
  }

  const scheduleResumeDrain = (): void => {
    if (suspended || resumeDrainFrame !== null) return
    const hasQueuedRecord = Array.from(records.values()).some((record) => record.nativeId === null)
    if (!hasQueuedRecord) return
    resumeDrainFrame = nativeBridgeRequestAnimationFrame.call(window, () => {
      resumeDrainFrame = null
      if (suspended) return
      let scheduled = 0
      for (const [id, record] of records) {
        if (record.nativeId !== null) continue
        scheduleNative(id, record)
        scheduled += 1
        if (scheduled >= APP_ANIMATION_FRAME_DRAIN_BATCH_SIZE) break
      }
      scheduleResumeDrain()
    })
  }

  const request: typeof window.requestAnimationFrame = (callback): number => {
    const id = allocateId()
    const record: AppAnimationFrameRecord = {
      callback,
      nativeId: null,
      allowedSuspensionGeneration: null,
    }
    records.set(id, record)
    if (suspended && nativeRequestScopeDepth === 0) {
      queueSuspended(id, record)
      scheduleOverflowDrain()
    } else {
      scheduleNative(id, record, suspended ? suspensionGeneration : null)
    }
    return id
  }

  const cancel: typeof window.cancelAnimationFrame = (id): void => {
    const record = records.get(id)
    if (!record) return
    records.delete(id)
    if (record.nativeId !== null) {
      nativeBridgeCancelAnimationFrame.call(window, record.nativeId)
    }
  }

  const suspend = (): void => {
    if (suspended) return
    suspended = true
    suspensionGeneration += 1
    if (resumeDrainFrame !== null) {
      nativeBridgeCancelAnimationFrame.call(window, resumeDrainFrame)
      resumeDrainFrame = null
    }

    for (const [id, record] of records) {
      if (record.nativeId !== null) {
        nativeBridgeCancelAnimationFrame.call(window, record.nativeId)
      }
      queueSuspended(id, record)
    }
  }

  const resume = (): void => {
    if (!suspended) return
    suspended = false
    if (overflowDrainFrame !== null) {
      nativeBridgeCancelAnimationFrame.call(window, overflowDrainFrame)
      overflowDrainFrame = null
    }
    for (const record of records.values()) record.allowedSuspensionGeneration = null
    scheduleResumeDrain()
  }

  // Chromium may indefinitely throttle native rAF for a small or initially
  // occluded iframe on the spatial canvas. During Mercury's bounded first-load
  // render window, deliver one logical application frame from a timer only
  // when the matching bridge rAF did not arrive. Snapshot the accepted records
  // before invoking them so callbacks scheduled by a callback belong to the
  // next logical frame, exactly as they do with native rAF.
  const flushPendingFrame = (timestamp: number): number => {
    if (suspended) return 0
    const pending = Array.from(records.entries()).slice(
      0,
      APP_ANIMATION_FRAME_DRAIN_BATCH_SIZE,
    )
    let delivered = 0
    for (const [id, record] of pending) {
      if (records.get(id) !== record) continue
      records.delete(id)
      if (record.nativeId !== null) {
        nativeBridgeCancelAnimationFrame.call(window, record.nativeId)
        record.nativeId = null
      }
      try {
        record.callback(timestamp)
      } catch (value) {
        // Native rAF reports one callback's exception without preventing the
        // other callbacks in that frame from running. Preserve that behavior.
        window.setTimeout(() => { throw value }, 0)
      }
      delivered += 1
    }
    return delivered
  }

  // A bridge-owned async operation occasionally has to call code that uses
  // global rAF rather than accepting a scheduler. Keep the exception
  // synchronous so it cannot release unrelated app callbacks for the duration
  // of that operation. This lives on the persistent scheduler so HMR callers
  // always update the same scope observed by request().
  const runWithNativeRequestScope = <T>(operation: () => T): T => {
    nativeRequestScopeDepth += 1
    try {
      return operation()
    } finally {
      nativeRequestScopeDepth -= 1
    }
  }

  return { request, cancel, suspend, resume, flushPendingFrame, runWithNativeRequestScope }
}

const existingAppFrameScheduler = frameSchedulerWindow[MERCURY_APP_FRAME_SCHEDULER_KEY] as
  | AppAnimationFrameScheduler
  | undefined
const appAnimationFrameScheduler =
  existingAppFrameScheduler ?? createAppAnimationFrameScheduler()
if (!existingAppFrameScheduler) {
  frameSchedulerWindow[MERCURY_APP_FRAME_SCHEDULER_KEY] = appAnimationFrameScheduler
}
// Keep these wrappers installed for the lifetime of the document. Application
// modules that cache rAF after the prepended bridge import retain the delegating
// wrapper, and HMR reuses the scheduler stored on window instead of nesting it.
window.requestAnimationFrame = appAnimationFrameScheduler.request
window.cancelAnimationFrame = appAnimationFrameScheduler.cancel

function isMercuryOverlayAnimation(animation: Animation): boolean {
  const effectTarget = (animation.effect as { target?: unknown } | null)?.target
  let targetElement: Element | null = null
  if (effectTarget instanceof Element) {
    targetElement = effectTarget
  } else if (effectTarget && typeof effectTarget === 'object') {
    // CSSPseudoElement targets expose their originating element through
    // .element. Avoid relying on the optional CSSPseudoElement constructor so
    // this remains safe in browsers that only partially implement that API.
    const originatingElement = (effectTarget as { element?: unknown }).element
    if (originatingElement instanceof Element) targetElement = originatingElement
  }
  return Boolean(targetElement?.closest('[data-mercury-overlay]'))
}

function isMercuryMutationAnimation(animation: Animation): boolean {
  const effectTarget = (animation.effect as { target?: unknown } | null)?.target
  if (effectTarget instanceof Element) {
    return Boolean(effectTarget.closest('[' + MERCURY_MUTATING_ATTR + ']'))
  }
  if (effectTarget && typeof effectTarget === 'object') {
    const originatingElement = (effectTarget as { element?: unknown }).element
    return originatingElement instanceof Element &&
      Boolean(originatingElement.closest('[' + MERCURY_MUTATING_ATTR + ']'))
  }
  return false
}

function isCssKeyframeAnimation(animation: Animation): boolean {
  return typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation
}

function pauseAnimationForInspect(animation: Animation): void {
  if (!animationsPaused) return
  try {
    // Mercury's hover/selection UI lives in the generated document and is
    // therefore included by document.getAnimations(). Keep editor-owned
    // transitions responsive while freezing only the generated application.
    if (isMercuryOverlayAnimation(animation)) return
    // Resize, move, and optimistic panel edits must become visible
    // immediately even when the affected app element authors a transition.
    if (isMercuryMutationAnimation(animation)) return
    // Script-level pause()/play() overrides authored animation-play-state for
    // CSSAnimation objects even after Inspect ends. The injected !important
    // rule owns CSS keyframes so removing it restores the app's CSS semantics.
    if (isCssKeyframeAnimation(animation)) return
    // A pending app-initiated pause reports playState='paused' before its
    // pending flag settles. A newly created CSS animation can instead still be
    // pending before it reports 'running' (notably in WebKit), so pause pending
    // work only when it is not already in the app-authored paused state.
    const shouldPause =
      animation.playState === 'running' ||
      (animation.pending && animation.playState !== 'paused')
    if (!shouldPause) return
    const pause = originalAnimationPause ?? animation.pause
    pause.call(animation)
    animationsPausedByMercury.add(animation)
  } catch {
    // A detached/cancelled animation must not prevent the rest from pausing.
  }
}

function pauseCurrentDocumentAnimations(): void {
  try {
    for (const animation of document.getAnimations()) {
      pauseAnimationForInspect(animation)
    }
  } catch {
    // getAnimations is best-effort on older runtimes.
  }
}

function onInspectAnimationStarted(event: Event): void {
  const target = event.target
  const revealAnimations: Animation[] = []
  if (target instanceof Element) {
    try {
      for (const animation of target.getAnimations()) {
        pauseAnimationForInspect(animation)
        revealAnimations.push(animation)
      }
    } catch {
      // Fall through to the coalesced document-level safety scan.
    }
  }
  scheduleInspectAnimationScan()
  scheduleInspectRevealSnapshotScan([], revealAnimations)
}

function scheduleInspectAnimationScan(): void {
  if (!animationsPaused || inspectAnimationScanFrame !== null) return
  inspectAnimationScanFrame = bridgeRequestAnimationFrame(() => {
    inspectAnimationScanFrame = null
    pauseCurrentDocumentAnimations()
  })
}

function onInspectAnimationMutations(records: MutationRecord[]): void {
  const dirtyRoots = new Set<Element>()
  let snapshotStyleChanged = false
  let removedElementSeen = false
  const addNearestObservedRoot = (start: Element): void => {
    let cursor: Element | null = start
    while (cursor) {
      if (hasActiveObservedViewportTarget(cursor)) {
        dirtyRoots.add(cursor)
        return
      }
      cursor = cursor.parentElement
    }
  }
  for (const record of records) {
    if (record.type === 'attributes' && record.target instanceof Element) {
      if (inspectRevealSnapshotTargets.has(record.target)) {
        snapshotStyleChanged =
          clearInspectRevealSnapshotTarget(record.target, true) || snapshotStyleChanged
      }
      addNearestObservedRoot(record.target)
    }
    for (const addedNode of record.addedNodes) {
      if (addedNode instanceof Element) {
        addNearestObservedRoot(addedNode)
        scheduleInspectRevealDiscovery(addedNode)
      }
    }
    for (const removedNode of record.removedNodes) {
      if (removedNode instanceof Element) removedElementSeen = true
    }
  }
  if (removedElementSeen) {
    snapshotStyleChanged =
      pruneDisconnectedInspectRevealSnapshotTargets() || snapshotStyleChanged
  }
  if (snapshotStyleChanged) syncInspectRevealSnapshotStyle()
  scheduleInspectAnimationScan()
  scheduleInspectRevealSnapshotScan(dirtyRoots)
}

function patchAnimationCreation(): void {
  try {
    if (!originalAnimationPause && typeof Animation !== 'undefined') {
      originalAnimationPause = Animation.prototype.pause
      const appAnimationPause = originalAnimationPause
      mercuryAnimationPause = function(this: Animation) {
        // If app code explicitly pauses an animation after Mercury did, its
        // authored paused state must win when inspect mode ends.
        animationsPausedByMercury.delete(this)
        appAnimationPause.call(this)
      }
      Animation.prototype.pause = mercuryAnimationPause
    }
  } catch {
    // Non-critical.
  }

  try {
    if (!originalElementAnimate && typeof Element.prototype.animate === 'function') {
      originalElementAnimate = Element.prototype.animate
      const appElementAnimate = originalElementAnimate
      mercuryElementAnimate = function(this: Element, ...args: Parameters<typeof Element.prototype.animate>) {
        const animation = appElementAnimate.apply(this, args)
        pauseAnimationForInspect(animation)
        scheduleInspectRevealSnapshotScan([], [animation])
        return animation
      }
      Element.prototype.animate = mercuryElementAnimate
    }
  } catch {
    // Non-critical: existing document animations are still paused below.
  }

  try {
    if (!originalAnimationPlay && typeof Animation !== 'undefined') {
      originalAnimationPlay = Animation.prototype.play
      const appAnimationPlay = originalAnimationPlay
      mercuryAnimationPlay = function(this: Animation) {
        appAnimationPlay.call(this)
        pauseAnimationForInspect(this)
      }
      Animation.prototype.play = mercuryAnimationPlay
    }
  } catch {
    // Non-critical.
  }

  try {
    if (!originalAnimationReverse && typeof Animation !== 'undefined') {
      originalAnimationReverse = Animation.prototype.reverse
      const appAnimationReverse = originalAnimationReverse
      mercuryAnimationReverse = function(this: Animation) {
        appAnimationReverse.call(this)
        pauseAnimationForInspect(this)
      }
      Animation.prototype.reverse = mercuryAnimationReverse
    }
  } catch {
    // Non-critical.
  }
}

function restoreAnimationCreation(): void {
  try {
    if (originalElementAnimate) {
      // Do not remove a wrapper installed by the app while Mercury was
      // frozen. If it delegates to our saved wrapper, that wrapper's closure
      // remains valid; the next freeze can safely wrap the app's new method.
      if (Element.prototype.animate === mercuryElementAnimate) {
        Element.prototype.animate = originalElementAnimate
      }
      originalElementAnimate = null
      mercuryElementAnimate = null
    }
  } catch {
    // Non-critical.
  }
  try {
    if (originalAnimationPlay && typeof Animation !== 'undefined') {
      if (Animation.prototype.play === mercuryAnimationPlay) {
        Animation.prototype.play = originalAnimationPlay
      }
      originalAnimationPlay = null
      mercuryAnimationPlay = null
    }
  } catch {
    // Non-critical.
  }
  try {
    if (originalAnimationPause && typeof Animation !== 'undefined') {
      if (Animation.prototype.pause === mercuryAnimationPause) {
        Animation.prototype.pause = originalAnimationPause
      }
      originalAnimationPause = null
      mercuryAnimationPause = null
    }
  } catch {
    // Non-critical.
  }
  try {
    if (originalAnimationReverse && typeof Animation !== 'undefined') {
      if (Animation.prototype.reverse === mercuryAnimationReverse) {
        Animation.prototype.reverse = originalAnimationReverse
      }
      originalAnimationReverse = null
      mercuryAnimationReverse = null
    }
  } catch {
    // Non-critical.
  }
}

function allowRegisteredAnimations(): boolean {
  return dynamicControlsEnabled && inspectEnabled && cursorMode === 'inspect' &&
    document.documentElement.getAttribute('data-mercury-expanded-route') !== 'true'
}

function pauseAllAnimations(): void {
  if (animationsPaused) return
  animationsPaused = true
  registeredAnimationsLive = allowRegisteredAnimations()

  // Patch creation/scheduling first so nothing can escape while the existing
  // animation set is being enumerated.
  patchAnimationCreation()
  appAnimationFrameScheduler.suspend()
  pauseCurrentDocumentAnimations()

  // CSS animation-play-state preserves the current keyframe position and also
  // catches CSS animations created after the initial enumeration. Do not set
  // transition:none: that cancels an active transition and jumps to its end.
  try {
    if (!animationPauseStyleEl) {
      const el = document.createElement('style')
      el.id = 'mercury-animation-pause'
      const appAnimationSelector =
        '*:not([data-mercury-overlay]):not([data-mercury-overlay] *)' +
        (registeredAnimationsLive ? ':not([data-mercury-controls]):not([data-mercury-controls] *)' : '')
      el.textContent =
        appAnimationSelector + ', ' +
        appAnimationSelector + '::before, ' +
        appAnimationSelector + '::after { animation-play-state: paused !important; } ' +
        '[' + MERCURY_MUTATING_ATTR + '] { transition-property: none !important; } ' +
        (registeredAnimationsLive ? '[data-mercury-controls], [data-mercury-controls] *, ' +
        '[data-mercury-controls]::before, [data-mercury-controls]::after, ' +
        '[data-mercury-controls] *::before, [data-mercury-controls] *::after { transition-property: none !important; }' : '')
      ;(document.head || document.documentElement).appendChild(el)
      animationPauseStyleEl = el

      // A strict style-src CSP commonly ignores an inline <style> without
      // throwing from appendChild(). Check the resulting CSSStyleSheet so the
      // bridge reports degraded CSS-animation coverage instead of silently
      // claiming a complete freeze. The WAAPI scan/listeners below remain the
      // best-effort fallback for animations the browser exposes.
      let pauseRuleApplied = false
      try {
        pauseRuleApplied = Array.from(el.sheet?.cssRules ?? []).some((rule) =>
          rule.cssText.includes('animation-play-state: paused'),
        )
      } catch {
        // Treat an inaccessible/blocked sheet as unavailable.
      }
      if (!pauseRuleApplied && !animationPauseStyleFailureReported) {
        animationPauseStyleFailureReported = true
        const error = new Error(
          'Mercury could not apply its animation-pause stylesheet; the page Content Security Policy may block inline styles. Animation freezing will use best-effort browser animation APIs.',
        )
        error.name = 'AnimationFreezeStyleUnavailable'
        postRuntimeError('error', error)
      }
    }
  } catch (value) {
    if (!animationPauseStyleFailureReported) {
      animationPauseStyleFailureReported = true
      const detail = runtimeErrorFields(value).message
      const error = new Error(
        'Mercury could not install its animation-pause stylesheet.' +
          (detail ? ' ' + detail : '') +
          ' Animation freezing will use best-effort browser animation APIs.',
      )
      error.name = 'AnimationFreezeStyleUnavailable'
      postRuntimeError('error', error)
    }
  }

  // Attribute/DOM mutations cover class-driven transitions. The lifecycle
  // events also catch pseudo-class transitions (hover/focus) with no mutation.
  try {
    document.addEventListener('transitionrun', onInspectAnimationStarted, true)
    document.addEventListener('animationstart', onInspectAnimationStarted, true)
    if (typeof MutationObserver !== 'undefined' && document.documentElement) {
      inspectAnimationObserver = new MutationObserver(onInspectAnimationMutations)
      inspectAnimationObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
      })
    }
  } catch {
    // Non-critical.
  }
}

function resumeAllAnimations(): void {
  if (!animationsPaused) return
  animationsPaused = false
  clearAllMercuryMutationMarkers()

  try {
    inspectAnimationObserver?.disconnect()
    inspectAnimationObserver = null
    if (inspectAnimationScanFrame !== null) {
      bridgeCancelAnimationFrame(inspectAnimationScanFrame)
      inspectAnimationScanFrame = null
    }
    document.removeEventListener('transitionrun', onInspectAnimationStarted, true)
    document.removeEventListener('animationstart', onInspectAnimationStarted, true)
    if (animationPauseStyleEl) {
      animationPauseStyleEl.remove()
      animationPauseStyleEl = null
    }
  } catch {
    // Non-critical.
  }

  restoreAnimationCreation()
  appAnimationFrameScheduler.resume()

  const animationsToResume = [...animationsPausedByMercury]
  animationsPausedByMercury.clear()
  for (const animation of animationsToResume) {
    try {
      // A cancelled animation is idle and must not be resurrected. CSS
      // animations may already be running after removal of the pause rule.
      if (animation.playState === 'paused') animation.play()
    } catch {
      // It may have been detached or cancelled while inspect mode was active.
    }
  }
}

// True while the open entrance window belongs to Inspect activation rather
// than to a route change. Turning an expanded route off, or a navigation being
// rejected, both cancel the window and then freeze immediately -- which cut the
// entrance short at whatever frame it had reached. Those paths must leave an
// Inspect-owned window alone; it ends on its own poll or its 1.5s watchdog.
let inspectEntranceSettleOwned = false

// Ends an entrance window Inspect opened, when Inspect is no longer the reason
// it exists. Safe to call unconditionally: a window owned by a route settle is
// left alone.
function releaseInspectEntranceSettle(): void {
  if (!inspectEntranceSettleOwned) return
  cancelViewportAnimationSettle()
}

// Set when an Inspect-owned window runs to completion. Later Off -> Inspect
// toggles in this document get only the render prime, so they do not resume
// autoplay/ticker state for the length of a window each time.
let inspectEntranceSettledOnce = false

function beginInspectEntranceSettle(): void {
  const generation = beginViewportAnimationSettle()
  inspectEntranceSettleOwned = true
  beginInspectRenderPrime()
  syncAnimationPauseState()
  scheduleViewportAnimationFreeze(generation)
}

function cancelViewportAnimationSettleUnlessInspectOwned(): void {
  if (inspectEntranceSettleOwned && viewportAnimationSettling) return
  cancelViewportAnimationSettle()
}

function cancelViewportAnimationSettle(): void {
  viewportAnimationSettleGeneration += 1
  viewportAnimationSettling = false
  inspectEntranceSettleOwned = false
  stopViewportSettleStyleWatch()
  if (viewportAnimationSettleTimer !== null) {
    window.clearTimeout(viewportAnimationSettleTimer)
    viewportAnimationSettleTimer = null
  }
  if (viewportAnimationSettleWatchdogTimer !== null) {
    window.clearTimeout(viewportAnimationSettleWatchdogTimer)
    viewportAnimationSettleWatchdogTimer = null
  }
}

function beginViewportAnimationSettle(): number {
  cancelViewportAnimationSettle()
  viewportAnimationSettling = true
  beginViewportSettleStyleWatch()
  return viewportAnimationSettleGeneration
}

// Entrance motion is not always fully reachable through getAnimations(). A
// library that composes several transform values into one string
// (framer-motion does this for scale/translate) interpolates them on the main
// thread and writes element.style every frame, while other properties (e.g.
// opacity) may run on WAAPI and can finish first. Waiting only on WAAPI ended
// the window mid-transform. Style churn therefore counts on any element seen
// running a finite Web Animation since the window opened -- including after
// that animation ends -- while purely main-thread motion on elements that
// never animated (setInterval widgets, JS tickers) deliberately does not.
let viewportSettleStyleMutationAt = 0
let viewportSettleStyleObserver: MutationObserver | null = null
let viewportSettleAnimatedTargets = new WeakSet<Element>()

function recordViewportSettleAnimatedTargets(): void {
  try {
    for (const animation of document.getAnimations()) {
      if (!isRunningFiniteAnimation(animation)) continue
      const target = (animation.effect as KeyframeEffect | null)?.target
      if (target) viewportSettleAnimatedTargets.add(target)
    }
  } catch {
    // getAnimations() unavailable: the WAAPI poll and the cap still decide.
  }
}

function beginViewportSettleStyleWatch(): void {
  stopViewportSettleStyleWatch()
  viewportSettleStyleMutationAt = performance.now()
  viewportSettleAnimatedTargets = new WeakSet()
  recordViewportSettleAnimatedTargets()
  try {
    if (typeof MutationObserver !== 'function') return
    viewportSettleStyleObserver = new MutationObserver((records) => {
      const candidates = new Set<Element>()
      for (const record of records) {
        const target = record.target
        if (!(target instanceof Element) || candidates.has(target)) continue
        // Mercury's own viewport-baseline writes land only on documentElement,
        // so the own-write scope needs to cover only that target.
        if (target === document.documentElement && mercuryOwnStyleWriteDepth > 0) continue
        // Mercury's own chrome repaints as the pointer moves. Counting it would
        // hold every window open to the cap.
        if (target.closest('[data-mercury-overlay]')) continue
        if (target.closest(MERCURY_MUTATING_SELECTOR)) continue
        candidates.add(target)
      }
      if (candidates.size === 0) return
      // One document-level read per batch instead of a style flush per record.
      recordViewportSettleAnimatedTargets()
      for (const target of candidates) {
        if (!viewportSettleAnimatedTargets.has(target)) continue
        viewportSettleStyleMutationAt = performance.now()
        return
      }
    })
    viewportSettleStyleObserver.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
  } catch {
    viewportSettleStyleObserver = null
  }
}

function stopViewportSettleStyleWatch(): void {
  try {
    viewportSettleStyleObserver?.disconnect()
  } catch {
    // Already disconnected or detached.
  }
  viewportSettleStyleObserver = null
}

// Without an observer there is nothing to wait for, so report quiet and let the
// WAAPI condition and the cap decide as they did before.
function viewportSettleStyleQuietMs(): number {
  if (!viewportSettleStyleObserver) return Number.POSITIVE_INFINITY
  return performance.now() - viewportSettleStyleMutationAt
}

function isRunningFiniteAnimation(animation: Animation): boolean {
  if (animation.playState !== 'running') return false
  const timing = animation.effect?.getComputedTiming()
  return Boolean(timing && typeof timing.endTime === 'number' && Number.isFinite(timing.endTime))
}

function hasRunningFiniteDocumentAnimation(): boolean {
  try {
    return document.getAnimations().some(
      (animation) => !isMercuryOverlayAnimation(animation) && isRunningFiniteAnimation(animation),
    )
  } catch {
    return false
  }
}

function scheduleViewportAnimationFreeze(generation: number): void {
  const startedAt = performance.now()
  const settle = (): void => {
    if (generation !== viewportAnimationSettleGeneration || !viewportAnimationSettling) return
    const elapsed = performance.now() - startedAt
    const runningFinite = hasRunningFiniteDocumentAnimation()
    const styleQuietMs = viewportSettleStyleQuietMs()
    const stillAnimating = runningFinite || styleQuietMs < VIEWPORT_ANIMATION_STYLE_QUIET_MS
    if (
      elapsed < VIEWPORT_ANIMATION_MIN_SETTLE_MS ||
      (elapsed < VIEWPORT_ANIMATION_MAX_SETTLE_MS && stillAnimating)
    ) {
      viewportAnimationSettleTimer = window.setTimeout(
        settle,
        VIEWPORT_ANIMATION_SETTLE_POLL_MS,
      )
      return
    }
    viewportAnimationSettleTimer = null
    if (viewportAnimationSettleWatchdogTimer !== null) {
      window.clearTimeout(viewportAnimationSettleWatchdogTimer)
      viewportAnimationSettleWatchdogTimer = null
    }
    viewportAnimationSettling = false
    if (inspectEntranceSettleOwned) inspectEntranceSettledOnce = true
    inspectEntranceSettleOwned = false
    stopViewportSettleStyleWatch()
    syncAnimationPauseState()
    // A route can mount delayed while-in-view content throughout the settle
    // window. Snapshot only after the application clock is frozen; applying
    // earlier lets the running motion library mutate style, yield Mercury's
    // override, and suppress that target before its final frame.
    // Expanded freezes animations even when Inspect has not attached to this
    // document yet. Latch and apply the visibility snapshot here regardless of
    // Inspect state; otherwise a refresh can freeze below-fold while-in-view
    // content at opacity:0 until the user clicks that individual iframe.
    activateInspectRevealSnapshots()
  }

  // Router and IntersectionObserver callbacks may commit application work
  // asynchronously. Give them two native paints before deciding the bounded
  // entrance-animation window is finished.
  // Hidden/non-rendered documents may not receive rAF, so independently end
  // the settle period and restore the active freeze reasons via a watchdog.
  viewportAnimationSettleWatchdogTimer = window.setTimeout(
    settle,
    VIEWPORT_ANIMATION_MAX_SETTLE_MS,
  )
  bridgeRequestAnimationFrame(() => bridgeRequestAnimationFrame(settle))
}

function inspectRevealSnapshotCssText(): string {
  const rules: string[] = []
  for (const snapshot of inspectRevealSnapshotTargets.values()) {
    rules.push(
      '[' + INSPECT_REVEAL_SNAPSHOT_ATTR + '="' + snapshot.token + '"] {' +
        ' opacity: ' + String(snapshot.opacity) + ' !important;' +
        (snapshot.transform === undefined
          ? ''
          : ' transform: ' + snapshot.transform + ' !important;') +
        (snapshot.translate === undefined
          ? ''
          : ' translate: ' + snapshot.translate + ' !important;') +
        ' transition-property: none !important;' +
        ' }',
    )
  }
  return rules.join('\n')
}

function reportInspectRevealSnapshotStyleFailure(detail = ''): void {
  if (inspectRevealSnapshotStyleFailureReported) return
  inspectRevealSnapshotStyleFailureReported = true
  const error = new Error(
    'Mercury could not apply its Inspect visibility stylesheet.' +
      (detail ? ' ' + detail : '') +
      ' The page Content Security Policy may block inline styles.',
  )
  error.name = 'InspectRevealSnapshotStyleUnavailable'
  postRuntimeError('error', error)
}

function syncInspectRevealSnapshotStyle(): void {
  if (inspectRevealSnapshotTargets.size === 0) {
    try {
      inspectRevealSnapshotStyleEl?.remove()
    } catch {
      // Non-critical.
    }
    inspectRevealSnapshotStyleEl = null
    return
  }
  try {
    let el = inspectRevealSnapshotStyleEl
    if (!el?.isConnected) {
      el = document.createElement('style')
      el.id = 'mercury-inspect-reveal-snapshot-style'
      ;(document.head || document.documentElement).appendChild(el)
      inspectRevealSnapshotStyleEl = el
    }
    el.textContent = inspectRevealSnapshotCssText()
    let visibilityRuleApplied = false
    try {
      visibilityRuleApplied = Array.from(el.sheet?.cssRules ?? []).some((rule) =>
        rule.cssText.includes(INSPECT_REVEAL_SNAPSHOT_ATTR) &&
        rule.cssText.includes('opacity:'),
      )
    } catch {
      // Treat an inaccessible or blocked sheet as unavailable.
    }
    if (!visibilityRuleApplied) reportInspectRevealSnapshotStyleFailure()
  } catch (value) {
    reportInspectRevealSnapshotStyleFailure(runtimeErrorFields(value).message)
  }
}

function clearInspectRevealSnapshotTarget(target: Element, suppress = false): boolean {
  if (!inspectRevealSnapshotTargets.delete(target)) return false
  if (suppress) inspectRevealSnapshotSuppressedTargets.add(target)
  try {
    target.removeAttribute(INSPECT_REVEAL_SNAPSHOT_ATTR)
  } catch {
    // Detached targets are harmless.
  }
  return true
}

function pruneDisconnectedInspectRevealSnapshotTargets(): boolean {
  let changed = false
  for (const target of inspectRevealSnapshotTargets.keys()) {
    if (!target.isConnected) {
      changed = clearInspectRevealSnapshotTarget(target) || changed
    }
  }
  return changed
}

const DORMANT_REVEAL_INACTIVE_SELECTOR = [
  '[hidden]',
  '[inert]',
  '[aria-hidden="true"]',
  '[aria-expanded="false"]',
  '[aria-selected="false"]',
  '[data-state="closed"]',
  '[data-state="inactive"]',
  '[data-state="off"]',
].join(', ')

function isInspectRevealSnapshotCandidate(
  target: Element,
  opacityCeiling = 0.05,
  dormantInline = false,
): boolean {
  if (
    !target.isConnected ||
    inspectRevealSnapshotSuppressedTargets.has(target) ||
    target.closest('[data-mercury-overlay]') ||
    target.closest(dormantInline
      ? DORMANT_REVEAL_INACTIVE_SELECTOR
      : '[hidden], [inert], [aria-hidden="true"]')
  ) return false
  try {
    const rect = target.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const style = getComputedStyle(target)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false
    }
    const opacity = Number.parseFloat(style.opacity)
    if (!Number.isFinite(opacity) || opacity > opacityCeiling) return false

    // A hidden fixed overlay, or an absolute overlay already occupying the
    // viewport, is much more likely to be an intentionally closed dialog,
    // drawer, or carousel panel than a while-in-view entrance.
    if (style.position === 'fixed') return false
    if (dormantInline) {
      if (style.position !== 'static' && style.position !== 'relative') return false
      if (style.pointerEvents === 'none') return false
      const authoredViewportHeight =
        document.documentElement.getAttribute('data-mercury-expanded-route') === 'true'
          ? pageMeasureViewportBaselineHeight
          : window.innerHeight
      // Without observer/animation evidence, only recover content that began
      // outside the authored viewport. Inactive panels inside the initial view
      // commonly use the same opacity/translate recipe as entrance motion.
      if (rect.bottom > 0 && rect.top < authoredViewportHeight) return false
    }
    if (
      style.position === 'absolute' &&
      rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth
    ) return false
    return true
  } catch {
    return false
  }
}

function markInspectRevealSnapshotTarget(
  target: Element,
  finalOpacity = 1,
  opacityCeiling = 0.05,
  finalTransform?: string,
  finalTranslate?: string,
  dormantInline = false,
): void {
  const prunedDisconnected =
    inspectRevealSnapshotTargets.size >= INSPECT_REVEAL_TARGET_LIMIT &&
    pruneDisconnectedInspectRevealSnapshotTargets()
  if (
    inspectRevealSnapshotTargets.size >= INSPECT_REVEAL_TARGET_LIMIT ||
    inspectRevealSnapshotTargets.has(target) ||
    !isInspectRevealSnapshotCandidate(target, opacityCeiling, dormantInline)
  ) {
    if (prunedDisconnected) syncInspectRevealSnapshotStyle()
    return
  }
  const opacity = Number.isFinite(finalOpacity)
    ? Math.min(1, Math.max(0.051, finalOpacity))
    : 1
  const snapshot: InspectRevealSnapshot = {
    token: String(++inspectRevealSnapshotToken),
    opacity,
    ...(finalTransform === undefined ? {} : { transform: finalTransform }),
    ...(finalTranslate === undefined ? {} : { translate: finalTranslate }),
  }
  inspectRevealSnapshotTargets.set(target, snapshot)
  target.setAttribute(INSPECT_REVEAL_SNAPSHOT_ATTR, snapshot.token)
  if (prunedDisconnected) syncInspectRevealSnapshotStyle()
}

function animationEffectElement(animation: Animation): Element | null {
  const effectTarget = (animation.effect as { target?: unknown } | null)?.target
  if (effectTarget instanceof Element) return effectTarget
  if (effectTarget && typeof effectTarget === 'object') {
    const originatingElement = (effectTarget as { element?: unknown }).element
    if (originatingElement instanceof Element) return originatingElement
  }
  return null
}

type InspectRevealAnimationFinalState = {
  opacity: number
  transform?: string
  translate?: string
}

function entranceAnimationFinalState(
  animation: Animation,
): InspectRevealAnimationFinalState | null {
  try {
    const effect = animation.effect as KeyframeEffect | null
    const timing = effect?.getComputedTiming()
    if (!timing || typeof timing.endTime !== 'number' || !Number.isFinite(timing.endTime)) return null
    // Snapshot only animations that actually advance through the authored
    // keyframes from first to last. Reverse/alternate directions and negative
    // playback can turn a 0 -> 1 keyframe list into an exit animation.
    const authoredTiming = effect?.getTiming()
    if ((authoredTiming?.direction ?? 'normal') !== 'normal') return null
    if (!Number.isFinite(animation.playbackRate) || animation.playbackRate <= 0) return null
    const keyframes = effect?.getKeyframes?.() ?? []
    const opacityFrames = keyframes.flatMap((keyframe, index) => {
      const rawOpacity = (keyframe as Record<string, unknown>).opacity
      const opacity = typeof rawOpacity === 'number'
        ? rawOpacity
        : typeof rawOpacity === 'string'
          ? Number.parseFloat(rawOpacity)
          : Number.NaN
      if (!Number.isFinite(opacity)) return []
      const offset = typeof keyframe.computedOffset === 'number'
        ? keyframe.computedOffset
        : keyframes.length <= 1 ? 1 : index / (keyframes.length - 1)
      return [{
        offset,
        opacity,
        keyframe: keyframe as Record<string, unknown>,
      }]
    }).sort((left, right) => left.offset - right.offset)
    const first = opacityFrames[0]
    const last = opacityFrames[opacityFrames.length - 1]
    if (!first || !last || first.opacity > 0.05 || last.opacity <= first.opacity) return null
    const transform = typeof last.keyframe.transform === 'string'
      ? last.keyframe.transform
      : undefined
    const translate = typeof last.keyframe.translate === 'string'
      ? last.keyframe.translate
      : undefined
    return {
      opacity: last.opacity,
      ...(transform === undefined ? {} : { transform }),
      ...(translate === undefined ? {} : { translate }),
    }
  } catch {
    return null
  }
}

function entranceAnimationFinalOpacity(animation: Animation): number | null {
  return entranceAnimationFinalState(animation)?.opacity ?? null
}

function isObservedTargetOutsideViewport(target: Element): boolean {
  // Geometry is authoritative for Mercury's actual iframe viewport. An app
  // observer may use a positive rootMargin and report an element intersecting
  // hundreds of pixels before it is visible on screen.
  try {
    const rect = target.getBoundingClientRect()
    if (
      rect.bottom <= 0 || rect.right <= 0 ||
      rect.top >= window.innerHeight || rect.left >= window.innerWidth
    ) return true
  } catch {
    // Fall back to the observer reports below.
  }
  const reports = activeObservedViewportReports(target)
  if (reports) {
    const states = Array.from(reports.entries())
      .filter(([token]) => token.active)
      .map(([, state]) => state)
    if (states.some((state) => state === false)) return true
  }
  return false
}

function observedViewportTargetStartedHidden(target: Element): boolean {
  if (initiallyHiddenObservedViewportTargets.has(target)) return true
  if (
    !hasActiveObservedViewportTarget(target) &&
    !recentlyUnobservedViewportTargets.has(target)
  ) return false
  if (!isInspectRevealSnapshotCandidate(target)) return false
  initiallyHiddenObservedViewportTargets.add(target)
  return true
}

function applyInspectRevealRoot(root: Element): void {
  if (!root.isConnected) return
  const outsideViewport = isObservedTargetOutsideViewport(root)
  const observerStartedHidden = observedViewportTargetStartedHidden(root)
  const dormantFinalGeometry = initiallyHiddenInlineRevealTargets.has(root)
    ? dormantInlineRevealFinalGeometry(root)
    : null
  const dormantInline = dormantFinalGeometry !== null
  recentlyUnobservedViewportTargets.delete(root)
  activeObservedViewportReports(root)
  if (!outsideViewport && !observerStartedHidden && !dormantInline) return

  if (dormantFinalGeometry && !observerStartedHidden) {
    markInspectRevealSnapshotTarget(
      root,
      1,
      0.999,
      dormantFinalGeometry.transform,
      dormantFinalGeometry.translate,
      true,
    )
    return
  }

  // On a first Expanded load, the bridge can freeze before a motion library's
  // initial IntersectionObserver callback creates an Animation. Remembering
  // that the observed root began hidden lets us reveal a partially progressed
  // or still-zero root even when it is geometrically inside the tall iframe.
  let visited = 0
  const visit = (target: Element, opacityCeiling = 0.05): void => {
    if (visited >= INSPECT_REVEAL_DESCENDANT_LIMIT) return
    visited += 1
    markInspectRevealSnapshotTarget(target, 1, opacityCeiling)
  }
  visit(root, observerStartedHidden ? 0.999 : 0.05)
  if (!outsideViewport && !observerStartedHidden) return
  for (const descendant of root.querySelectorAll('*')) {
    if (visited >= INSPECT_REVEAL_DESCENDANT_LIMIT) break
    visit(descendant)
  }
}

function applyInspectRevealAnimation(animation: Animation): void {
  if (isMercuryOverlayAnimation(animation)) return
  // Registered CSS animations remain live so their external controls are visible.
  if (allowRegisteredAnimations() && animationEffectElement(animation)?.closest('[data-mercury-controls]')) return
  const finalState = entranceAnimationFinalState(animation)
  const target = finalState === null ? null : animationEffectElement(animation)
  if (target && finalState) {
    markInspectRevealSnapshotTarget(
      target,
      finalState.opacity,
      finalState.opacity - 0.001,
      finalState.transform,
      finalState.translate,
    )
  }
}

function inspectRevealSnapshotsCanApply(): boolean {
  return inspectRevealSnapshotLatched &&
    !inspectRenderPriming &&
    !viewportAnimationSettling &&
    animationsPaused
}

function applyInspectRevealSnapshots(): void {
  // Never write a visibility override while application animations can still
  // advance. Their next class/style mutation would correctly yield the
  // override as an authored edit, but would then leave a delayed reveal
  // permanently suppressed at an intermediate (often zero) opacity.
  if (!inspectRevealSnapshotsCanApply()) return
  const expandedRouteActive =
    document.documentElement.getAttribute('data-mercury-expanded-route') === 'true'
  // Existing snapshots stay in place through Comment mode and the brief
  // Inspect-to-expanded teardown, but only active Inspect (or a still-expanded
  // frame) discovers new targets.
  if ((!inspectEnabled || cursorMode !== 'inspect') && !expandedRouteActive) return

  // Prefer an authored animation's final opacity when one exists. The root
  // fallback below uses 1 only when first-load timing prevented the library
  // from creating an Animation at all.
  const snapshotCountBefore = inspectRevealSnapshotTargets.size
  for (const animation of pendingInspectRevealAnimations) {
    pendingInspectRevealAnimations.delete(animation)
    applyInspectRevealAnimation(animation)
  }

  for (const target of pendingInspectRevealRoots) {
    pendingInspectRevealRoots.delete(target)
    if (!target.isConnected) continue
    applyInspectRevealRoot(target)
  }
  const snapshotsAdded = inspectRevealSnapshotTargets.size - snapshotCountBefore
  // Rewriting the snapshot stylesheet emits a childList mutation. The Inspect
  // mutation observer schedules another reveal scan for that mutation, so a
  // no-op rewrite here would feed itself forever while the document is frozen.
  // Adds are the only stylesheet changes made by this path; authored clears
  // synchronize the sheet directly from onInspectAnimationMutations().
  if (snapshotsAdded > 0) syncInspectRevealSnapshotStyle()
}

function enqueueInspectRevealRoots(roots: Iterable<Element>): void {
  for (const root of roots) {
    if (pendingInspectRevealRoots.size >= INSPECT_REVEAL_TARGET_LIMIT) break
    pendingInspectRevealRoots.add(root)
  }
}

function enqueueInspectRevealAnimations(animations: Iterable<Animation>): void {
  for (const animation of animations) {
    if (pendingInspectRevealAnimations.size >= INSPECT_REVEAL_ANIMATION_LIMIT) break
    pendingInspectRevealAnimations.add(animation)
  }
}

function scheduleInspectRevealSnapshotScan(
  roots: Iterable<Element> = [],
  animations: Iterable<Animation> = [],
): void {
  if (!inspectRevealSnapshotLatched) return
  if (inspectEnabled && cursorMode !== 'inspect') return
  enqueueInspectRevealRoots(roots)
  enqueueInspectRevealAnimations(animations)
  if (
    inspectRevealSnapshotScanFrame !== null ||
    inspectRevealSnapshotScanTimer !== null
  ) return

  // Chromium may defer requestAnimationFrame indefinitely for a small,
  // unselected iframe on a zoomed-out canvas. Selecting another frame and then
  // returning makes that iframe paint again, which is why a pending first-load
  // reveal can appear to fix itself on the second selection. Keep rAF as the
  // preferred paint-aligned path, but race it with an asynchronous timer so a
  // frozen frame finalizes its already-bounded dirty queues without requiring
  // user interaction. Do not drain synchronously from observe()/MutationObserver:
  // generated apps can register many targets in one commit.
  const applyScheduledScan = (): void => {
    if (inspectRevealSnapshotScanFrame !== null) {
      bridgeCancelAnimationFrame(inspectRevealSnapshotScanFrame)
      inspectRevealSnapshotScanFrame = null
    }
    if (inspectRevealSnapshotScanTimer !== null) {
      window.clearTimeout(inspectRevealSnapshotScanTimer)
      inspectRevealSnapshotScanTimer = null
    }
    applyInspectRevealSnapshots()
  }
  inspectRevealSnapshotScanFrame = bridgeRequestAnimationFrame(applyScheduledScan)
  inspectRevealSnapshotScanTimer = window.setTimeout(
    applyScheduledScan,
    INSPECT_REVEAL_SCAN_FALLBACK_MS,
  )
}

function inspectRevealDiscoveryTarget(target: Element): void {
  if (inspectRevealDiscoveryVisited.has(target)) return
  inspectRevealDiscoveryVisited.add(target)
  inspectRevealDiscoveryVisitCount += 1
  enqueueDormantInlineRevealRoot(target)
  if (
    pendingInspectRevealRoots.size < INSPECT_REVEAL_TARGET_LIMIT &&
    (
      hasActiveObservedViewportTarget(target) ||
      initiallyHiddenObservedViewportTargets.has(target) ||
      recentlyUnobservedViewportTargets.has(target)
    )
  ) pendingInspectRevealRoots.add(target)
}

function resetCurrentInspectRevealDiscoveryRoot(): void {
  inspectRevealDiscoveryWalker = null
  inspectRevealDiscoveryRoot = null
  inspectRevealDiscoveryRootPending = false
}

function beginNextInspectRevealDiscoveryRoot(): boolean {
  for (const root of pendingInspectRevealDiscoveryRoots) {
    pendingInspectRevealDiscoveryRoots.delete(root)
    if (!root.isConnected) continue
    try {
      inspectRevealDiscoveryRoot = root
      inspectRevealDiscoveryRootPending = true
      inspectRevealDiscoveryWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
      return true
    } catch {
      resetCurrentInspectRevealDiscoveryRoot()
    }
  }
  return false
}

function drainInspectRevealDiscovery(): void {
  inspectRevealDiscoveryTimer = null
  if (!inspectRevealSnapshotLatched) return
  let traversed = 0
  while (
    traversed < INSPECT_REVEAL_DISCOVERY_CHUNK_SIZE &&
    inspectRevealDiscoveryVisitCount < INSPECT_REVEAL_DISCOVERY_LIMIT
  ) {
    if (!inspectRevealDiscoveryRoot && !beginNextInspectRevealDiscoveryRoot()) break
    let target: Element | null = null
    if (inspectRevealDiscoveryRootPending) {
      inspectRevealDiscoveryRootPending = false
      target = inspectRevealDiscoveryRoot
    } else {
      target = inspectRevealDiscoveryWalker?.nextNode() as Element | null
    }
    if (!target) {
      resetCurrentInspectRevealDiscoveryRoot()
      continue
    }
    traversed += 1
    inspectRevealDiscoveryTarget(target)
  }
  applyInspectRevealSnapshots()

  const hasMoreWork = Boolean(
    inspectRevealDiscoveryRoot || pendingInspectRevealDiscoveryRoots.size > 0,
  )
  if (hasMoreWork && inspectRevealDiscoveryVisitCount < INSPECT_REVEAL_DISCOVERY_LIMIT) {
    inspectRevealDiscoveryTimer = window.setTimeout(drainInspectRevealDiscovery, 0)
    return
  }
  if (inspectRevealDiscoveryVisitCount >= INSPECT_REVEAL_DISCOVERY_LIMIT) {
    pendingInspectRevealDiscoveryRoots.clear()
    resetCurrentInspectRevealDiscoveryRoot()
  }
}

function scheduleInspectRevealDiscovery(root: Element): void {
  if (
    !inspectRevealSnapshotLatched ||
    inspectRevealDiscoveryVisitCount >= INSPECT_REVEAL_DISCOVERY_LIMIT ||
    pendingInspectRevealDiscoveryRoots.size >= INSPECT_REVEAL_DISCOVERY_ROOT_LIMIT
  ) return
  pendingInspectRevealDiscoveryRoots.add(root)
  if (inspectRevealDiscoveryTimer === null) {
    inspectRevealDiscoveryTimer = window.setTimeout(drainInspectRevealDiscovery, 0)
  }
}

function activateInspectRevealSnapshots(): void {
  inspectRevealSnapshotLatched = true
  if (!inspectRevealDocumentDiscoveryQueued && document.documentElement) {
    inspectRevealDocumentDiscoveryQueued = true
    scheduleInspectRevealDiscovery(document.documentElement)
  }
  try {
    enqueueInspectRevealAnimations(document.getAnimations())
  } catch {
    // Animation-effect discovery is a best-effort supplement to IO tracking.
  }
  applyInspectRevealSnapshots()
  // React and motion libraries often install observers/effects in a commit
  // immediately after the mode message. A private bridge frame sees that work
  // while the application's own scheduler remains suspended.
  scheduleInspectRevealSnapshotScan()
}

function clearInspectRevealSnapshots(): void {
  inspectRevealSnapshotLatched = false
  if (inspectRevealSnapshotScanFrame !== null) {
    bridgeCancelAnimationFrame(inspectRevealSnapshotScanFrame)
    inspectRevealSnapshotScanFrame = null
  }
  if (inspectRevealSnapshotScanTimer !== null) {
    window.clearTimeout(inspectRevealSnapshotScanTimer)
    inspectRevealSnapshotScanTimer = null
  }
  if (inspectRevealDiscoveryTimer !== null) {
    window.clearTimeout(inspectRevealDiscoveryTimer)
    inspectRevealDiscoveryTimer = null
  }
  pendingInspectRevealDiscoveryRoots.clear()
  resetCurrentInspectRevealDiscoveryRoot()
  inspectRevealDiscoveryVisited = new WeakSet<Element>()
  inspectRevealDiscoveryVisitCount = 0
  inspectRevealDocumentDiscoveryQueued = false
  for (const target of inspectRevealSnapshotTargets.keys()) {
    try {
      target.removeAttribute(INSPECT_REVEAL_SNAPSHOT_ATTR)
    } catch {
      // A detached target is harmless.
    }
  }
  inspectRevealSnapshotTargets.clear()
  inspectRevealSnapshotSuppressedTargets = new WeakSet<Element>()
  initiallyHiddenInlineRevealTargets = new WeakSet<Element>()
  pendingInspectRevealRoots.clear()
  pendingInspectRevealAnimations.clear()
  try {
    inspectRevealSnapshotStyleEl?.remove()
  } catch {
    // Non-critical.
  }
  inspectRevealSnapshotStyleEl = null
}

function createObservedViewportToken(): ObservedViewportToken {
  return { id: ++intersectionObserverToken, active: true }
}

function activeObservedViewportReports(
  target: Element,
): Map<ObservedViewportToken, boolean | null> | null {
  const reports = observedViewportTargets.get(target)
  if (!reports) return null
  for (const token of reports.keys()) {
    if (!token.active) reports.delete(token)
  }
  if (reports.size === 0) {
    observedViewportTargets.delete(target)
    return null
  }
  return reports
}

function hasActiveObservedViewportTarget(target: Element): boolean {
  return activeObservedViewportReports(target) !== null
}

function hasInitiallyHiddenInlineOpacity(target: Element): boolean {
  // Reading the inline declaration is layout-free. Do not call
  // getBoundingClientRect()/getComputedStyle() from observe(): libraries often
  // register hundreds of targets while React is still committing DOM writes.
  const style = (target as Element & { style?: CSSStyleDeclaration }).style
  if (!style) return false
  const opacity = Number.parseFloat(style.opacity)
  return Number.isFinite(opacity) && opacity <= 0.05
}

function inlineCssLengthIsNonZero(value: string | undefined): boolean {
  if (!value) return false
  const numericValue = Number.parseFloat(value)
  return Number.isFinite(numericValue) && Math.abs(numericValue) > 0.01
}

function inlineCssLengthIsZero(value: string | undefined): boolean {
  if (!value) return false
  const numericValue = Number.parseFloat(value)
  return Number.isFinite(numericValue) && Math.abs(numericValue) <= 0.01
}

type DormantInlineRevealFinalGeometry = {
  transform?: 'none'
  translate?: 'none'
}

function dormantInlineRevealFinalGeometry(
  target: Element,
): DormantInlineRevealFinalGeometry | null {
  // Accept only a pure vertical translation whose safe final geometry is
  // unambiguous. Mixed transforms and horizontal offsets are commonly inactive
  // slides; removing those would alter application state rather than complete
  // an entrance reveal.
  const style = (target as Element & { style?: CSSStyleDeclaration }).style
  if (!style) return null
  const transform = style.transform?.trim() ?? ''
  const transformY = /^translateY\(\s*([^,)]+)\s*\)$/i.exec(transform)?.[1]
  if (inlineCssLengthIsNonZero(transformY)) return { transform: 'none' }
  const transform3d =
    /^translate3d\(\s*([^,]+),\s*([^,]+),\s*([^,)]+)\s*\)$/i.exec(transform)
  if (
    transform3d &&
    inlineCssLengthIsZero(transform3d[1]) &&
    inlineCssLengthIsNonZero(transform3d[2]) &&
    inlineCssLengthIsZero(transform3d[3])
  ) return { transform: 'none' }
  const transform2d = /^translate\(\s*([^,]+),\s*([^,)]+)\s*\)$/i.exec(transform)
  if (
    transform2d &&
    inlineCssLengthIsZero(transform2d[1]) &&
    inlineCssLengthIsNonZero(transform2d[2])
  ) return { transform: 'none' }

  // CSS individual transforms use the "translate: x y" form; one value is x.
  const translateParts = (style.translate?.trim() ?? '').split(/\s+/).filter(Boolean)
  if (
    (!transform || transform === 'none') &&
    translateParts.length >= 2 &&
    inlineCssLengthIsZero(translateParts[0]) &&
    inlineCssLengthIsNonZero(translateParts[1]) &&
    (translateParts.length < 3 || inlineCssLengthIsZero(translateParts[2]))
  ) return { translate: 'none' }
  return null
}

function hasInlineVerticalRevealOffset(target: Element): boolean {
  return dormantInlineRevealFinalGeometry(target) !== null
}

function enqueueDormantInlineRevealRoot(target: Element): boolean {
  if (
    pendingInspectRevealRoots.size >= INSPECT_REVEAL_TARGET_LIMIT ||
    !hasInitiallyHiddenInlineOpacity(target) ||
    !hasInlineVerticalRevealOffset(target) ||
    target.closest('[data-mercury-overlay], ' + DORMANT_REVEAL_INACTIVE_SELECTOR) ||
    !isInspectRevealSnapshotCandidate(target, 0.999, true)
  ) return false
  initiallyHiddenInlineRevealTargets.add(target)
  if (pendingInspectRevealRoots.has(target)) return false
  pendingInspectRevealRoots.add(target)
  return true
}

function trackObservedViewportTarget(observerToken: ObservedViewportToken, target: Element): void {
  const reports = activeObservedViewportReports(target) ??
    new Map<ObservedViewportToken, boolean | null>()
  if (!reports.has(observerToken)) {
    reports.set(observerToken, null)
    if (hasInitiallyHiddenInlineOpacity(target)) {
      initiallyHiddenObservedViewportTargets.add(target)
    }
  }
  recentlyUnobservedViewportTargets.delete(target)
  observedViewportTargets.set(target, reports)
  if (inspectRevealSnapshotLatched) scheduleInspectRevealSnapshotScan([target])
}

function untrackObservedViewportTarget(observerToken: ObservedViewportToken, target: Element): void {
  const reports = observedViewportTargets.get(target)
  if (!reports) return
  reports.delete(observerToken)
  if (reports.size === 0) {
    observedViewportTargets.delete(target)
    recentlyUnobservedViewportTargets.add(target)
  }
}

function recordObservedViewportEntries(
  observerToken: ObservedViewportToken,
  entries: IntersectionObserverEntry[],
): Element[] {
  if (!observerToken.active) return []
  const dirtyTargets: Element[] = []
  for (const entry of entries) {
    const reports = activeObservedViewportReports(entry.target)
    if (!reports?.has(observerToken)) continue
    reports.set(observerToken, entry.isIntersecting)
    // Queue both positive and negative reports. Mercury's actual viewport
    // geometry decides whether a rootMargin-expanded positive is truly visible.
    dirtyTargets.push(entry.target)
  }
  return dirtyTargets
}

function installIntersectionObserverSnapshotTracking(): void {
  try {
    const NativeIntersectionObserver = window.IntersectionObserver
    if (typeof NativeIntersectionObserver !== 'function') return
    class MercuryIntersectionObserver extends NativeIntersectionObserver {
      private mercuryObserverTokenRef: { current: ObservedViewportToken }

      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        const observerTokenRef = { current: createObservedViewportToken() }
        super((entries, nativeObserver) => {
          const dirtyTargets = recordObservedViewportEntries(observerTokenRef.current, entries)
          callback.call(nativeObserver, entries, nativeObserver)
          if (dirtyTargets.length > 0) scheduleInspectRevealSnapshotScan(dirtyTargets)
        }, options)
        this.mercuryObserverTokenRef = observerTokenRef
      }

      observe(target: Element): void {
        if (!this.mercuryObserverTokenRef.current.active) {
          this.mercuryObserverTokenRef.current = createObservedViewportToken()
        }
        super.observe(target)
        trackObservedViewportTarget(this.mercuryObserverTokenRef.current, target)
      }

      unobserve(target: Element): void {
        super.unobserve(target)
        untrackObservedViewportTarget(this.mercuryObserverTokenRef.current, target)
      }

      disconnect(): void {
        super.disconnect()
        // Invalidating the token drops every report without retaining a strong
        // target set solely to enumerate it here.
        this.mercuryObserverTokenRef.current.active = false
      }

      takeRecords(): IntersectionObserverEntry[] {
        const entries = super.takeRecords()
        const dirtyTargets = recordObservedViewportEntries(
          this.mercuryObserverTokenRef.current,
          entries,
        )
        if (dirtyTargets.length > 0) scheduleInspectRevealSnapshotScan(dirtyTargets)
        return entries
      }
    }
    window.IntersectionObserver = MercuryIntersectionObserver as typeof IntersectionObserver
  } catch {
    // Snapshot tracking is best-effort on runtimes that expose a non-writable
    // observer constructor.
  }
}

function cancelInspectRenderPrime(): void {
  inspectRenderPrimeGeneration += 1
  inspectRenderPriming = false
  if (inspectRenderPrimeTimer !== null) {
    window.clearTimeout(inspectRenderPrimeTimer)
    inspectRenderPrimeTimer = null
  }
  if (inspectRenderPrimeFrame !== null) {
    bridgeCancelAnimationFrame(inspectRenderPrimeFrame)
    inspectRenderPrimeFrame = null
  }
  if (inspectRenderPrimeFrameTimer !== null) {
    window.clearTimeout(inspectRenderPrimeFrameTimer)
    inspectRenderPrimeFrameTimer = null
  }
}

function beginInspectRenderPrime(): void {
  const expandedRouteActive =
    document.documentElement.getAttribute('data-mercury-expanded-route') === 'true'
  if ((!inspectEnabled || cursorMode !== 'inspect') && !expandedRouteActive) return
  cancelInspectRenderPrime()
  inspectRenderPriming = true
  const generation = inspectRenderPrimeGeneration

  const finish = (): void => {
    if (generation !== inspectRenderPrimeGeneration || !inspectRenderPriming) return
    inspectRenderPriming = false
    if (inspectRenderPrimeTimer !== null) {
      window.clearTimeout(inspectRenderPrimeTimer)
      inspectRenderPrimeTimer = null
    }
    if (inspectRenderPrimeFrame !== null) {
      bridgeCancelAnimationFrame(inspectRenderPrimeFrame)
      inspectRenderPrimeFrame = null
    }
    if (inspectRenderPrimeFrameTimer !== null) {
      window.clearTimeout(inspectRenderPrimeFrameTimer)
      inspectRenderPrimeFrameTimer = null
    }
    syncAnimationPauseState()
    activateInspectRevealSnapshots()
  }

  // Let React/router flush rAF-scheduled mount work exactly once when Inspect
  // starts or changes route. This is deliberately unrelated to IO, scrolling,
  // resizing, canvas pan, or canvas zoom, so gestures can never restart motion.
  inspectRenderPrimeTimer = window.setTimeout(finish, INSPECT_RENDER_PRIME_MAX_MS)
  let frameCount = 0
  const advance = (): void => {
    if (generation !== inspectRenderPrimeGeneration || !inspectRenderPriming) return
    inspectRenderPrimeFrame = null
    if (inspectRenderPrimeFrameTimer !== null) {
      window.clearTimeout(inspectRenderPrimeFrameTimer)
      inspectRenderPrimeFrameTimer = null
    }
    frameCount += 1
    if (frameCount >= INSPECT_RENDER_PRIME_FRAME_LIMIT) {
      finish()
      return
    }
    scheduleFrame()
  }
  const advanceWithoutNativePaint = (): void => {
    if (generation !== inspectRenderPrimeGeneration || !inspectRenderPriming) return
    inspectRenderPrimeFrameTimer = null
    if (inspectRenderPrimeFrame !== null) {
      bridgeCancelAnimationFrame(inspectRenderPrimeFrame)
      inspectRenderPrimeFrame = null
    }
    appAnimationFrameScheduler.flushPendingFrame(performance.now())
    advance()
  }
  const scheduleFrame = (): void => {
    inspectRenderPrimeFrame = bridgeRequestAnimationFrame(advance)
    inspectRenderPrimeFrameTimer = window.setTimeout(
      advanceWithoutNativePaint,
      INSPECT_RENDER_PRIME_FRAME_FALLBACK_MS,
    )
  }
  scheduleFrame()
}

function primeAnimationRenderAfterDocumentLoad(): void {
  const expandedRouteActive =
    document.documentElement.getAttribute('data-mercury-expanded-route') === 'true'
  if ((!inspectEnabled || cursorMode !== 'inspect') && !expandedRouteActive) return

  // The bridge announces ready before React mounts. If the parent restores
  // Inspect/Expanded immediately after an iframe reload, that first prime can
  // therefore finish against an empty body. Re-prime once at the document's
  // actual load boundary—the same resume window a later frame activation gets.
  // This is a one-shot lifecycle event, never a scroll/pan/zoom trigger.
  // An Inspect window opened before mount can close at its floor before the
  // entrance starts, so Inspect restarts its own window here; a route-owned
  // window is left to finish.
  if (
    inspectEnabled &&
    cursorMode === 'inspect' &&
    (!viewportAnimationSettling || inspectEntranceSettleOwned)
  ) {
    beginInspectEntranceSettle()
    return
  }
  beginInspectRenderPrime()
  syncAnimationPauseState()
}

function syncAnimationPauseState(): void {
  const expandedRouteActive =
    document.documentElement.getAttribute('data-mercury-expanded-route') === 'true'
  // Inspect requests a freeze for its one armed frame. Comment mode freezes
  // only the granted track and whichever document the pointer is actually in,
  // so an annotation still lands on a still target without arming the whole
  // canvas. Inspect is a hard freeze after a one-time bounded render prime:
  // reveal snapshots make later hidden viewport entrances visible without
  // advancing the application clock during canvas or iframe gestures.
  const freezeOwned =
    cursorMode === 'inspect' || animationFreezeGranted || commentPointerEngaged
  const inspectFreezeActive = inspectEnabled && freezeOwned
  // Expansion and Inspect are normally enabled back-to-back. The short Inspect
  // prime can finish before the expanded viewport has settled; freezing at that
  // point cuts off the longer render window and leaves below-fold entrances at
  // their initial opacity. Let the active settle window win, then freeze both
  // reasons together when scheduleViewportAnimationFreeze() completes.
  // maxDemo keeps app motion running in both capture tools; normal clients
  // (including those without the optional field) retain the freeze policy.
  const shouldPause =
    !(demoKeepAnimationsRunning && inspectEnabled) &&
    !interactionPreview &&
    !inspectRenderPriming &&
    !viewportAnimationSettling &&
    (inspectFreezeActive || expandedRouteActive)
  if (animationsPaused && registeredAnimationsLive !== allowRegisteredAnimations()) resumeAllAnimations()
  if (shouldPause) {
    pauseAllAnimations()
  } else {
    resumeAllAnimations()
  }
}

// The pointer entering this document is what makes it the likely comment target,
// and it always precedes the click that computes the annotation's anchor — for
// touch via pointerdown, where no hover occurs. Claiming the freeze here is what
// keeps the first comment on an unfocused track anchored to a still element.
function setCommentPointerEngaged(engaged: boolean): void {
  if (commentPointerEngaged === engaged) return
  commentPointerEngaged = engaged
  syncAnimationPauseState()
}

function setInspectMode(
  next: boolean,
  nextCommentMode = false,
  nextFreezeGranted = false,
  nextTestInteraction = false,
): void {
  const sessionEnabled = next
  const previousInteractionPreview = interactionPreview
  interactionPreview = next && nextTestInteraction && !nextCommentMode
  if (interactionPreview) clearInspectRevealSnapshots()
  next = next && !interactionPreview
  const nextCursorMode = nextCommentMode ? 'comment' : 'inspect'
  const grantChanged = animationFreezeGranted !== nextFreezeGranted
  animationFreezeGranted = nextFreezeGranted
  if (inspectEnabled === next && cursorMode === nextCursorMode && previousInteractionPreview === interactionPreview) {
    // The mode is unchanged but freeze ownership may have moved to or away from
    // this frame, so the pause state still has to be reconciled.
    if (grantChanged) syncAnimationPauseState()
    post({ source: 'mercury-bridge', type: 'inspect-mode-changed', enabled: sessionEnabled, cursorMode })
    return
  }
  const wasEnabled = inspectEnabled
  inspectEnabled = next
  cursorMode = nextCursorMode
  if (!inspectEnabled) {
    cancelInspectRenderPrime()
    releaseInspectSpacePan()
    finishInlineTextEdit(true)
    cancelInspectMove()
    cancelInspectResize()
    hideOverlay()
    if (!interactionPreview) setSelectedTarget(null)
    suppressNextClickTarget = null
    commentPointerEngaged = false
  }
  if (inspectEnabled && cursorMode === 'inspect' && !wasEnabled && !inspectEntranceSettledOnce) {
    // The render prime is a fixed 4-frame / 200ms budget, which is shorter than
    // an ordinary entrance transition (framer-motion's defaults and typical
    // authored durations sit in the 300-500ms range). Freezing at the end of it
    // caught mid-flight opacity/transform values, so a stacked-card layout that
    // separates its cards over 320ms was inspected while still collapsed and
    // semi-transparent. Route changes already wait for entrance animations to
    // finish via the settle window; give plain Inspect activation the same one.
    beginInspectEntranceSettle()
  } else if (inspectEnabled && cursorMode === 'inspect') {
    // Comment -> Inspect, or re-entering Inspect after this document's
    // entrance already settled once: there is no fresh entrance to wait for.
    // Opening a new window would resume and re-freeze the frame, which can
    // move comment pin anchors and advance autoplay/ticker state.
    beginInspectRenderPrime()
    syncAnimationPauseState()
  } else if (
    !inspectEnabled &&
    document.documentElement.getAttribute('data-mercury-expanded-route') !== 'true'
  ) {
    releaseInspectEntranceSettle()
    clearInspectRevealSnapshots()
    syncAnimationPauseState()
  } else if (inspectEnabled) {
    // Inspect -> Comment: an Inspect-owned window keeps running to its own
    // poll, so Comment's freeze lands on the settled frame, not mid-entrance.
    cancelInspectRenderPrime()
    syncAnimationPauseState()
  } else {
    // Leaving Inspect ends the entrance the window was opened for. Left owned
    // it would keep protecting itself from the viewport cancel.
    releaseInspectEntranceSettle()
    cancelInspectRenderPrime()
    syncAnimationPauseState()
  }
  setInspectCursorOverride(inspectEnabled, cursorMode)
  positionSelectedOverlay()
  post({ source: 'mercury-bridge', type: 'inspect-mode-changed', enabled: sessionEnabled, cursorMode })
}

// ---------------------------------------------------------------------------
// Optimistic-preview channel.
//
// The parent applies a mutation immediately so the user sees instant feedback,
// and in parallel kicks off the AST + Vite rebuild on the backend. If the
// rebuild succeeds the optimistic state and the rebuilt state converge and
// nothing more happens; if it fails the parent sends revert-dom to roll back.
//
// Mutations are tracked per mutationId. We capture the prior value of every
// node we touch so revert is exact — including for shared oids that hit
// multiple nodes simultaneously (calculator buttons rendered via .map()).
// ---------------------------------------------------------------------------

type MutationOp = 'setText' | 'setTextSegment' | 'setClassName' | 'setStyle' | 'setAttribute' | 'setSvgPrimaryFill' | 'replaceSvgMarkup' | 'reorderChild' | 'setColorOverride' | 'setPropertyOverride' | 'loadGoogleFont' | 'removeElement'

// Marks a node the panel optimistically deleted. It stays in the DOM (see
// removeElement) but must be invisible to instance indexing.
const DELETED_MARK_ATTR = 'data-mercury-deleted'

// How long to leave an optimistically deleted node hidden after the server acks.
// Longer than the frontend's HMR settle window (5s), so the ordinary path -- the
// bundle turns over and the node is discarded -- always wins the race.
const DELETED_RESTORE_GRACE_MS = 6000

// React owns the children of rendered <svg> elements. Replacing innerHTML for
// an instant preview detaches React's fiber-owned nodes and can crash the next
// reconciliation. Instead, keep those children mounted but transparent and
// paint the replacement through a Mercury-owned <image> child. Keeping the
// preview inside the authored SVG makes its transforms, clipping, opacity and
// stacking context apply naturally. The source edit still happens only at the
// ordinary save boundary.
const SVG_PREVIEW_SCOPE_ATTR = 'data-mercury-svg-preview'
const SVG_PREVIEW_STYLE_ID = 'mercury-svg-preview-style'
const SVG_PREVIEW_MAX_MARKUP_LENGTH = 200_000
const SVG_PREVIEW_HANDOFF_GRACE_MS = 6000
const SVG_PREVIEW_UNSAFE_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'animate',
  'animatemotion',
  'animatetransform',
  'discard',
  'set',
])
const SVG_PREVIEW_ROOT_ATTRIBUTES: ReadonlyArray<[string, string]> = [
  ['viewBox', 'viewBox'],
  ['fill', 'fill'],
  ['stroke', 'stroke'],
  ['strokeWidth', 'stroke-width'],
  ['strokeLinecap', 'stroke-linecap'],
  ['strokeLinejoin', 'stroke-linejoin'],
  ['strokeMiterlimit', 'stroke-miterlimit'],
  ['strokeDasharray', 'stroke-dasharray'],
  ['strokeDashoffset', 'stroke-dashoffset'],
  ['fillRule', 'fill-rule'],
  ['clipRule', 'clip-rule'],
  ['preserveAspectRatio', 'preserveAspectRatio'],
  ['color', 'color'],
]
const SVG_PREVIEW_ROOT_ATTRIBUTE_NAMES = new Set(
  SVG_PREVIEW_ROOT_ATTRIBUTES.map(([property]) => property),
)

type SvgPreviewPayload = {
  root: Element
  rootAttributes: Record<string, string>
}

type SvgPreviewSnapshot = {
  op: 'replaceSvgMarkup'
  el: HTMLElement
  overlay: SVGImageElement
  token: string
  committed: boolean
  handoffTimer: ReturnType<typeof setTimeout> | null
}

let svgPreviewTokenCounter = 0
const activeSvgPreviews = new Set<SvgPreviewSnapshot>()

function svgPreviewLocalName(value: string): string {
  const colon = value.lastIndexOf(':')
  return (colon >= 0 ? value.slice(colon + 1) : value).toLowerCase()
}

function normalizeSvgPreviewCss(value: string): string {
  const decodedCss = value.replace(
    /\\([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|\\(\r\n|[\n\r\f])|\\(.)/gis,
    (_match, hex: string | undefined, newline: string | undefined, escaped: string | undefined) => {
      if (hex) {
        const codePoint = Number.parseInt(hex, 16)
        if (codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          return '\ufffd'
        }
        return String.fromCodePoint(codePoint)
      }
      if (newline) return ''
      return escaped ?? ''
    },
  )
  return decodedCss.replace(/\/\*[\s\S]*?\*\//g, '')
}

function svgPreviewHasUnsafeCss(value: string): boolean {
  const normalized = normalizeSvgPreviewCss(value)
  if (/@import\b/i.test(normalized) || /javascript\s*:/i.test(normalized)) return true
  const urlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi
  for (const match of normalized.matchAll(urlPattern)) {
    const target = match[2]?.trim() ?? ''
    if (!target.startsWith('#')) return true
  }
  return false
}

function readSvgPreviewPayload(value: unknown): SvgPreviewPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as { markup?: unknown; viewBox?: unknown; rootAttributes?: unknown }
  if (
    typeof raw.markup !== 'string' ||
    raw.markup.length === 0 ||
    raw.markup.length > SVG_PREVIEW_MAX_MARKUP_LENGTH ||
    /<!DOCTYPE\b|<!ENTITY\b/i.test(raw.markup) ||
    /<\?(?!xml(?:\s|\?>))/i.test(raw.markup) ||
    raw.markup.includes('\u0000')
  ) return null

  if (
    raw.rootAttributes !== undefined &&
    (!raw.rootAttributes || typeof raw.rootAttributes !== 'object' || Array.isArray(raw.rootAttributes))
  ) return null
  const rootAttributes: Record<string, string> = {}
  for (const [name, attributeValue] of Object.entries(
    (raw.rootAttributes ?? {}) as Record<string, unknown>,
  )) {
    if (
      !SVG_PREVIEW_ROOT_ATTRIBUTE_NAMES.has(name) ||
      typeof attributeValue !== 'string'
    ) return null
    const normalized = attributeValue.trim()
    if (
      !normalized ||
      normalized.length > 500 ||
      /[\u0000-\u001f\u007f]/.test(normalized) ||
      svgPreviewHasUnsafeCss(normalized)
    ) return null
    rootAttributes[name] = normalized
  }
  if (
    !rootAttributes.viewBox &&
    typeof raw.viewBox === 'string' &&
    raw.viewBox.trim()
  ) rootAttributes.viewBox = raw.viewBox.trim()
  if (rootAttributes.viewBox) {
    const parts = rootAttributes.viewBox.split(/[\s,]+/).map(Number)
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isFinite(part)) ||
      (parts[2] ?? 0) <= 0 ||
      (parts[3] ?? 0) <= 0
    ) return null
  }

  let documentValue: Document
  try {
    documentValue = new DOMParser().parseFromString(
      '<svg xmlns="' + SVG_NAMESPACE_URI + '">' + raw.markup + '</svg>',
      'image/svg+xml',
    )
  } catch {
    return null
  }
  if (documentValue.getElementsByTagName('parsererror').length > 0) return null
  const root = documentValue.documentElement
  if (svgPreviewLocalName(root.tagName) !== 'svg') return null
  const elements = [root, ...Array.from(root.querySelectorAll('*'))]
  for (const element of elements) {
    const elementName = svgPreviewLocalName(element.tagName)
    if (SVG_PREVIEW_UNSAFE_ELEMENTS.has(elementName)) return null
    if (elementName === 'style' && svgPreviewHasUnsafeCss(element.textContent ?? '')) return null
    for (const attribute of Array.from(element.attributes)) {
      const attributeName = svgPreviewLocalName(attribute.name)
      const attributeValue = attribute.value.trim()
      if (attributeName === 'base' || attributeName.startsWith('on')) return null
      if (
        (attributeName === 'href' || attributeName === 'src') &&
        attributeValue &&
        !attributeValue.startsWith('#')
      ) return null
      if (svgPreviewHasUnsafeCss(attributeValue)) return null
      // OID and bridge metadata belong to the generated app, not uploaded
      // artwork. Keeping them would let the preview interfere with inspect
      // target lookup even though the overlay itself is Mercury-owned.
      const qualifiedName = attribute.name.toLowerCase()
      if (qualifiedName.startsWith('data-oid') || qualifiedName.startsWith('data-mercury-')) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return { root, rootAttributes }
}

function svgPreviewSource(payload: SvgPreviewPayload, target: HTMLElement): string {
  const root = payload.root.cloneNode(true) as Element
  for (const [property, xmlName] of SVG_PREVIEW_ROOT_ATTRIBUTES) {
    const uploaded = payload.rootAttributes[property]
    const existing = target.getAttribute(xmlName)?.trim()
    const next = uploaded || existing
    if (next) root.setAttribute(xmlName, next)
  }
  if (!root.hasAttribute('color')) {
    const inheritedColor = getComputedStyle(target).color.trim()
    if (inheritedColor) root.setAttribute('color', inheritedColor)
  }
  root.setAttribute('xmlns', SVG_NAMESPACE_URI)
  return new XMLSerializer().serializeToString(root)
}

function ensureSvgPreviewStyle(): void {
  if (document.getElementById(SVG_PREVIEW_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = SVG_PREVIEW_STYLE_ID
  style.setAttribute('data-mercury-overlay', 'svg-preview-style')
  style.textContent = [
    '[' + SVG_PREVIEW_SCOPE_ATTR + '] > :not([data-mercury-overlay="svg-preview"]) { opacity: 0 !important; }',
    '[' + SVG_PREVIEW_SCOPE_ATTR + '] > [data-mercury-overlay="svg-preview"] { display: block !important; opacity: 1 !important; visibility: visible !important; pointer-events: none !important; }',
  ].join('\n')
  ;(document.head || document.documentElement).appendChild(style)
}

function addSvgPreviewToken(el: HTMLElement, token: string): void {
  const tokens = (el.getAttribute(SVG_PREVIEW_SCOPE_ATTR) ?? '').split(/\s+/).filter(Boolean)
  if (!tokens.includes(token)) tokens.push(token)
  el.setAttribute(SVG_PREVIEW_SCOPE_ATTR, tokens.join(' '))
}

function removeSvgPreviewToken(el: HTMLElement, token: string): void {
  const tokens = (el.getAttribute(SVG_PREVIEW_SCOPE_ATTR) ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((entry) => entry !== token)
  if (tokens.length > 0) el.setAttribute(SVG_PREVIEW_SCOPE_ATTR, tokens.join(' '))
  else el.removeAttribute(SVG_PREVIEW_SCOPE_ATTR)
}

function cleanupSvgPreview(snapshot: SvgPreviewSnapshot): void {
  if (snapshot.handoffTimer) clearTimeout(snapshot.handoffTimer)
  snapshot.handoffTimer = null
  try { snapshot.overlay.remove() } catch { /* noop */ }
  removeSvgPreviewToken(snapshot.el, snapshot.token)
  activeSvgPreviews.delete(snapshot)
}

function positionSvgPreview(snapshot: SvgPreviewSnapshot): void {
  if (!snapshot.el.isConnected) {
    cleanupSvgPreview(snapshot)
    return
  }
  // React may remove an unknown trailing child during an unrelated render.
  // Re-attach after that commit without ever replacing React-owned children.
  if (snapshot.overlay.parentNode !== snapshot.el) snapshot.el.appendChild(snapshot.overlay)
}

function positionSvgPreviewOverlays(): void {
  for (const snapshot of [...activeSvgPreviews]) positionSvgPreview(snapshot)
}

function cleanupCommittedSvgPreviews(): void {
  for (const snapshot of [...activeSvgPreviews]) {
    if (snapshot.committed) cleanupSvgPreview(snapshot)
  }
}

function applySvgPreview(
  mutationId: string,
  target: HTMLElement,
  payload: SvgPreviewPayload,
): SvgPreviewSnapshot {
  // Match the aspect-ratio behavior the saved inline SVG will use. Stretching
  // the temporary <image> with preserveAspectRatio none made square artwork
  // look rectangular whenever flex/grid temporarily gave the host SVG a non-square viewport;
  // the distortion then disappeared after HMR replaced the overlay with the
  // real SVG children. Preserve an explicit uploaded/existing policy and use
  // SVG's default meet behavior otherwise.
  const previewAspectRatio =
    payload.rootAttributes.preserveAspectRatio ||
    target.getAttribute('preserveAspectRatio')?.trim() ||
    'xMidYMid meet'
  const existing = mutationLog.get(mutationId)?.find(
    (snapshot): snapshot is SvgPreviewSnapshot => (
      snapshot.op === 'replaceSvgMarkup' && snapshot.el === target
    ),
  )
  const source = svgPreviewSource(payload, target)
  if (existing) {
    if (existing.handoffTimer) clearTimeout(existing.handoffTimer)
    existing.handoffTimer = null
    existing.committed = false
    existing.overlay.setAttribute(
      'href',
      'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source),
    )
    existing.overlay.setAttribute('preserveAspectRatio', previewAspectRatio)
    positionSvgPreview(existing)
    return existing
  }

  ensureSvgPreviewStyle()
  svgPreviewTokenCounter += 1
  const token = 'msp-' + String(svgPreviewTokenCounter)
  const overlay = document.createElementNS(SVG_NAMESPACE_URI, 'image')
  overlay.setAttribute('data-mercury-overlay', 'svg-preview')
  overlay.setAttribute('aria-hidden', 'true')
  overlay.setAttribute('focusable', 'false')
  overlay.setAttribute('x', '0%')
  overlay.setAttribute('y', '0%')
  overlay.setAttribute('width', '100%')
  overlay.setAttribute('height', '100%')
  overlay.setAttribute('preserveAspectRatio', previewAspectRatio)
  overlay.setAttribute('href', 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source))
  overlay.style.setProperty('pointer-events', 'none', 'important')
  addSvgPreviewToken(target, token)
  target.appendChild(overlay)
  const snapshot: SvgPreviewSnapshot = {
    op: 'replaceSvgMarkup',
    el: target,
    overlay,
    token,
    committed: false,
    handoffTimer: null,
  }
  activeSvgPreviews.add(snapshot)
  positionSvgPreview(snapshot)
  return snapshot
}

/**
 * Un-hide an optimistically deleted node, but only once we know the new bundle
 * did NOT replace it.
 *
 * Two outcomes after a delete is acked. Usually HMR re-renders the subtree and
 * this node is discarded, in which case restoring it would have been wrong and
 * is now simply skipped. Occasionally React recycles the node for the following
 * sibling -- static siblings carry no key, so it reconciles by position -- and
 * then the node must get its display and its indexing visibility back, or the
 * next card renders invisible and every later ordinal counts one node short.
 *
 * Only the display property is restored, never the whole style attribute the
 * snapshot holds: an animation library owns the rest of this node's inline style
 * and has almost certainly written to it since.
 */
function scheduleDeletedNodeRestore(el: HTMLElement, prevStyleAttr: string | null): void {
  const restore = function (): void {
    if (!el.isConnected) return
    el.removeAttribute(DELETED_MARK_ATTR)
    const priorDisplay = readStyleDeclaration(prevStyleAttr, 'display')
    if (priorDisplay === null) el.style.removeProperty('display')
    else el.style.setProperty('display', priorDisplay)
    if (el.getAttribute('style') === '') el.removeAttribute('style')
    positionSelectedOverlay()
  }
  const parent = el.parentNode
  if (!parent || typeof MutationObserver === 'undefined') {
    setTimeout(restore, DELETED_RESTORE_GRACE_MS)
    return
  }
  let settled = false
  const observer = new MutationObserver(function () {
    if (settled || el.isConnected) return
    // The bundle turned over and took the node with it: nothing to restore.
    settled = true
    observer.disconnect()
  })
  observer.observe(parent, { childList: true })
  setTimeout(function () {
    if (settled) return
    settled = true
    observer.disconnect()
    restore()
  }, DELETED_RESTORE_GRACE_MS)
}



type ColorOverrideProperty = 'backgroundColor' | 'color' | 'borderColor'
type ColorOverrideState = 'base' | 'hover' | 'selected'

type RecordedSnapshot =
  // `restore` puts the authored Text nodes back in place and reports whether
  // it could. There is deliberately no markup fallback -- see revertMutation.
  | { op: 'setText'; el: HTMLElement; restore: () => boolean }
  | { op: 'setClassName'; el: HTMLElement; prev: string | null }
  | { op: 'setStyle'; el: HTMLElement; prevStyleAttr: string | null }
  | { op: 'setAttribute'; el: HTMLElement; name: 'src' | 'alt' | 'aria-label' | 'role' | 'placeholder'; prev: string | null }
  | { op: 'reorderChild'; el: HTMLElement; parent: HTMLElement; prevNextSibling: ChildNode | null }
  // Same shape as reorderChild — removal and "move to a detached holding
  // area" share the same reinsertion logic on revert.
  // Delete is previewed by HIDING, never by detaching — see applyMutation.
  // Snapshot shape mirrors setStyle because the mechanism is the same: a
  // reversible inline-style write.
  | { op: 'removeElement'; el: HTMLElement; prevStyleAttr: string | null }
  | SvgPreviewSnapshot
  // For color overrides we don't attach to an element — we mutate a
  // shared <style id="mercury-color-overrides"> sheet keyed by
  // (oid, property). Snapshot the prior hex (null if no rule existed)
  // so revert restores exactly the previous state.
  | {
      op: 'setColorOverride'
      oid: string
      property: ColorOverrideProperty
      state: ColorOverrideState
      variant: string | null
      scopeId: string | null
      prevHex: string | null
    }
  | {
      op: 'setPropertyOverride'
      oid: string
      scopeId: string | null
      prevOverrides: Map<string, string | null>
    }

const mutationLog = new Map<string, RecordedSnapshot[]>()

// THE canonical oid enumeration. Survivors only: a node the panel
// optimistically deleted stays in the DOM (hidden, so React's fiber tree stays
// intact) but must not occupy an ordinal, because after the rebuild it does not
// render at all. Matched with closest(), not hasAttribute(): removeElement
// marks the deleted element alone, but deleting a row also removes every
// stamped node inside it, and those descendants carry no mark of their own.
// Filtering on the attribute only left cells inside a hidden row holding
// ordinals, so every cell below a deleted row indexed one too high. Every consumer of an instanceIndex resolves through here, so
// the index the panel reports, the node a mutation targets, and the row the
// layer tree labels all mean the same thing before and after a reload.
function findOidNodes(oid: string, includeOptimisticallyDeleted = false): HTMLElement[] {
  try {
    return (Array.from(
      document.querySelectorAll('[data-oid="' + oid + '"]'),
    ) as HTMLElement[]).filter((node) => (
      includeOptimisticallyDeleted || !node.closest('[' + DELETED_MARK_ATTR + ']')
    ))
  } catch {
    return []
  }
}

const LAYERS_TREE_MAX_NODES = 750
const LAYERS_TREE_MAX_DEPTH = 60
const LAYERS_TREE_IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'])

function layerNodeLabel(el: HTMLElement): string | null {
  const attributeLabel =
    el.getAttribute('aria-label') ||
    el.getAttribute('alt') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('title')
  if (attributeLabel) return trimRuntimeString(attributeLabel, 80) || null
  let directText = ''
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i]
    if (child.nodeType === 3 && child.nodeValue) directText += child.nodeValue + ' '
  }
  const normalized = directText.replace(/\s+/g, ' ').trim()
  if (normalized) return trimRuntimeString(normalized, 80) || null
  const id = el.getAttribute('id')
  return id ? '#' + trimRuntimeString(id, 60) : null
}

function buildBridgeLayerTree(): {
  nodes: BridgeLayerNode[]
  totalCount: number
  stampedCount: number
  truncated: boolean
} {
  let totalCount = 0
  let stampedCount = 0
  let serializedCount = 0
  let truncated = false

  // instanceIndex MUST match the canonical enumeration used everywhere the
  // panel resolves an oid+instanceIndex back to a node: findOidNodes(oid),
  // which is document-order querySelectorAll of every data-oid node that the
  // panel has not optimistically deleted. Numbering
  // the tree from this visible-only DFS instead would diverge whenever an earlier
  // same-oid instance is hidden (display:none / visibility:hidden), sits under
  // an overlay, or lives inside a collapsed SVG subtree -- the tree would label
  // a row N while findOidNodes(oid)[N] pointed at a *different* element, so
  // clicking that row selects/edits the wrong instance. Precompute each
  // stamped element's canonical index once from the same all-nodes order.
  const canonicalInstanceIndex = new WeakMap<Element, number>()
  {
    const perOid = new Map<string, number>()
    const all = document.querySelectorAll('[data-oid]')
    for (let i = 0; i < all.length; i++) {
      const node = all[i] as HTMLElement
      const nodeOid = node.getAttribute('data-oid')
      if (!nodeOid) continue
      // Skip optimistically deleted nodes, and anything inside one, so this
      // numbering stays identical to findOidNodes.
      if (node.closest('[' + DELETED_MARK_ATTR + ']')) continue
      const idx = perOid.get(nodeOid) ?? 0
      canonicalInstanceIndex.set(node, idx)
      perOid.set(nodeOid, idx + 1)
    }
  }

  const visit = (el: HTMLElement, depth: number): BridgeLayerNode | null => {
    if (el.closest('[data-mercury-overlay]')) return null
    if (LAYERS_TREE_IGNORED_TAGS.has(el.tagName)) return null
    let style: CSSStyleDeclaration
    try {
      style = getComputedStyle(el)
    } catch {
      return null
    }
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return null
    }

    totalCount += 1
    const oid = el.getAttribute('data-oid')
    let instanceIndex: number | null = null
    if (oid) {
      stampedCount += 1
      // Canonical (all-nodes) index, not a visible-only running counter.
      instanceIndex = canonicalInstanceIndex.get(el) ?? 0
    }

    if (depth > LAYERS_TREE_MAX_DEPTH || serializedCount >= LAYERS_TREE_MAX_NODES) {
      truncated = true
      for (let i = 0; i < el.children.length; i++) {
        visit(el.children[i] as HTMLElement, depth + 1)
      }
      return null
    }

    serializedCount += 1
    const children: BridgeLayerNode[] = []
    // An SVG is one visual/editing unit in Layers. Collapse SVG-namespace
    // implementation nodes (<path>, <g>, <defs>, gradients, etc.), but retain
    // HTML-namespace descendants of <foreignObject> as independently editable
    // children of the outer SVG row.
    const isSvgRoot = el.tagName.toLowerCase() === 'svg'
    if (isSvgRoot) {
      const visitForeignObjectHtml = (svgNode: HTMLElement): void => {
        for (let i = 0; i < svgNode.children.length; i++) {
          const child = svgNode.children[i] as HTMLElement
          if (child.namespaceURI === SVG_NAMESPACE_URI) {
            visitForeignObjectHtml(child)
            continue
          }
          const childLayer = visit(child, depth + 1)
          if (childLayer) children.push(childLayer)
        }
      }
      visitForeignObjectHtml(el)
    } else {
      for (let i = 0; i < el.children.length; i++) {
        const child = visit(el.children[i] as HTMLElement, depth + 1)
        if (child) children.push(child)
      }
    }
    return {
      tagName: el.tagName.toLowerCase(),
      oid,
      instanceIndex,
      label: layerNodeLabel(el),
      children,
    }
  }

  const root = document.body ? visit(document.body, 0) : null
  return { nodes: root ? [root] : [], totalCount, stampedCount, truncated }
}

function publishLayersTree(): void {
  const tree = buildBridgeLayerTree()
  post({ source: 'mercury-bridge', type: 'layers-tree', ...tree })
}

// Per-property CSS override sheet. Holds a single <style> element inserted
// as the FIRST child of <head> so Tailwind's compiled stylesheet remains the
// later source of truth for normal class utilities. State variants such as
// `.hover\:bg-emerald-700:hover` and
// `.active\:bg-emerald-800:active` are more specific than the
// `[data-oid="X"]` override, so hover/click colors keep winning.
const COLOR_OVERRIDE_STYLE_ID = 'mercury-color-overrides'
const COLOR_OVERRIDE_SCOPE_ATTR = 'data-mercury-color-scope'
// Map keyed by 'oid|property|state|variant|scopeId' -> hex string. The
// composite key matches `colorOverrideKey()` exactly. Reflects what the
// sheet currently holds so we can snapshot/restore exact prior values
// without re-parsing CSS text.
const colorOverrideState = new Map<string, string>()

function ensureColorOverrideSheet(): HTMLStyleElement | null {
  try {
    const head = document.head
    if (!head) return null
    let el = document.getElementById(COLOR_OVERRIDE_STYLE_ID) as HTMLStyleElement | null
    if (el && el.tagName === 'STYLE') return el
    el = document.createElement('style')
    el.id = COLOR_OVERRIDE_STYLE_ID
    // Prepend so Tailwind's compiled CSS remains later in the cascade.
    if (head.firstChild) head.insertBefore(el, head.firstChild)
    else head.appendChild(el)
    return el
  } catch {
    return null
  }
}

function colorOverrideKey(
  oid: string,
  property: ColorOverrideProperty,
  state: ColorOverrideState,
  variant: string | null,
  scopeId: string | null,
): string {
  return oid + '|' + property + '|' + state + '|' + (variant || '') + '|' + (scopeId || '')
}

// CSS property name for the camelCase JS name. We constrain inputs to a
// known set so this map is exhaustive.
const COLOR_OVERRIDE_CSS_PROP: Record<ColorOverrideProperty, string> = {
  backgroundColor: 'background-color',
  color: 'color',
  borderColor: 'border-color',
}

// Rewrite the override sheet's textContent from colorOverrideState. We
// regenerate the whole sheet (cheap; expected size: tens of rules). Each
// (oid, property) tuple becomes its own rule so the cascade is predictable
// and we don't have to worry about declaration ordering inside a
// merged-per-oid block.
function selectedVariantSelectorSuffix(variant: string | null): string | null {
  if (!variant) return null
  if (variant === 'aria-selected') return '[aria-selected="true"]'
  if (variant === 'aria-pressed') return '[aria-pressed="true"]'
  if (variant === 'aria-checked') return '[aria-checked="true"]'
  if (variant === 'data-selected') return '[data-selected]'
  if (variant === 'data-active') return '[data-active]'
  if (variant === 'data-checked') return '[data-checked]'
  if (variant === 'data-pressed') return '[data-pressed]'
  let match = /^aria-\[([A-Za-z0-9_-]+)=([A-Za-z0-9_-]+)\]$/.exec(variant)
  if (match) return '[aria-' + match[1] + '="' + match[2] + '"]'
  match = /^data-\[([A-Za-z0-9_-]+)=([A-Za-z0-9_-]+)\]$/.exec(variant)
  if (match) return '[data-' + match[1] + '="' + match[2] + '"]'
  match = /^data-\[([A-Za-z0-9_-]+)\]$/.exec(variant)
  if (match) return '[data-' + match[1] + ']'
  return null
}

function colorOverrideSelector(
  oid: string,
  state: ColorOverrideState,
  variant: string | null,
  scopeId: string | null,
): string | null {
  const safeOid = oid.replace(/"/g, '\"')
  const safeScope = scopeId ? scopeId.replace(/"/g, '\"') : null
  const base = safeScope
    ? '[' + COLOR_OVERRIDE_SCOPE_ATTR + '~="' + safeScope + '"]'
    : '[data-oid="' + safeOid + '"]'
  if (state === 'base') return base
  // Double the attribute selector so explicit state previews outrank the
  // low-specificity base override while still staying below inline styles.
  if (state === 'hover') return base + base + ':hover'
  const suffix = selectedVariantSelectorSuffix(variant)
  return suffix ? base + base + suffix : null
}

function colorOverrideScopeId(oid: string, instanceIndex: number): string {
  return 'mco-' + oid.replace(/[^A-Za-z0-9_-]/g, '_') + '-' + String(instanceIndex)
}

function addScopeToken(el: HTMLElement, scopeId: string): void {
  const current = el.getAttribute(COLOR_OVERRIDE_SCOPE_ATTR) || ''
  const parts = current.split(/\s+/).filter(Boolean)
  if (!parts.includes(scopeId)) {
    parts.push(scopeId)
    el.setAttribute(COLOR_OVERRIDE_SCOPE_ATTR, parts.join(' '))
  }
}

function removeScopeToken(el: HTMLElement, scopeId: string): void {
  const current = el.getAttribute(COLOR_OVERRIDE_SCOPE_ATTR) || ''
  const parts = current.split(/\s+/).filter(Boolean).filter((part) => part !== scopeId)
  if (parts.length > 0) el.setAttribute(COLOR_OVERRIDE_SCOPE_ATTR, parts.join(' '))
  else el.removeAttribute(COLOR_OVERRIDE_SCOPE_ATTR)
}

function ensureColorOverrideScope(scopeId: string, targets: HTMLElement[]): void {
  for (const el of targets) addScopeToken(el, scopeId)
}

function removeColorOverrideScope(scopeId: string): void {
  try {
    const selector =
      '[' + COLOR_OVERRIDE_SCOPE_ATTR + '~="' + scopeId.replace(/"/g, '\"') + '"]'
    const targets = Array.from(document.querySelectorAll(selector)) as HTMLElement[]
    for (const el of targets) removeScopeToken(el, scopeId)
  } catch {
    // If querying fails, leave the temporary scope attr in place. It is
    // harmless and disappears on the next iframe reload.
  }
}

function colorOverrideScopeHasLiveRule(scopeId: string): boolean {
  for (const key of colorOverrideState.keys()) {
    const parts = key.split('|')
    if ((parts[4] || '') === scopeId) return true
  }
  return false
}

function cleanupColorOverrideScopeIfUnused(scopeId: string): void {
  if (!colorOverrideScopeHasLiveRule(scopeId)) removeColorOverrideScope(scopeId)
}

function flushColorOverrideSheet(): void {
  const sheetEl = ensureColorOverrideSheet()
  if (!sheetEl) return
  const lines: string[] = []
  for (const [key, hex] of colorOverrideState) {
    const parts = key.split('|')
    const oid = parts[0] || ''
    const prop = parts[1] as ColorOverrideProperty
    const state = (parts[2] || 'base') as ColorOverrideState
    const variant = parts[3] || null
    const cssProp = COLOR_OVERRIDE_CSS_PROP[prop]
    if (!cssProp) continue
    const scopeId = parts[4] || null
    const selector = colorOverrideSelector(oid, state, variant, scopeId)
    if (!selector) continue
    lines.push(selector + '{' + cssProp + ':' + hex + ';}')
  }
  sheetEl.textContent = lines.join('\n')
}

function getColorOverride(
  oid: string,
  property: ColorOverrideProperty,
  state: ColorOverrideState,
  variant: string | null,
  scopeId: string | null,
): string | null {
  return colorOverrideState.get(colorOverrideKey(oid, property, state, variant, scopeId)) ?? null
}

// --- Property override sheet (non-color CSS properties) ---
// Uses the same approach as the color override sheet: a <style> element
// prepended to <head> so Tailwind's compiled CSS comes AFTER (higher priority
// by cascade order for equal specificity). The selector is [data-oid="X"]
// which is lower specificity than hover/active state classes — so state
// variants (.hover\:shadow-xl:hover) keep winning. This avoids the inline
// style problem where style="" beats everything including :hover/:active.
const PROP_OVERRIDE_STYLE_ID = 'mercury-property-overrides'
const propertyOverrideState = new Map<string, Map<string, string>>()

function propertyOverrideKey(oid: string, scopeId: string | null): string {
  return oid + '|' + (scopeId || '')
}

function propertyOverrideScopeId(oid: string, instanceIndex: number): string {
  return 'mpo-' + oid.replace(/[^A-Za-z0-9_-]/g, '_') + '-' + String(instanceIndex)
}

function ensurePropertyOverrideSheet(): HTMLStyleElement | null {
  try {
    const head = document.head
    if (!head) return null
    let el = document.getElementById(PROP_OVERRIDE_STYLE_ID) as HTMLStyleElement | null
    if (el && el.tagName === 'STYLE') return el
    el = document.createElement('style')
    el.id = PROP_OVERRIDE_STYLE_ID
    if (head.firstChild) head.insertBefore(el, head.firstChild)
    else head.appendChild(el)
    return el
  } catch {
    return null
  }
}

function camelToCss(name: string): string {
  return name.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}

const ALLOWED_PROP_OVERRIDE_PROPS = new Set([
  'fontSize', 'lineHeight', 'fontWeight', 'fontStyle', 'fontFamily', 'textAlign',
  'borderWidth', 'borderStyle', 'borderRadius',
  'boxShadow', 'opacity',
  'margin', 'marginInline', 'marginBlock',
  'padding', 'paddingInline', 'paddingBlock',
])

const UNSAFE_CSS_VALUE_RE = /[{}<>;]/

function isValidCssValue(val: string): boolean {
  return !UNSAFE_CSS_VALUE_RE.test(val)
}

// --- Google Fonts (lazy) ---
// Only loaded when the properties panel sets a fontFamily override,
// avoiding a network request on every iframe load.
function loadMercuryFontsIfNeeded() {
  const id = 'mercury-google-fonts'
  if (document.getElementById(id)) return
  const href =
    'https://fonts.googleapis.com/css2' +
    '?family=Space+Grotesk:wght@400;500;700' +
    '&family=Cormorant+Garamond:wght@400;600;700' +
    '&family=Archivo+Black' +
    '&family=Oswald:wght@400;500;700' +
    '&family=Pacifico' +
    '&family=Permanent+Marker' +
    '&family=Abril+Fatface' +
    '&family=Anton' +
    '&family=Lobster' +
    '&family=Righteous' +
    '&display=swap'
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = href
  ;(document.head || document.documentElement).appendChild(link)
}

function setPropertyOverrides(
  oid: string,
  props: Record<string, string | null>,
  scopeId: string | null,
): Map<string, string | null> {
  const prev = new Map<string, string | null>()
  const overrideKey = propertyOverrideKey(oid, scopeId)
  let oidMap = propertyOverrideState.get(overrideKey)
  if (!oidMap) {
    oidMap = new Map()
    propertyOverrideState.set(overrideKey, oidMap)
  }
  for (const [key, val] of Object.entries(props)) {
    if (!ALLOWED_PROP_OVERRIDE_PROPS.has(key)) continue
    if (key === 'fontFamily' && val) loadMercuryFontsIfNeeded()
    prev.set(key, oidMap.get(key) ?? null)
    if (val === null || val === '') {
      oidMap.delete(key)
    } else if (isValidCssValue(val)) {
      oidMap.set(key, val)
    }
  }
  if (oidMap.size === 0) propertyOverrideState.delete(overrideKey)
  flushPropertyOverrideSheet()
  return prev
}

function restorePropertyOverrides(
  oid: string,
  prev: Map<string, string | null>,
  scopeId: string | null,
): void {
  const overrideKey = propertyOverrideKey(oid, scopeId)
  let oidMap = propertyOverrideState.get(overrideKey)
  if (!oidMap) {
    oidMap = new Map()
    propertyOverrideState.set(overrideKey, oidMap)
  }
  for (const [key, val] of prev) {
    if (val === null) {
      oidMap.delete(key)
    } else {
      oidMap.set(key, val)
    }
  }
  if (oidMap.size === 0) propertyOverrideState.delete(overrideKey)
  flushPropertyOverrideSheet()
}

function cleanupPropertyOverrideScopeIfUnused(oid: string, scopeId: string): void {
  if (!propertyOverrideState.has(propertyOverrideKey(oid, scopeId))) {
    removeColorOverrideScope(scopeId)
  }
}

function flushPropertyOverrideSheet(): void {
  const sheetEl = ensurePropertyOverrideSheet()
  if (!sheetEl) return
  const lines: string[] = []
  for (const [overrideKey, props] of propertyOverrideState) {
    if (props.size === 0) continue
    const separatorIndex = overrideKey.lastIndexOf('|')
    const oid = overrideKey.slice(0, separatorIndex)
    const scopeId = overrideKey.slice(separatorIndex + 1) || null
    const safeOid = oid.replace(/"/g, '\"')
    const safeScope = scopeId ? scopeId.replace(/"/g, '\"') : null
    const selector = safeScope
      ? '[' + COLOR_OVERRIDE_SCOPE_ATTR + '~="' + safeScope + '"]'
      : '[data-oid="' + safeOid + '"]'
    const decls: string[] = []
    for (const [key, val] of props) {
      decls.push(camelToCss(key) + ':' + val + ' !important')
    }
    lines.push(selector + '{' + decls.join(';') + ';}')
  }
  sheetEl.textContent = lines.join('\n')
}

function setColorOverride(
  oid: string,
  property: ColorOverrideProperty,
  hex: string | null,
  state: ColorOverrideState,
  variant: string | null,
  scopeId: string | null,
): void {
  const key = colorOverrideKey(oid, property, state, variant, scopeId)
  if (hex === null || hex === '') {
    colorOverrideState.delete(key)
  } else {
    colorOverrideState.set(key, hex)
  }
  flushColorOverrideSheet()
}

type DirectEditGoogleFontRequest = {
  family: string
  href: string
}

function directEditGoogleFontRequest(value: unknown): DirectEditGoogleFontRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const font = value as { family?: unknown; faces?: unknown; maxDemo?: unknown }
  if (typeof font.family !== 'string') return null
  const familyName = font.family.trim().normalize('NFC')
  if (!/^[A-Za-z0-9][A-Za-z0-9 .&'+-]{0,99}$/.test(familyName)) return null
  if (!Array.isArray(font.faces) || font.faces.length === 0 || font.faces.length > 40) return null
  const isDemoFamily: (family: string) => boolean = function isMaxDemoFontFamily(family) {
    return ['reel-tall', 'reel-medium', 'reel-short', 'peridot-pe-variable'].includes(family);
}
  const validWeight: (weight: number, demoFont: boolean) => boolean = function isDirectEditFontWeight(weight, demoFont) {
    return Number.isInteger(weight) && weight <= 1000 &&
        (demoFont ? weight >= 1 : weight >= 100 && weight % 100 === 0);
}
  const demoFont = isDemoFamily(familyName)
  if ((demoFont && font.maxDemo !== true) || (font.maxDemo !== undefined && typeof font.maxDemo !== 'boolean')) return null
  const rawFaces = font.faces
  const validatedFaces = rawFaces.flatMap((rawFace) => {
    if (!rawFace || typeof rawFace !== 'object' || Array.isArray(rawFace)) return []
    const face = rawFace as { style?: unknown; weight?: unknown }
    if (
      (face.style !== 'normal' && face.style !== 'italic') ||
      typeof face.weight !== 'number' ||
      !validWeight(face.weight, demoFont && font.maxDemo === true)
    ) return []
    return [[face.style + ':' + face.weight, {
      style: face.style,
      weight: face.weight,
    }] as const]
  })
  if (validatedFaces.length !== rawFaces.length) return null
  const faces = Array.from(new Map(validatedFaces).values()).sort((left, right) => (
    left.style === right.style
      ? left.weight - right.weight
      : left.style === 'normal'
        ? -1
        : 1
  ))
  if (faces.length > 20) return null
  // Embed the same trusted provider catalogue used by saved-source font edits.
  // The legacy loadGoogleFont message and link marker remain wire-compatible.
  const providerStylesheets: Record<string, string> = {"reel-tall":"https://use.typekit.net/bge7mjy.css","reel-medium":"https://use.typekit.net/bge7mjy.css","reel-short":"https://use.typekit.net/bge7mjy.css","peridot-pe-variable":"https://use.typekit.net/bge7mjy.css"}
  if (Object.prototype.hasOwnProperty.call(providerStylesheets, familyName)) {
    return { family: familyName, href: providerStylesheets[familyName]! }
  }
  const family = encodeURIComponent(familyName)
    .replace(/%20/g, '+')
    .replace(
      /[!'()*]/g,
      (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
    )
  const normalWeights = faces
    .filter((face) => face.style === 'normal')
    .map((face) => face.weight)
  const italicWeights = faces
    .filter((face) => face.style === 'italic')
    .map((face) => face.weight)
  const familyQuery = italicWeights.length === 0
    ? family + ':wght@' + normalWeights.join(';')
    : family + ':ital,wght@' + [
        ...normalWeights.map((weight) => '0,' + weight),
        ...italicWeights.map((weight) => '1,' + weight),
      ].join(';')
  return {
    family: familyName,
    href: 'https://fonts.googleapis.com/css2?family=' + familyQuery + '&display=swap',
  }
}

function applyMutation(
  mutationId: string,
  oid: string,
  op: MutationOp,
  value: unknown,
  instanceIndex: number | null,
): void {
  if (op === 'loadGoogleFont') {
    const font = directEditGoogleFontRequest(value)
    if (!font) return
    const existing = Array.from(document.querySelectorAll<HTMLLinkElement>('link[data-mercury-google-font]'))
      .find((link) => link.dataset.mercuryGoogleFont === font.family)
    const link = existing ?? document.createElement('link')
    link.rel = 'stylesheet'
    link.href = font.href
    link.dataset.mercuryGoogleFont = font.family
    if (!existing) (document.head || document.documentElement).appendChild(link)
    return
  }
  if (op === 'reorderChild') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const reorder = value as {
      parentOid?: unknown
      beforeOid?: unknown
      fromIndex?: unknown
      beforeIndex?: unknown
      siblingCount?: unknown
    }
    if (typeof reorder.parentOid !== 'string') return
    const hasInstanceOrder = reorder.fromIndex !== undefined || reorder.beforeIndex !== undefined
    if (hasInstanceOrder) {
      if (
        typeof reorder.fromIndex !== 'number' ||
        !Number.isInteger(reorder.fromIndex) ||
        reorder.fromIndex < 0 ||
        (reorder.beforeIndex !== null && (
          typeof reorder.beforeIndex !== 'number' ||
          !Number.isInteger(reorder.beforeIndex) ||
          reorder.beforeIndex < 0
        )) ||
        typeof reorder.siblingCount !== 'number' ||
        !Number.isInteger(reorder.siblingCount) ||
        reorder.siblingCount < 2
      ) return
      const parents = findOidNodes(reorder.parentOid)
      if (parents.length !== 1) return
      const parent = parents[0]
      if (!parent) return
      const siblings = Array.from(parent.children).filter((child): child is HTMLElement =>
        child instanceof HTMLElement && child.hasAttribute('data-oid'),
      )
      if (siblings.length !== reorder.siblingCount) return
      const el = siblings[reorder.fromIndex]
      const anchor = reorder.beforeIndex === null ? null : siblings[reorder.beforeIndex]
      if (!el || anchor === undefined || el === anchor || el.getAttribute('data-oid') !== oid) return
      const snapshot: RecordedSnapshot = { op: 'reorderChild', el, parent, prevNextSibling: el.nextSibling }
      markMercuryMutationTargets([el, parent])
      parent.insertBefore(el, anchor)
      const existing = mutationLog.get(mutationId)
      if (existing) mutationLog.set(mutationId, [...existing, snapshot])
      else mutationLog.set(mutationId, [snapshot])
      positionSelectedOverlay()
      return
    }
    if (reorder.beforeOid !== null && typeof reorder.beforeOid !== 'string') return
    const targets = findOidNodes(oid)
    if (targets.length !== 1) return
    const el = targets[0]
    if (!el) return
    const parent = el.parentElement
    if (!parent || parent.getAttribute('data-oid') !== reorder.parentOid) return
    const anchor = reorder.beforeOid === null
      ? null
      : Array.from(parent.children).find((child) => child.getAttribute('data-oid') === reorder.beforeOid) ?? null
    if (reorder.beforeOid !== null && !(anchor instanceof HTMLElement)) return
    const snapshot: RecordedSnapshot = { op: 'reorderChild', el, parent, prevNextSibling: el.nextSibling }
    markMercuryMutationTargets([el, parent])
    parent.insertBefore(el, anchor)
    const existing = mutationLog.get(mutationId)
    if (existing) mutationLog.set(mutationId, [...existing, snapshot])
    else mutationLog.set(mutationId, [snapshot])
    positionSelectedOverlay()
    return
  }
  if (op === 'removeElement') {
    // HIDE the node; never detach it.
    //
    // These elements are owned by React. Detaching one leaves React's
    // fiber tree believing the node is still mounted, so the next
    // reconciliation of that subtree throws
    //   NotFoundError: Failed to execute 'removeChild' on 'Node'
    // and the whole preview app unmounts — a blank frame that only a full
    // reload recovers from. Attribute/text mutations (setClassName, setStyle,
    // setText) are safe because they don't change structure; a removal is not.
    //
    // display:none is visually equivalent to deletion (the box leaves layout
    // entirely) while keeping the tree React expects intact. The durable
    // removal happens in source, and the next natural remount renders without
    // the element at all. Set as important so a stylesheet rule for display
    // cannot win.
    //
    // Exactly one node is hidden. With instanceIndex the server suppresses
    // that single instance (idx === N ? null : original), so the preview must
    // match it; without one the oid has a single instance anyway.
    const targets = findOidNodes(oid)
    const el = targets[instanceIndex ?? 0]
    if (!el) return
    const snapshot: RecordedSnapshot = {
      op: 'removeElement',
      el,
      prevStyleAttr: el.getAttribute('style'),
    }
    markMercuryMutationTargets([el])
    el.style.setProperty('display', 'none', 'important')
    // Mark it so extractProps excludes it from instanceIndex/instanceCount.
    // After a rebuild the suppressed instance genuinely does not render, so
    // ordinals there count survivors only; tagging keeps the in-session
    // ordinal identical instead of shifting by the number of hidden nodes.
    el.setAttribute(DELETED_MARK_ATTR, 'true')
    const existing = mutationLog.get(mutationId)
    if (existing) mutationLog.set(mutationId, [...existing, snapshot])
    else mutationLog.set(mutationId, [snapshot])
    positionSelectedOverlay()
    return
  }
  // setPropertyOverride writes to a private stylesheet (like setColorOverride)
  // instead of inline style, so :hover/:active state classes keep winning.
  if (op === 'setPropertyOverride') {
    if (!value || typeof value !== 'object') return
    const props = value as Record<string, string | null>
    let scopeId: string | null = null
    if (instanceIndex != null) {
      const allTargets = findOidNodes(oid)
      if (instanceIndex < 0 || instanceIndex >= allTargets.length) return
      const target = allTargets[instanceIndex]
      if (!target) return
      scopeId = propertyOverrideScopeId(oid, instanceIndex)
      ensureColorOverrideScope(scopeId, [target])
    }
    const propertyTargets =
      instanceIndex == null ? findOidNodes(oid) : [findOidNodes(oid)[instanceIndex] ?? null]
    markMercuryMutationTargets(propertyTargets)
    if (Object.prototype.hasOwnProperty.call(props, 'opacity')) {
      yieldInspectRevealSnapshotsToAuthoredEdits(propertyTargets)
    }
    const prevOverrides = setPropertyOverrides(oid, props, scopeId)
    const snap: RecordedSnapshot = { op: 'setPropertyOverride', oid, scopeId, prevOverrides }
    const existing = mutationLog.get(mutationId)
    if (existing) mutationLog.set(mutationId, [...existing, snap])
    else mutationLog.set(mutationId, [snap])
    return
  }

  // setColorOverride edits the bridge's private style sheet. When the panel
  // sends instanceIndex for a shared-source/list item, scope the rule to the
  // same rendered instance as setClassName so arbitrary color previews stay
  // aligned with the code edit before Tailwind recompiles the new class.
  if (op === 'setColorOverride') {
    if (!value || typeof value !== 'object') return
    const v = value as { property?: unknown; hex?: unknown; state?: unknown; variant?: unknown }
    const property =
      v.property === 'backgroundColor' ||
      v.property === 'color' ||
      v.property === 'borderColor'
        ? (v.property as ColorOverrideProperty)
        : null
    if (!property) return
    const state =
      v.state === 'hover' || v.state === 'selected'
        ? (v.state as ColorOverrideState)
        : 'base'
    const variant = typeof v.variant === 'string' && v.variant.length > 0 ? v.variant : null
    if (state === 'selected' && !selectedVariantSelectorSuffix(variant)) return
    // Hex must be a strict #RGB/#RGBA/#RRGGBB/#RRGGBBAA color or
    // explicit null/empty (clear). Validating the shape here is
    // defense-in-depth: this string is interpolated raw into a CSS rule
    // (`{prop}:{hex};`), so a hostile/buggy caller passing
    // `red;}body{display:none` could otherwise inject arbitrary CSS via
    // the override sheet. Loosening this regex is a security decision —
    // do it only with an audit of the call sites.
    let hex: string | null = null
    if (typeof v.hex === 'string' && v.hex.length > 0) {
      if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.hex)) {
        return
      }
      hex = v.hex
    } else if (v.hex !== null && v.hex !== undefined && v.hex !== '') {
      return
    }
    let scopeId: string | null = null
    if (instanceIndex != null) {
      const allTargets = findOidNodes(oid)
      if (instanceIndex < 0 || instanceIndex >= allTargets.length) return
      const target = allTargets[instanceIndex]
      if (!target) return
      scopeId = colorOverrideScopeId(oid, instanceIndex)
      // Keep the temporary scope token through both set and clear previews.
      // A clear may be reverted, in which case the previous scoped rule needs
      // the selector to start matching again. Commit/revert cleanup removes
      // the token once no live rule references it.
      ensureColorOverrideScope(scopeId, [target])
    }
    markMercuryMutationTargets(
      instanceIndex == null ? findOidNodes(oid) : [findOidNodes(oid)[instanceIndex] ?? null],
    )
    const prevHex = getColorOverride(oid, property, state, variant, scopeId)
    setColorOverride(oid, property, hex, state, variant, scopeId)
    const snap: RecordedSnapshot = {
      op: 'setColorOverride',
      oid,
      property,
      state,
      variant,
      scopeId,
      prevHex,
    }
    const existing = mutationLog.get(mutationId)
    if (existing) mutationLog.set(mutationId, [...existing, snap])
    else mutationLog.set(mutationId, [snap])
    return
  }
  const svgPreviewPayload = op === 'replaceSvgMarkup' ? readSvgPreviewPayload(value) : null
  if (op === 'replaceSvgMarkup' && !svgPreviewPayload) return
  const allTargets = findOidNodes(oid)
  if (allTargets.length === 0) return
  // When the parent asked for per-instance targeting, narrow to a single
  // DOM node so the optimistic preview mirrors the AST rewrite exactly
  // (which emits `idx === N ? new : old` in the source). Out-of-range
  // indices are silently clamped to the empty set — the server will make
  // the same decision and surface a reason to the UI if needed. Only
  // null preserves the legacy "apply to all instances" behavior.
  const targets =
    instanceIndex == null
      ? allTargets
      : instanceIndex >= 0 && instanceIndex < allTargets.length
        ? [allTargets[instanceIndex]]
        : []
  markMercuryMutationTargets(targets)
  if (op === 'setClassName' || op === 'setStyle') {
    yieldInspectRevealSnapshotsToAuthoredEdits(targets)
  }
  const snapshots: RecordedSnapshot[] = []
  for (const el of targets) {
    if (op === 'setTextSegment') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const segment = value as { index?: unknown; domIndex?: unknown; expectedText?: unknown; value?: unknown }
      if (
        typeof segment.index !== 'number' ||
        !Number.isInteger(segment.index) ||
        segment.index < 0 ||
        typeof segment.domIndex !== 'number' ||
        !Number.isInteger(segment.domIndex) ||
        segment.domIndex < 0 ||
        typeof segment.expectedText !== 'string' ||
        typeof segment.value !== 'string'
      ) continue
      const textNode = el.childNodes[segment.domIndex]
      if (textNode?.nodeType !== 3) continue
      // The node already holds the committed value when an inline edit handed
      // it over, so expectedText -- the pre-edit text -- no longer matches.
      // Treat that as satisfied rather than dropping the user's edit on the
      // floor, and take the authored before-values from the handoff, because
      // the live DOM no longer has them.
      //
      // Only THIS edit's handoff licenses that, matched on segment and values:
      // any other message must keep failing closed, which is what stops a later
      // revert stamping pre-edit text over a live render.
      const peeked = peekInlineTextHandoff(el)
      const segmentHandoff = inlineTextHandoffAnswers(peeked, segment.value, {
        index: segment.index,
        domIndex: segment.domIndex,
        expectedText: segment.expectedText,
      })
        ? peeked
        : null
      const segmentAlreadyApplied = segmentHandoff !== null && textNode.nodeValue === segment.value
      if (!segmentAlreadyApplied && textNode.nodeValue !== segment.expectedText) continue
      // Past the guard. Consume only a handoff that answers this echo, so a
      // message that merely passed the ordinary expectedText check cannot
      // disarm the rollback belonging to a commit still in flight.
      if (segmentHandoff) consumeInlineTextHandoff(el)
      const segmentRecorder = textMutationSnapshot(el, segmentHandoff?.authoredTextValues)
      snapshots.push(segmentRecorder.snapshot)
      textNode.nodeValue = segment.value
      segmentRecorder.seal()
    } else if (op === 'setText') {
      // Surgical text edit: rewrite only direct Text nodes, preserve every
      // element child (e.g. <span>, <ArrowRight />) and its position.
      //
      // Why this matters: the properties-panel text field is bound to
      // `directText` — the concatenation of immediate Text-node children.
      // For a mixed-content element like <h1>Build faster.<span class="gradient">Ship smarter.</span></h1>,
      // the old behavior (`el.textContent = value`) collapsed the entire
      // subtree into a single text node and destroyed the <span>. The
      // rebuilt source would snap back, but until then the iframe was
      // visually broken. The new behavior mirrors the server-side AST
      // transform: replace the first Text child with the new value, drop
      // subsequent Text children, and leave element/fragment children in
      // place in their original slots. If no Text child exists yet, append
      // the new text at the end — same as the AST edit.
      //
      // Snapshot the Text nodes themselves (not prev textContent, and not
      // markup) so revert is exact even when direct Text nodes were
      // interleaved with elements, and even when multiple Text children
      // existed before the edit -- and so it hands back the same node objects
      // rather than reparsed lookalikes.
      //
      // Matched to a handoff the same way as the segment echo above: when an
      // inline commit painted this element early, the live Text nodes already
      // hold the COMMITTED value, so the authored before-values come from the
      // handoff instead. An unrelated setText must not take them -- its revert
      // would wipe out the commit the handoff is still holding for.
      const nextText = typeof value === 'string' ? value : String(value ?? '')
      const peekedText = peekInlineTextHandoff(el)
      const textHandoff = inlineTextHandoffAnswers(peekedText, nextText, null)
        ? consumeInlineTextHandoff(el)
        : null
      const textRecorder = textMutationSnapshot(el, textHandoff?.authoredTextValues)
      snapshots.push(textRecorder.snapshot)
      applyDirectTextEdit(el, nextText)
      textRecorder.seal()
    } else if (op === 'setClassName') {
      const prev = el.getAttribute('class')
      snapshots.push({ op: 'setClassName', el, prev })
      const next = typeof value === 'string' ? value : ''
      if (next) el.setAttribute('class', next)
      else el.removeAttribute('class')
    } else if (op === 'setStyle') {
      const existingPreview = mutationLog.get(mutationId)?.some(
        (snapshot) => snapshot.op === 'setStyle' && snapshot.el === el,
      )
      const resizeHandoff = consumeInspectStyleHandoff(el)
      const prevStyleAttr = resizeHandoff
        ? resizeHandoff.prevStyleAttr
        : el.getAttribute('style')
      // Scrub previews reuse one mutation id. Retain only the original
      // baseline for this element so a long drag does not grow the mutation
      // log on every pointermove and revert still restores the true start.
      if (!existingPreview) snapshots.push({ op: 'setStyle', el, prevStyleAttr })
      if (value && typeof value === 'object') {
        const styleObj = value as Record<string, string | number | null>
        for (const key of Object.keys(styleObj)) {
          const v = styleObj[key]
          // CSS custom properties (--foo) and kebab-case keys cannot be set via
          // el.style[key] — CSSStyleDeclaration only exposes camelCase accessors.
          // Fall through to setProperty/removeProperty for those so optimistic
          // previews are not silently dropped if ever sent by the server.
          const isCustomOrHyphenated = key.startsWith('--') || key.includes('-')
          if (v === null || v === '' || v === undefined) {
            if (isCustomOrHyphenated) {
              el.style.removeProperty(key)
            } else {
              ;(el.style as unknown as Record<string, string>)[key] = ''
            }
          } else {
            const nextValue = String(v)
            if (isCustomOrHyphenated) {
              el.style.setProperty(key, nextValue)
            } else {
              ;(el.style as unknown as Record<string, string>)[key] = nextValue
            }
          }
        }
      }
    } else if (op === 'setSvgPrimaryFill') {
      if (
        el.tagName.toLowerCase() === 'svg' &&
        typeof value === 'string' &&
        /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)
      ) {
        const paintTargets = [
          el,
          ...Array.from(el.querySelectorAll(
            'path, circle, ellipse, line, polygon, polyline, rect, text, use',
          )) as HTMLElement[],
        ]
        for (const paintTarget of paintTargets) {
          snapshots.push({
            op: 'setStyle',
            el: paintTarget,
            prevStyleAttr: paintTarget.getAttribute('style'),
          })
          paintTarget.style.setProperty('fill', value, 'important')
        }
      }
    } else if (op === 'replaceSvgMarkup') {
      if (el.tagName.toLowerCase() !== 'svg' || !svgPreviewPayload) continue
      const existingPreview = mutationLog.get(mutationId)?.some(
        (snapshot) => snapshot.op === 'replaceSvgMarkup' && snapshot.el === el,
      )
      const snapshot = applySvgPreview(mutationId, el, svgPreviewPayload)
      if (!existingPreview) snapshots.push(snapshot)
    } else if (op === 'setAttribute') {
      if (
        value &&
        typeof value === 'object' &&
        ('name' in value) &&
        ('value' in value) &&
        (
          value.name === 'src' ||
          value.name === 'alt' ||
          value.name === 'aria-label' ||
          value.name === 'role' ||
          value.name === 'placeholder'
        ) &&
        typeof value.value === 'string'
      ) {
        snapshots.push({ op: 'setAttribute', el, name: value.name, prev: el.getAttribute(value.name) })
        const resolved = value.name === 'src' && value.value.startsWith('mercury-attachments/')
          ? appAbsolutePath('/' + value.value)
          : value.value
        el.setAttribute(value.name, resolved)
      }
    }
  }
  // Append new snapshots so revert can walk newest-first (end of the array)
  // and restore all the way back to the original state when several mutations
  // share a mutationId.
  const existing = mutationLog.get(mutationId)
  if (existing) {
    mutationLog.set(mutationId, [...existing, ...snapshots])
  } else {
    mutationLog.set(mutationId, snapshots)
  }
}

function revertMutation(mutationId: string): void {
  const snapshots = mutationLog.get(mutationId)
  if (!snapshots) return
  const mutationTargets: Array<Element | null> = []
  for (const snapshot of snapshots) {
    if ('el' in snapshot) mutationTargets.push(snapshot.el)
    else mutationTargets.push(...findOidNodes(snapshot.oid))
  }
  markMercuryMutationTargets(mutationTargets)
  // Walk in reverse so we restore latest-first (handles overlapping mutations).
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const snap = snapshots[i]
    // Color-override snapshots don't reference an element; restore the
    // sheet entry directly. Skip the isConnected check that's only
    // meaningful for element-targeted snapshots.
    if (snap.op === 'setPropertyOverride') {
      restorePropertyOverrides(snap.oid, snap.prevOverrides, snap.scopeId)
      if (snap.scopeId) cleanupPropertyOverrideScopeIfUnused(snap.oid, snap.scopeId)
      continue
    }
    if (snap.op === 'setColorOverride') {
      setColorOverride(snap.oid, snap.property, snap.prevHex, snap.state, snap.variant, snap.scopeId)
      if (snap.scopeId) cleanupColorOverrideScopeIfUnused(snap.scopeId)
      continue
    }
    if (snap.op === 'replaceSvgMarkup') {
      cleanupSvgPreview(snap)
      continue
    }
    if (!snap.el.isConnected) continue
    if (snap.op === 'setText') {
      // Restore the authored Text nodes in place, leaving every element child
      // as the exact node React rendered. Reassigning innerHTML here instead
      // reparsed those children into replacements React's fiber does not know
      // about, so the subtree rendered once and then went inert -- undoing an
      // edit to <p>Seconds: <output>{n}</output></p> froze the counter.
      //
      // A refusal is NOT a reason to fall back to reparsing. It means another
      // writer owns these children, and the only writer that reaches into a
      // Mercury-edited element is React -- which has already replaced the
      // optimistic text with its own render, leaving nothing to undo. Parsing
      // the captured markup over that would destroy the newer subtree and
      // detach its nodes: the precise damage this branch exists to avoid, on
      // the one path that reaches it.
      snap.restore()
    } else if (snap.op === 'setClassName') {
      if (snap.prev === null) snap.el.removeAttribute('class')
      else snap.el.setAttribute('class', snap.prev)
    } else if (snap.op === 'setStyle' || snap.op === 'removeElement') {
      if (snap.op === 'removeElement') snap.el.removeAttribute(DELETED_MARK_ATTR)
      // removeElement previews a deletion as display:none, so undoing it is
      // the same inline-style restore as setStyle.
      if (snap.prevStyleAttr === null) snap.el.removeAttribute('style')
      else snap.el.setAttribute('style', snap.prevStyleAttr)
      if (snap.op === 'removeElement') positionSelectedOverlay()
    } else if (snap.op === 'setAttribute') {
      if (snap.prev === null) snap.el.removeAttribute(snap.name)
      else snap.el.setAttribute(snap.name, snap.prev)
    } else if (snap.op === 'reorderChild') {
      snap.parent.insertBefore(snap.el, snap.prevNextSibling)
      positionSelectedOverlay()
    }
  }
  mutationLog.delete(mutationId)
}

function commitMutation(mutationId: string): void {
  // Commit drops the rollback record — once the backend rebuild lands,
  // we do not need to revert anything; the new bundle reflects the change.
  //
  // Scoped color overrides are the exception: a committed set must keep its
  // scope token so the pinned iframe keeps showing the preview until a natural
  // reload, while a committed clear should drop the token if no remaining
  // override rule targets it. Scope tokens are not refcounted, so checking
  // each touched scope once is enough even when one mutation has multiple
  // snapshots for the same shared instance.
  const snapshots = mutationLog.get(mutationId)
  if (snapshots) {
    const scopesToClean = new Set<string>()
    let clearedRemoval = false
    for (const snap of snapshots) {
      if (snap.op === 'setColorOverride' && snap.scopeId) {
        scopesToClean.add(snap.scopeId)
      } else if (snap.op === 'setPropertyOverride' && snap.scopeId) {
        cleanupPropertyOverrideScopeIfUnused(snap.oid, snap.scopeId)
      } else if (snap.op === 'removeElement' && snap.el.isConnected) {
        // A hidden node is the one exception to "the new bundle reflects the
        // change": the bundle no longer renders the deleted element, but the DOM
        // NODE that was hidden usually survives. Static siblings carry no key,
        // so React reconciles by position and re-renders the node into the gap
        // the deletion left -- with our display:none still on it. The deleted
        // card disappeared and the NEXT one went invisible with it, until a
        // reload rebuilt the DOM from scratch.
        //
        // The mark matters just as much: extractProps skips marked nodes, so a
        // recycled one stays invisible to instance indexing and every later
        // ordinal in this frame counts one node short.
        //
        // Restore only the display property, not the whole style attribute the
        // snapshot holds: an animation library owns the rest of this node's
        // inline style and has almost certainly written to it since, so putting
        // the old attribute back would clobber a transform mid-flight.
        // DEFERRED, not immediate. Commit fires when the SERVER acks the edit,
        // which is well before HMR swaps the bundle in -- so restoring here put
        // the display back on the node the OLD bundle still renders as the
        // deleted element, and the card the user just deleted reappeared for as
        // long as the rebuild took, or indefinitely if HMR never landed.
        //
        // Waiting for the node to leave the DOM is the signal that the new
        // bundle has actually taken over; there is then nothing to restore. The
        // restore only matters for the other outcome -- React recycling this node
        // for the next sibling -- and that node is still connected, so the timer
        // below covers it.
        scheduleDeletedNodeRestore(snap.el, snap.prevStyleAttr)
        clearedRemoval = true
      } else if (snap.op === 'replaceSvgMarkup') {
        // Commit means source has been updated, but React may not have applied
        // the HMR payload yet. Keep the overlay until that render settles so
        // the old icon never flashes back between the API response and HMR.
        snap.committed = true
        snap.handoffTimer = setTimeout(
          () => cleanupSvgPreview(snap),
          SVG_PREVIEW_HANDOFF_GRACE_MS,
        )
      }
    }
    for (const scopeId of scopesToClean) {
      cleanupColorOverrideScopeIfUnused(scopeId)
    }
    if (clearedRemoval) positionSelectedOverlay()
  }
  mutationLog.delete(mutationId)
}

let bridgeCaptureImageConstructorUsers = 0
let bridgeCaptureOriginalImageConstructor: typeof Image | null = null
let bridgeCaptureImageConstructor: typeof Image | null = null

function useBridgeFrameForNextImageDecodeContinuation(image: HTMLImageElement): void {
  const decode = image.decode
  if (typeof decode !== 'function') return
  image.decode = function(): Promise<void> {
    const decodeResult = decode.call(this)
    const originalThen = decodeResult.then.bind(decodeResult)
    // html-to-image's createImage() explicitly chains decode().then(...) and
    // requests a global rAF inside that continuation. Run only that immediate
    // continuation in the private-frame scope; the scope ends synchronously
    // before any unrelated app task can request a frame.
    decodeResult.then = ((
      onFulfilled: ((value: void) => unknown) | null | undefined,
      onRejected: ((reason: unknown) => unknown) | null | undefined,
    ) => originalThen(
      typeof onFulfilled === 'function'
        ? (value: void) => appAnimationFrameScheduler.runWithNativeRequestScope(
            () => onFulfilled(value),
          )
        : onFulfilled,
      onRejected,
    )) as typeof decodeResult.then
    return decodeResult
  }
}

async function withBridgeScheduledCaptureImages<T>(operation: () => Promise<T>): Promise<T> {
  if (bridgeCaptureImageConstructorUsers === 0) {
    const originalImageConstructor = window.Image
    const captureImageConstructor = new Proxy(originalImageConstructor, {
      construct(target, args) {
        const image = Reflect.construct(target, args) as HTMLImageElement
        useBridgeFrameForNextImageDecodeContinuation(image)
        return image
      },
    }) as typeof Image
    bridgeCaptureOriginalImageConstructor = originalImageConstructor
    bridgeCaptureImageConstructor = captureImageConstructor
    window.Image = captureImageConstructor
  }
  bridgeCaptureImageConstructorUsers += 1
  try {
    return await operation()
  } finally {
    bridgeCaptureImageConstructorUsers -= 1
    if (bridgeCaptureImageConstructorUsers === 0) {
      // Preserve a wrapper installed by the app while capture was running.
      if (
        bridgeCaptureImageConstructor !== null &&
        bridgeCaptureOriginalImageConstructor !== null &&
        window.Image === bridgeCaptureImageConstructor
      ) {
        window.Image = bridgeCaptureOriginalImageConstructor
      }
      bridgeCaptureImageConstructor = null
      bridgeCaptureOriginalImageConstructor = null
    }
  }
}

async function captureNodeToPng(
  captureTarget: HTMLElement,
  viewportWidth: number,
  viewportHeight: number,
): Promise<string> {
  const svgDataUrl = await withBridgeScheduledCaptureImages(() =>
    toSvg(captureTarget, {
      cacheBust: false,
      skipFonts: true,
      backgroundColor: '#ffffff',
      width: viewportWidth,
      height: viewportHeight,
    }),
  )
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const decodedImage = new Image()
    decodedImage.onload = () => {
      const resolveOnNativeFrame = (): void => {
        bridgeRequestAnimationFrame(() => resolve(decodedImage))
      }
      if (typeof decodedImage.decode === 'function') {
        decodedImage.decode().then(resolveOnNativeFrame, reject)
      } else {
        resolveOnNativeFrame()
      }
    }
    decodedImage.onerror = reject
    decodedImage.crossOrigin = 'anonymous'
    decodedImage.decoding = 'async'
    decodedImage.src = svgDataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewportWidth * 0.5))
  canvas.height = Math.max(1, Math.round(viewportHeight * 0.5))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create thumbnail canvas context.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

/**
 * One declaration's value out of a raw style ATTRIBUTE string, or null.
 *
 * Reads the snapshot text rather than the live element: by commit time the
 * element's own style has moved on, and the question here is what the property
 * was before the preview touched it.
 */
function readStyleDeclaration(styleAttr: string | null, property: string): string | null {
  if (!styleAttr) return null
  const parts = styleAttr.split(';')
  for (let i = 0; i < parts.length; i++) {
    const colon = parts[i].indexOf(':')
    if (colon < 0) continue
    if (parts[i].slice(0, colon).trim().toLowerCase() !== property) continue
    const value = parts[i].slice(colon + 1).replace('!important', '').trim()
    if (value.length > 0) return value
  }
  return null
}

function hideHoverOnLeave(): void {
  hideOverlay()
  // The pointer left this document, so it is no longer a likely comment target.
  setCommentPointerEngaged(false)
}

function onBridgeMessage(e: MessageEvent): void {
  if (e.source !== window.parent) return
  if (!isTrustedAppParentOrigin(e.origin)) return
  if (trustedParentOrigin != null && e.origin !== trustedParentOrigin) return
  const data = e.data
  if (!data || typeof data !== 'object') return
  if (data.source !== 'mercury') return
  if (trustedParentOrigin == null) {
    trustedParentOrigin = e.origin
    // Boot state was dropped before the parent origin was pinned. Re-emit it so
    // the parent receives its HMR baseline, page list, and initial page size.
    postHmrRevisionSnapshot()
    publishPageStateAfterParentPin?.()
  }
  if (data.type === 'set-inspect-mode') {
    const demoMotionChanged = demoKeepAnimationsRunning !== (data.keepAnimationsRunning === true)
    demoKeepAnimationsRunning = data.keepAnimationsRunning === true
    inspectMoveEnabled = Boolean(data.moveEnabled)
    inspectResizeEnabled = Boolean(data.resizeEnabled)
    inlineTextEditEnabled = Boolean(data.inlineTextEditEnabled)
    if (!inspectMoveEnabled) cancelInspectMove()
    if (!inspectResizeEnabled) cancelInspectResize()
    if (!inlineTextEditEnabled) finishInlineTextEdit(true)
    syncInspectResizeHandles()
    // cursorMode is the current parent contract. Keep commentMode as a
    // compatibility fallback while older cached canvases still send it.
    const controlsChanged = dynamicControlsEnabled !== (data.dynamicControlsEnabled === true)
    dynamicControlsEnabled = data.dynamicControlsEnabled === true
    if (controlsChanged) {
      syncDynamicFeatureObserver()
      resumeAllAnimations()
      lastDynamicFeatures = ''
      if (dynamicControlsEnabled) publishDynamicFeatures(true)
      else post({ source: 'mercury-bridge', type: 'dynamic-features', features: [] })
    }
    setInspectMode(
      Boolean(data.enabled),
      data.cursorMode === 'comment' || data.commentMode === true,
      data.freezeAnimations === true,
      dynamicControlsEnabled && data.testInteraction === true,
    )
    if (controlsChanged || demoMotionChanged) syncAnimationPauseState()
    positionSelectedOverlay()
    return
  }
  if (data.type === 'move-inspect-selection') {
    const direction = data.direction
    if (
      direction !== 'next-sibling' &&
      direction !== 'previous-sibling' &&
      direction !== 'parent' &&
      direction !== 'first-child'
    ) return
    const oid = typeof data.oid === 'string' && data.oid ? data.oid : null
    if (!oid) return
    let fallbackAnchor: HTMLElement | null = null
    if (!selectedTarget || selectedTarget.isConnected === false) {
      const targets = findOidNodes(oid)
      const instanceIndex =
        typeof data.instanceIndex === 'number' &&
        Number.isInteger(data.instanceIndex) &&
        data.instanceIndex >= 0
          ? data.instanceIndex
          : 0
      fallbackAnchor = targets[instanceIndex] ?? targets[0] ?? null
    }
    moveInspectSelection(direction, fallbackAnchor)
    return
  }
  if (data.type === 'select-inspect-edge') {
    if (data.edge !== 'first' && data.edge !== 'last') return
    const direction =
      data.direction === 'next-sibling' || data.direction === 'previous-sibling'
        ? data.direction
        : undefined
    selectInspectTraversalEdge(data.edge, direction)
    return
  }
  if (data.type === 'scroll-to-comment') {
    // Parent can't scroll this cross-origin document, so it asks us to bring the
    // element into view; the resulting scroll republishes anchors and the marker returns.
    if (typeof data.oid !== 'string' || !data.oid) return
    const rawLocator = data.instanceLocator
    if (!rawLocator || typeof rawLocator !== 'object' || !Array.isArray(rawLocator.path) || rawLocator.path.length > 128) return
    if (!rawLocator.path.every((part: unknown) => typeof part === 'number' && Number.isInteger(part) && part >= 0)) return
    if (typeof rawLocator.fingerprint !== 'string' || rawLocator.fingerprint.length > 256 || !/^v1-[a-f0-9]{8}$/.test(rawLocator.fingerprint)) return
    const target: TrackedCommentTarget = {
      oid: data.oid,
      instanceLocator: { path: rawLocator.path.slice(), fingerprint: rawLocator.fingerprint },
    }
    // Navigation can race the expanded tile's initial marker subscription.
    // This is still a parent-authenticated, fully validated locator; do not make
    // scrolling depend on the marker subscription having arrived first.
    const el = findCommentAnchorElement(target)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    return
  }
  if (data.type === 'highlight-comment-target') {
    if (data.enabled !== true) {
      clearCommentTargetHighlight()
      return
    }
    if (typeof data.oid !== 'string' || !data.oid) return
    const rawLocator = data.instanceLocator
    if (!rawLocator || typeof rawLocator !== 'object' || !Array.isArray(rawLocator.path) || rawLocator.path.length > 128) return
    if (!rawLocator.path.every((part: unknown) => typeof part === 'number' && Number.isInteger(part) && part >= 0)) return
    if (typeof rawLocator.fingerprint !== 'string' || rawLocator.fingerprint.length > 256 || !/^v1-[a-f0-9]{8}$/.test(rawLocator.fingerprint)) return
    setCommentTargetHighlight({
      oid: data.oid,
      instanceLocator: { path: rawLocator.path.slice(), fingerprint: rawLocator.fingerprint },
    })
    return
  }
  if (data.type === 'set-comment-anchors') {
    const rawTargets = Array.isArray(data.targets) ? data.targets : []
    const parsedTargets: TrackedCommentTarget[] = []
    for (const raw of rawTargets) {
      if (!raw || typeof raw !== 'object') continue
      const oid = typeof raw.oid === 'string' && raw.oid.length > 0 ? raw.oid : null
      if (!oid) continue
      const locator = raw.instanceLocator
      if (!locator || typeof locator !== 'object' || !Array.isArray(locator.path) || locator.path.length > 128) continue
      if (!locator.path.every((part: unknown) => typeof part === 'number' && Number.isInteger(part) && part >= 0)) continue
      if (typeof locator.fingerprint !== 'string' || locator.fingerprint.length > 256 || !/^v1-[a-f0-9]{8}$/.test(locator.fingerprint)) continue
      parsedTargets.push({ oid, instanceLocator: { path: locator.path.slice(), fingerprint: locator.fingerprint } })
    }
    trackedCommentTargets = parsedTargets
    lastPublishedAnchors = ''
    syncCommentAnchorObserver()
    // Publish immediately so the parent gets true positions without waiting for
    // the user to scroll (the stored capture-time rect may already be stale).
    publishCommentAnchors()
    return
  }
  if (data.type === 'restore-selected-elements') {
    if (!inspectEnabled) return
    const rawSelections = Array.isArray(data.selections) ? data.selections : []
    const selections: Array<{ oid: string; instanceIndex?: number | null }> = []
    for (const raw of rawSelections) {
      if (!raw || typeof raw !== 'object') continue
      const oid = typeof raw.oid === 'string' ? raw.oid : null
      if (!oid) continue
      const instanceIndex =
        typeof raw.instanceIndex === 'number' &&
        Number.isInteger(raw.instanceIndex) &&
        raw.instanceIndex >= 0
          ? raw.instanceIndex
          : null
      selections.push({ oid, instanceIndex })
    }
    restoreSelectedTargets(selections)
    return
  }
  if (data.type === 'request-dynamic-features') {
    publishDynamicFeatures(true)
    return
  }
  if (data.type === 'select-dynamic-feature') {
    if (!dynamicControlsEnabled) return
    if (typeof data.oid !== 'string') return
    const targets = findOidNodes(data.oid)
    if (targets.length !== 1 || !dynamicRegistration(targets[0])) {
      publishDynamicFeatures(true)
      return
    }
    setInspectMode(true)
    selectInspectTarget(targets[0], false)
    scrollInspectTargetIntoView(targets[0])
    return
  }
  if (data.type === 'request-layers-tree') {
    publishLayersTree()
    return
  }
  if (data.type === 'select-layer') {
    if (!inspectEnabled) return
    const oid = typeof data.oid === 'string' ? data.oid : null
    if (!oid) return
    const targets = findOidNodes(oid)
    const instanceIndex =
      typeof data.instanceIndex === 'number' &&
      Number.isInteger(data.instanceIndex) &&
      data.instanceIndex >= 0
        ? data.instanceIndex
        : 0
    const target = targets[instanceIndex] ?? targets[0]
    if (target) {
      selectInspectTarget(target, false)
      // Layers selection is the one path with no click to anchor the viewport,
      // so reveal the element rather than ringing something off-screen.
      scrollInspectTargetIntoView(target)
    }
    return
  }
  if (data.type === 'select-at-point') {
    if (!inspectEnabled) return
    const point = resolveInspectPointFromFractions(data.fractionX, data.fractionY)
    if (!point) return
    // Only this document knows which route it has actually rendered: an expanded
    // tile keeps the group's home URL and reaches its own route through a
    // set-route message after boot, so a point captured on that route must not
    // be resolved against whatever is on screen in the meantime.
    if (!isInspectPointRouteRendered(data.routePath)) return
    const elementAtPoint = document.elementFromPoint(point.x, point.y)
    const target = findInspectTargetAtPoint(elementAtPoint, point.x, point.y)
    if (target) {
      selectInspectTarget(target, false)
    }
    return
  }
  if (data.type === 'preview-at-point') {
    // Inverse of select-at-point: when this frame owns a real Inspect session
    // its own onPointerMove drives hover, and two drivers would fight.
    if (inspectEnabled) return
    // Only show the preview if the pointer is actually over the route the
    // parent thinks it is hovering.
    if (!isInspectPointRouteRendered(data.routePath)) {
      hideOverlay()
      return
    }
    const point = resolveInspectPointFromFractions(data.fractionX, data.fractionY)
    // When the parent omits fractions, the pointer has left this frame.
    if (!point) {
      hideOverlay()
      return
    }
    const elementAtPoint = document.elementFromPoint(point.x, point.y)
    const target = findInspectTargetAtPoint(elementAtPoint, point.x, point.y)
    if (!target) {
      hideOverlay()
      return
    }
    // Dedupe: do not reposition the overlay if the target has not changed.
    if (target === lastHoverTarget) return
    lastHoverTarget = target
    positionOverlay(target)
    return
  }
  if (data.type === 'begin-inline-text-edit') {
    if (!inspectEnabled || !inlineTextEditEnabled || cursorMode !== 'inspect') return
    const oid = typeof data.oid === 'string' ? data.oid : null
    if (!oid) return
    const targets = findOidNodes(oid)
    const instanceIndex =
      typeof data.instanceIndex === 'number' &&
      Number.isInteger(data.instanceIndex) &&
      data.instanceIndex >= 0
        ? data.instanceIndex
        : 0
    const target = targets[instanceIndex] ?? targets[0]
    if (!target) return
    selectInspectTarget(target, false)
    // Same reasoning as select-layer: this is reached by double-click / Enter
    // on a Layers row, so the caret would otherwise land off-screen.
    scrollInspectTargetIntoView(target)
    startInlineTextEdit(target)
    return
  }
  if (data.type === 'set-route') {
    updatePageMeasureViewportBaseline(data.baselineWidth, data.baselineHeight)
    if (data.path == null) {
      const expandedRouteActive =
        document.documentElement.getAttribute('data-mercury-expanded-route') === 'true'
      const restoreAbsolutePath = appAbsolutePath(originalAppRoutePath)
      const routeWillChange = location.pathname !== restoreAbsolutePath
      const needsRenderWindow = routeUpdateNeedsRenderWindow(
        false,
        routeWillChange,
        expandedRouteActive,
      )
      setExpandedViewportBaseline(false)
      pinnedRoutePath = null
      try {
        if (needsRenderWindow) {
          beginInspectRenderPrime()
          syncAnimationPauseState()
        }
        if (routeWillChange) {
          runMercuryRouteChange(() => {
            nativePushState({}, '', restoreAbsolutePath)
            window.dispatchEvent(new PopStateEvent('popstate'))
          })
        }
        scheduleSettledPageSizePublish()
      } catch {
        /* unparseable / blocked — nothing to do */
      }
      return
    }
    // Navigate this iframe to a specific SPA route without forcing a full
    // page load. Expanded-view tiles use the default pinned behavior; the
    // collapsed track-properties route picker passes pin:false so the frame
    // retains normal scrolling and in-app navigation after the route opens.
    //
    // Pinning is required for expanded-view tiles: the
    // template's BrowserRouter computes basename from
    // location.pathname.slice(0,2), so loading the iframe directly at
    // /tech makes the router treat /tech as basename and strip it,
    // collapsing every route to '/'. By keeping the iframe's URL at the
    // original (home) path and SPA-navigating from inside, the basename
    // is computed once at home (correctly) and routes resolve as
    // expected.
    const path = typeof data.path === 'string' ? data.path : null
    if (!path || !path.startsWith('/')) return
    const normalizedPath = normalizePagePath(path)
    const shouldPinRoute = data.pin !== false
    pinnedRoutePath = shouldPinRoute ? normalizedPath : null
    const absolutePath = appAbsolutePath(normalizedPath)
    const routeWillChange = location.pathname !== absolutePath
    const expandedRouteActive =
      document.documentElement.getAttribute('data-mercury-expanded-route') === 'true'
    const needsRenderWindow = routeUpdateNeedsRenderWindow(
      shouldPinRoute,
      routeWillChange,
      expandedRouteActive,
    )
    const settleGeneration = shouldPinRoute && needsRenderWindow
      ? beginViewportAnimationSettle()
      : null
    setExpandedViewportBaseline(shouldPinRoute)
    if (needsRenderWindow) {
      beginInspectRenderPrime()
      syncAnimationPauseState()
    }
    if (settleGeneration !== null) {
      // Expansion changes the effective viewport even when the SPA pathname is
      // already correct (most notably Home). Give those same-route layouts the
      // same entrance-animation window as a route navigation.
      scheduleViewportAnimationFreeze(settleGeneration)
    }
    if (!routeWillChange) {
      scheduleSettledPageSizePublish()
      return
    }
    try {
      runMercuryRouteChange(() => {
        nativePushState({}, '', absolutePath)
        // pushState alone doesn't notify listeners — react-router-dom v6
        // subscribes via popstate. Dispatching a synthetic popstate event
        // is the cross-version-safe way to make the in-iframe router
        // re-render.
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
      scheduleSettledPageSizePublish()
    } catch {
      // Do not leave an existing Inspect freeze suppressed if navigation was
      // rejected before the route could begin settling.
      cancelViewportAnimationSettleUnlessInspectOwned()
      syncAnimationPauseState()
    }
    return
  }
  if (data.type === 'set-page-size-freeze') {
    const enabled = data.enabled === true
    if (pageSizeHostFrozen === enabled) return
    pageSizeHostFrozen = enabled
    if (enabled) {
      cancelScheduledPageSizePublishes()
      return
    }
    if (pageSizeHmrFrozen) return
    const path = normalizePagePath(pinnedRoutePath ?? location.pathname ?? '/')
    pageMeasureSettleStates.delete(path)
    scheduleSettledPageSizePublish()
    return
  }
  if (data.type === 'observe-edit-targets') {
    const correlationId = typeof data.correlationId === 'string' ? data.correlationId : null
    const rawChecks: unknown[] = Array.isArray(data.checks) ? data.checks.slice(0, 64) : []
    if (!correlationId) return
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const routePath = location.pathname + location.search + location.hash
    const observations = rawChecks.flatMap((raw): Array<{ key: string; found: boolean; value: string | null; viewport: { width: number; height: number }; routePath: string }> => {
      if (!raw || typeof raw !== 'object') return []
      const check = raw as Record<string, unknown>
      const key = typeof check.key === 'string' ? check.key : null
      const oid = typeof check.oid === 'string' ? check.oid : null
      const kind = check.kind
      // Shared by style and attribute read-back: accept React camelCase keys,
      // hyphenated DOM attributes, and CSS custom properties (including underscores).
      const property = typeof check.property === 'string' && check.property.length <= 64 && /^(?:[a-zA-Z][a-zA-Z0-9-]*|--[a-zA-Z][a-zA-Z0-9_-]*)$/.test(check.property)
        ? check.property
        : null
      const instanceIndex =
        typeof check.instanceIndex === 'number' && Number.isInteger(check.instanceIndex) && check.instanceIndex >= 0
          ? check.instanceIndex
          : 0
      const textSegmentIndex =
        typeof check.textSegmentIndex === 'number' && Number.isInteger(check.textSegmentIndex) && check.textSegmentIndex >= 0
          ? check.textSegmentIndex
          : null
      const includeOptimisticallyDeleted = check.includeOptimisticallyDeleted === true
      if (!key || !oid || (kind !== 'css' && kind !== 'inlineStyle' && kind !== 'text' && kind !== 'attribute' && kind !== 'className')) return []
      const element = findOidNodes(oid, includeOptimisticallyDeleted)[instanceIndex]
      if (!element) return [{ key, found: false, value: null, viewport, routePath }]
      let value: string | null = null
      if (kind === 'css' && property) {
        const cssProperty = property.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())
        value = getComputedStyle(element).getPropertyValue(cssProperty).trim()
      } else if (kind === 'inlineStyle' && property) {
        const cssProperty = property.startsWith('--')
          ? property
          : property.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())
        value = element.style.getPropertyValue(cssProperty).trim()
      } else if (kind === 'text') {
        if (textSegmentIndex != null) {
          const directSegments: Node[] = []
          for (let i = 0; i < element.childNodes.length; i++) {
            const child = element.childNodes[i]
            if (child.nodeType === 3 && (child.nodeValue ?? '').trim().length > 0) {
              directSegments.push(child)
            }
          }
          value = directSegments[textSegmentIndex]?.nodeValue ?? null
        } else {
          // Text edits only rewrite immediate Text-node children. Reading the
          // whole recursive textContent would include untouched descendants
          // and create false mismatches for mixed-content elements.
          let directText = ''
          for (let i = 0; i < element.childNodes.length; i++) {
            const child = element.childNodes[i]
            if (child.nodeType === 3) directText += child.nodeValue ?? ''
          }
          value = directText
        }
      } else if (kind === 'attribute' && property) {
        value = element.getAttribute(property)
      } else if (kind === 'className') {
        value = element.getAttribute('class')
      }
      return [{ key, found: true, value, viewport, routePath }]
    })
    post({ source: 'mercury-bridge', type: 'edit-targets-observed', correlationId, observations })
    return
  }
  if (data.type === 'mutate-dom') {
    const mutationId = typeof data.mutationId === 'string' ? data.mutationId : null
    const oid = typeof data.oid === 'string' ? data.oid : null
    const op =
      data.op === 'setText' ||
      data.op === 'setTextSegment' ||
      data.op === 'setClassName' ||
      data.op === 'setStyle' ||
      data.op === 'setAttribute' ||
      data.op === 'setSvgPrimaryFill' ||
      data.op === 'replaceSvgMarkup' ||
      data.op === 'reorderChild' ||
      data.op === 'setColorOverride' ||
      data.op === 'setPropertyOverride' ||
      data.op === 'loadGoogleFont' ||
      data.op === 'removeElement'
        ? (data.op as MutationOp)
        : null
    if (!mutationId || !oid || !op) return
    // Optional per-instance targeting. Absent or malformed → fall back to
    // the legacy "apply to every node with this oid" behavior so older
    // callers keep working after the bridge ships.
    const instanceIndex =
      typeof data.instanceIndex === 'number' &&
      Number.isInteger(data.instanceIndex) &&
      data.instanceIndex >= 0
        ? data.instanceIndex
        : null
    applyMutation(mutationId, oid, op, data.value, instanceIndex)
    if (dynamicControlsEnabled && selectedTarget?.getAttribute('data-oid') === oid) queueSelectedPropsRefresh()
    return
  }
  if (data.type === 'revert-dom') {
    const mutationId = typeof data.mutationId === 'string' ? data.mutationId : null
    if (!mutationId) return
    revertMutation(mutationId)
    if (dynamicControlsEnabled) queueSelectedPropsRefresh()
    return
  }
  if (data.type === 'commit-dom') {
    const mutationId = typeof data.mutationId === 'string' ? data.mutationId : null
    if (!mutationId) return
    commitMutation(mutationId)
    return
  }
  if (data.type === 'capture-thumbnail') {
    const correlationId =
      typeof data.correlationId === 'string' ? data.correlationId : null
    if (!correlationId) return
    const reply = (payload: Record<string, unknown>): void => {
      postToParent({ source: 'mercury-bridge', type: 'thumbnail-captured', correlationId, ...payload })
    }
    if (typeof toSvg !== 'function') {
      reply({ error: 'no-html-to-image' })
      return
    }
    // Wait for the app to actually finish rendering before snapshotting.
    // Bridge-ready fires very early (just after main.tsx imports the bridge),
    // long before React hydrates + CSS / web fonts / images settle. Without
    // this gate, the SVG capture sees an empty body shell or just the bg color.
    //
    // Strategy:
    //   1. Wait for window load (document.readyState === 'complete') OR 4 s.
    //   2. After load: 2 rAFs to let React commit + browser paint.
    //   3. Poll for visible content (innerText length > 0 OR any child
    //      element other than script/style/bridge). Re-check every
    //      400 ms up to ~5 s. Capture as soon as content shows.
    //   4. Hard upper bound: capture regardless after 6 s post-load.
    const waitForRender = (cb: () => void): void => {
      let captured = false
      let started = false
      const fire = (): void => {
        if (captured) return
        captured = true
        cb()
      }
      const hasVisibleContent = (): boolean => {
        const txt = (document.body?.innerText || '').trim()
        if (txt.length > 0) return true
        // SVG-only / canvas-only pages may have no text — fall back to
        // counting non-meta child elements anywhere under body.
        const nodes = document.body?.querySelectorAll(
          'div, section, header, footer, main, article, nav, img, svg, canvas, button, a, p, h1, h2, h3, h4, h5, h6, span',
        )
        return (nodes?.length ?? 0) > 0
      }
      const startPoll = (): void => {
        // The load event AND the 4s fallback timeout both fan into startPoll,
        // so guard against a second entry leaking duplicate rAFs/timers.
        if (started) return
        started = true
        const t0 = Date.now()
        const tick = (): void => {
          if (captured) return
          if (hasVisibleContent()) {
            // Give one extra RAF + 250 ms so the just-rendered content has
            // a chance to actually paint before we read pixels.
            bridgeRequestAnimationFrame(() => setTimeout(fire, 250))
            return
          }
          if (Date.now() - t0 > 6000) {
            fire()
            return
          }
          setTimeout(tick, 400)
        }
        // Two RAFs first, then start the content poll.
        bridgeRequestAnimationFrame(() => bridgeRequestAnimationFrame(tick))
      }
      if (document.readyState === 'complete') {
        startPoll()
      } else {
        window.addEventListener('load', startPoll, { once: true })
        // Fallback hard timeout — if window load never fires (slow CDN
        // asset), start polling anyway.
        setTimeout(startPoll, 4000)
      }
    }
    const captureTarget = document.body || document.documentElement
    waitForRender(() => {
      // Clip to the viewport so the thumbnail shows the top of the page (hero/
      // header) rather than wherever a tall body's vertical middle happens to
      // land once the dashboard renders an objectFit:cover img. document.body
      // origin is (0,0) at the page top, so width/height alone produce an
      // above-the-fold snapshot without scrolling.
      const viewportWidth = Math.max(
        1,
        window.innerWidth ||
          window.visualViewport?.width ||
          document.documentElement.clientWidth ||
          captureTarget.clientWidth ||
          1280,
      )
      const viewportHeight = Math.max(
        1,
        window.innerHeight ||
          window.visualViewport?.height ||
          document.documentElement.clientHeight ||
          captureTarget.clientHeight ||
          720,
      )
      // html-to-image's toPng() decodes through the app-facing global rAF.
      // Generate its SVG, then decode and draw through Mercury's private
      // scheduler so thumbnail work never releases application frames.
      captureNodeToPng(captureTarget, viewportWidth, viewportHeight)
        .then((dataUrl) => {
          reply({ dataUrl })
        })
        .catch((err: unknown) => {
          const name = (err as { name?: string } | null)?.name ?? ''
          reply({ error: name === 'SecurityError' ? 'tainted' : 'failed' })
        })
    })
    return
  }
}

// A modifier/pinch gesture inside an inspected frame belongs exclusively to
// Mercury's canvas. The zoom intent is posted before this helper is called;
// stopping dispatch here prevents the generated app from applying its own
// wheel/gesture zoom on top of the canvas transform. Outside Inspect, preserve
// propagation so an app's intentional interaction behavior remains unchanged.
function stopGeneratedAppZoomForInspect(e: Event): void {
  if (!inspectEnabled || cursorMode !== 'inspect') return
  e.stopImmediatePropagation()
}

// Idempotent install: if the bridge was already loaded (e.g. it's both
// imported from main.tsx AND injected via <script> in index.html, which we
// do for defense-in-depth against the agent rewriting the entry file),
// don't attach the listeners twice — that would double-fire every click
// and post 'ready' a second time.
const BRIDGE_INSTALL_KEY = '__mercuryBridgeInstalled__'
const w = window as unknown as Record<string, unknown>
if (!w[BRIDGE_INSTALL_KEY]) {
  w[BRIDGE_INSTALL_KEY] = true
  installIntersectionObserverSnapshotTracking()

  if (document.readyState === 'complete') {
    window.setTimeout(primeAnimationRenderAfterDocumentLoad, 0)
  } else {
    window.addEventListener('load', primeAnimationRenderAfterDocumentLoad, { once: true })
  }

  history.pushState = (function (
    state: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    const toPath = pathFromHistoryUrl(url)
    if (isPinnedCrossRoute(toPath)) {
      postLinkClick(toPath)
      return
    }
    nativePushState(state, unused, url)
    schedulePagesScan()
  }) as History['pushState']

  history.replaceState = (function (
    state: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    const toPath = pathFromHistoryUrl(url)
    if (isPinnedCrossRoute(toPath)) {
      postLinkClick(toPath)
      return
    }
    nativeReplaceState(state, unused, url)
    schedulePagesScan()
  }) as History['replaceState']

  window.addEventListener('message', onBridgeMessage)
  window.addEventListener(
    'error',
    (event: Event) => {
      if (!(event instanceof ErrorEvent)) return
      if (!event.error && !event.message) return
      postRuntimeError('error', event.error ?? event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      })
    },
    true,
  )
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    postRuntimeError('unhandledrejection', event.reason)
  })
  // MERCURY_BLOCK_NATIVE_ZOOM: stop native browser zoom (trackpad pinch /
  // Ctrl+wheel / Safari gesture / touchscreen pinch) from inside the iframe so
  // it never zooms the parent Mercury page, and instead forward the zoom intent
  // to the parent canvas so the frame tile scales like any canvas element.
  // The iframe is interactive (pointer-events:auto) for click-to-select, and it
  // is typically cross-origin, so the parent canvas can neither observe nor
  // intercept these events — only the bridge, running inside the iframe, can.
  // We report the pointer in the iframe's own viewport coordinates plus the
  // viewport size; the parent maps that back into canvas space.
  // { passive: false } is required or the browser ignores preventDefault on
  // wheel. Unmodified wheel (in-app scroll) is untouched.
  //
  // EMBEDDED-ONLY: this whole block suppresses + forwards native zoom only when
  // the app runs inside Mercury (an iframe). A standalone open of the generated
  // app (top-level dev.code.adobe.com/preview/...) must keep the end user's
  // native pinch / Ctrl+wheel / touchscreen zoom — gate on window.parent.
  if (window.parent !== window) {
  var postZoom = function (msg: Record<string, unknown>): void {
    // source key set last so a caller-supplied source can never clobber the
    // trusted bridge identity the parent gates on.
    postToParent(Object.assign({}, msg, { source: 'mercury-bridge' }))
  }
  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      // ctrlKey = native pinch/Ctrl+wheel zoom; metaKey = Cmd+wheel, which the
      // canvas treats as zoom too (Canvas.tsx handleWheel: metaKey || ctrlKey).
      // Forward both so zoom-over-frame matches zoom-over-canvas; plain wheel
      // (no modifier) is left alone so in-app scrolling still works.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      postZoom({
        type: 'canvas-zoom-wheel',
        deltaY: e.deltaY,
        x: e.clientX,
        y: e.clientY,
        vw: window.innerWidth,
        vh: window.innerHeight,
      })
      stopGeneratedAppZoomForInspect(e)
    },
    { passive: false, capture: true },
  )
  window.addEventListener(
    'gesturestart',
    (e: Event) => {
      e.preventDefault()
      const ge = e as Event & { clientX?: number; clientY?: number }
      postZoom({
        type: 'canvas-zoom-gesture-start',
        x: ge.clientX || 0,
        y: ge.clientY || 0,
        vw: window.innerWidth,
        vh: window.innerHeight,
      })
      stopGeneratedAppZoomForInspect(e)
    },
    { passive: false, capture: true } as AddEventListenerOptions,
  )
  window.addEventListener(
    'gesturechange',
    (e: Event) => {
      e.preventDefault()
      const ge = e as Event & { scale?: number }
      postZoom({ type: 'canvas-zoom-gesture', scale: ge.scale || 1 })
      stopGeneratedAppZoomForInspect(e)
    },
    { passive: false, capture: true } as AddEventListenerOptions,
  )
  window.addEventListener(
    'gestureend',
    (e: Event) => {
      e.preventDefault()
      stopGeneratedAppZoomForInspect(e)
    },
    { passive: false, capture: true } as AddEventListenerOptions,
  )
  // Touchscreen pinch: disable pinch-zoom, keep one-finger scroll/pan.
  document.documentElement.style.touchAction = 'pan-x pan-y'
  // Block scroll when expanded. The expanded tile shows the full page at
  // natural height — scrolling would shift content out of the visible area
  // and confuse the height measurement. Wheel without modifier (plain scroll)
  // is suppressed; Ctrl/Meta wheel (zoom) is handled above.
  document.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (interactionPreview || document.documentElement.getAttribute('data-mercury-expanded-route') !== 'true') return
      if (e.ctrlKey || e.metaKey) return
      e.preventDefault()
    },
    { passive: false, capture: true },
  )
  document.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (interactionPreview || document.documentElement.getAttribute('data-mercury-expanded-route') !== 'true') return
      e.preventDefault()
    },
    { passive: false, capture: true },
  )
  window.addEventListener(
    'scroll',
    () => {
      if (interactionPreview || document.documentElement.getAttribute('data-mercury-expanded-route') !== 'true') return
      window.scrollTo(0, 0)
    },
    true,
  )
  }
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('pointerdown', onInspectPointerDownCapture, true)
  document.addEventListener('pointerup', finishInspectResize, true)
  document.addEventListener('pointerup', finishInspectMove, true)
  document.addEventListener('pointercancel', onInspectResizePointerCancel, true)
  document.addEventListener('pointercancel', onInspectMovePointerCancel, true)
  document.addEventListener('mousedown', onInspectInteractionCapture, true)
  document.addEventListener('mouseup', onInspectInteractionCapture, true)
  document.addEventListener('keydown', onInspectKeyDownCapture, true)
  // Window capture is the earliest boundary inside the generated browsing
  // context. An app-level window/document listener must not be able to consume
  // Space first and trigger its own action (or the browser's page scroll).
  window.addEventListener('keydown', onInspectSpacePanKeyCapture, true)
  window.addEventListener('keyup', onInspectSpacePanKeyCapture, true)
  window.addEventListener('blur', releaseInspectSpacePan)
  window.addEventListener('pagehide', releaseInspectSpacePan)
  document.addEventListener('visibilitychange', releaseInspectSpacePanWhenHidden)
  document.addEventListener('keydown', onInspectHistoryKeyCapture, true)
  document.addEventListener('keydown', onInspectDeleteKeyCapture, true)
  document.addEventListener('click', onClickCapture, true)
  document.addEventListener('dblclick', onInspectDoubleClickCapture, true)
  document.addEventListener('auxclick', onInspectInteractionCapture, true)
  document.addEventListener('contextmenu', onInspectInteractionCapture, true)
  // Hide the hover outline the moment the pointer exits the iframe's content
  // area — otherwise pointermove stops firing and the ring freezes on the
  // last-hovered element (looks like the frame is highlighting things after
  // the user has already moved away). The selection ring is persistent and
  // stays intact.
  document.documentElement.addEventListener('pointerleave', hideHoverOnLeave)
  document.documentElement.addEventListener('mouseleave', hideHoverOnLeave)
  // Also bail if the window itself loses focus (user alt-tabs or clicks on
  // another iframe) — pointerleave doesn't always fire for that transition.
  window.addEventListener('blur', hideHoverOnLeave)
  // Keep the selection + hover overlays anchored on scroll/resize. Only real
  // scrolls close a pending comment composer; layout and resize syncs merely
  // reposition anchors. Capture phase observes nested scrollers too.
  window.addEventListener('scroll', onFrameScroll, true)
  window.addEventListener('resize', schedulePositionSync)

  // Pages-list: scan the rendered DOM for internal <a href> links from the
  // page's primary navigation regions and post the discovered pathnames to
  // the parent so the canvas can render each page as its own iframe tile
  // in expanded view. The home page (location.pathname) is always included
  // first.
  //
  // We filter aggressively to avoid the "26 product cards" problem: a
  // content-heavy homepage often links to dozens of detail pages, but the
  // expanded view is meant to mirror the SITE's top-level structure, not
  // every clickable thing. The heuristic:
  //   1. Prefer links inside <nav>, <header>, <footer>, [role="navigation"]
  //      — universal containers for primary navigation.
  //   2. If that produces fewer than 2 candidates, prefer same-origin links
  //      whose pathname has at most one segment (e.g. "/about", "/pricing").
  //      When there are fewer than 2 shallow links too, accept a bounded deep
  //      route collection only when its links share one parent path. This
  //      covers "/pattern/01" through "/pattern/10" without turning a large
  //      product/detail link wall into page tiles.
  //   3. Treat a rich candidate report as authoritative. Retain the prior list
  //      only while a non-Home child route is transiently sparse, so navigating
  //      does not erase Home's list but an HMR rebuild can prune removed routes.
  //   4. Cap every branch and the retained union at MAX_DISCOVERED_PAGES because
  //      each reported path becomes a live iframe tile in expanded view.
  const NAV_SELECTOR = 'nav a[href], header a[href], footer a[href], [role="navigation"] a[href]'

  let lastPagesListJson = ''
  let discoveredPagePaths: string[] = []
  function collectPagesFrom(selector: string): string[] {
    const seen = new Set<string>()
    const paths: string[] = []
    const links = document.querySelectorAll(selector)
    for (let i = 0; i < links.length; i++) {
      const raw = links[i].getAttribute('href')
      if (!raw) continue
      if (raw.length === 0 || raw[0] === '#') continue
      if (/^(mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) continue
      try {
        const url = new URL(raw, location.href)
        if (url.origin !== location.origin) continue
        const path = appRelativePath(url.pathname)
        if (seen.has(path)) continue
        seen.add(path)
        paths.push(path)
      } catch {
        /* unparseable href, skip */
      }
    }
    return paths
  }
  const MAX_DISCOVERED_PAGES = 12
  function selectPageCandidates(navigationPaths: string[], allPaths: string[], currentPath = '/'): string[] {
    if (navigationPaths.length >= 2) return navigationPaths.slice(0, MAX_DISCOVERED_PAGES)
    const shallowPaths = allPaths.filter((path) => path.split('/').filter(Boolean).length <= 1)
    if (shallowPaths.length >= 2) return shallowPaths.slice(0, MAX_DISCOVERED_PAGES)
    const deepPaths = allPaths.filter((path) => path.split('/').filter(Boolean).length > 1)
    if (deepPaths.length >= 2 && deepPaths.length <= MAX_DISCOVERED_PAGES) {
      const parentPaths = new Set(deepPaths.map((path) => path.slice(0, path.lastIndexOf('/')) || '/'))
      if (parentPaths.size === 1) return deepPaths
    }
    // Last resort: the rendered route is a page even when nothing links back
    // to it. A home whose logo is a #top anchor and whose only route link is
    // /login is two pages, not one. Only the link is returned:
    // mergeDiscoveredPages inserts the current route itself and relies on a
    // sparse (<2) candidate list to retain the siblings Home already
    // discovered while a child route is showing. This tier runs after the
    // link-only tiers so a single nav link never shadows a richer body.
    const loneLink = navigationPaths.length === 1 ? navigationPaths : shallowPaths
    if (loneLink.length === 1 && loneLink[0] !== currentPath) return loneLink
    return []
  }
  function mergeDiscoveredPages(
    previousPaths: string[],
    currentPath: string,
    candidatePaths: string[],
  ): string[] {
    const seen = new Set<string>()
    const paths: string[] = []
    const add = (path: string) => {
      if (seen.has(path) || paths.length >= MAX_DISCOVERED_PAGES) return
      seen.add(path)
      paths.push(path)
    }
    // The current path stays first so the parent can highlight manual SPA
    // navigation without changing the sorted route order shown in the panel.
    add(currentPath)
    const retainPrevious = currentPath !== '/' && candidatePaths.length < 2
    if (retainPrevious) {
      for (const path of previousPaths) add(path)
    }
    for (const path of candidatePaths) add(path)
    return paths
  }
  function publishPagesList(force = false) {
    try {
      const here = appRelativePath(location.pathname)
      const candidates = selectPageCandidates(
        collectPagesFrom(NAV_SELECTOR),
        collectPagesFrom('a[href]'),
        here,
      )
      const paths = mergeDiscoveredPages(discoveredPagePaths, here, candidates)
      discoveredPagePaths = paths
      const next = JSON.stringify(paths)
      if (!force && next === lastPagesListJson) return
      lastPagesListJson = next
      post({ source: 'mercury-bridge', type: 'pages-list', paths })
      publishPageSize()
    } catch {
      /* no-op */
    }
  }
  publishPageStateAfterParentPin = () => { publishPagesList(true); publishDynamicFeatures(true) }

  // Initial scan after the first paint, plus a delayed re-scan to catch
  // links that mount slightly after first paint (e.g. async-loaded nav).
  bridgeRequestAnimationFrame(() => {
    publishPagesList()
    publishDynamicFeatures()
    publishPageSize()
  })
  setTimeout(() => {
    publishPagesList()
    publishDynamicFeatures()
    publishPageSize()
  }, 1500)

  // Re-scan whenever the DOM changes — covers SPA route navigations
  // (Link clicks swap the page subtree in) and lazy-loaded nav menus.
  // Debounced so a burst of mutations only triggers one publish.
  let pagesScanTimer: ReturnType<typeof setTimeout> | null = null
  function schedulePagesScan() {
    if (pagesScanTimer != null) return
    pagesScanTimer = setTimeout(() => {
      pagesScanTimer = null
      publishPagesList()
      publishDynamicFeatures()
      publishPageSize()
    }, 250)
  }
  try {
    const obs = new MutationObserver(schedulePagesScan)
    obs.observe(document.documentElement, { childList: true, subtree: true })
  } catch {
    /* no-op */
  }
  // A stylesheet (or one it @imports) can finish loading without a DOM
  // mutation; re-check whether the expanded-viewport class fallbacks apply.
  document.addEventListener(
    'load',
    (event) => {
      const target = event.target
      if (!(target instanceof HTMLLinkElement || target instanceof HTMLStyleElement)) return
      scheduleVirtualViewportClassRulesSync()
    },
    true,
  )
  // History changes do not necessarily replace DOM children. Publish after
  // programmatic navigation and Back/Forward even when the rendered route
  // only changes text or attributes, so the parent keeps its active row in
  // sync with location.pathname.
  window.addEventListener('popstate', schedulePagesScan)
  try {
    const sizeObs = new ResizeObserver(() => schedulePageSizePublish())
    sizeObs.observe(document.documentElement)
    if (document.body) sizeObs.observe(document.body)
  } catch {
    /* no-op */
  }
  window.addEventListener('resize', () => schedulePageSizePublish())

  // Link-click forwarding: when the user clicks an internal <a> inside
  // the iframe, post the destination pathname to the parent so the
  // canvas can flash a highlight on the matching tile and connector.
  //
  // Expanded page tiles are pinned views: a click from the /about tile to
  // /pricing should flash the /pricing tile, not navigate the /about tile
  // away from the route shown in its label. The capture listener blocks
  // cross-route navigation only when a pinned route has been assigned.
  document.addEventListener(
    'click',
    (e) => {
      if (inspectEnabled) return
      try {
        let el = e.target as Node | null
        while (el && el !== document) {
          if ((el as HTMLElement).tagName === 'A') break
          el = (el as HTMLElement).parentElement
        }
        if (!el || (el as HTMLElement).tagName !== 'A') return
        const a = el as HTMLAnchorElement
        const raw = a.getAttribute('href')
        if (!raw) return
        if (raw.length === 0 || raw[0] === '#') return
        if (/^(mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) return
        const url = new URL(raw, location.href)
        if (url.origin !== location.origin) return
        const toPath = appRelativePath(url.pathname)
        if (isPinnedCrossRoute(toPath)) {
          e.preventDefault()
          e.stopImmediatePropagation()
          postLinkClick(toPath)
          return
        }
        postLinkClick(toPath)
      } catch {
        /* no-op */
      }
    },
    true,
  )
}

// Announce readiness every load so the parent can initiate the authenticated
// handshake, including after a bridge HMR refresh.
postBridgeReady()
postHmrRevisionSnapshot()

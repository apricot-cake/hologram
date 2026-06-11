/* @ds-bundle: {"format":3,"namespace":"CorpusDesignSystem_59d196","components":[{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Switch","sourcePath":"components/core/Switch.jsx"},{"name":"ImageTile","sourcePath":"components/data/ImageTile.jsx"},{"name":"PlatformBadge","sourcePath":"components/data/PlatformBadge.jsx"},{"name":"PostCard","sourcePath":"components/data/PostCard.jsx"},{"name":"Tag","sourcePath":"components/data/Tag.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Chip","sourcePath":"components/filters/Chip.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"ModeNav","sourcePath":"components/navigation/ModeNav.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/core/Button.jsx":"c6fa98ed7c0b","components/core/IconButton.jsx":"5f51ec620bc9","components/core/Switch.jsx":"3c91308a7aec","components/data/ImageTile.jsx":"ca9c563fe55a","components/data/PlatformBadge.jsx":"7fd3c0bcd5ab","components/data/PostCard.jsx":"d5043e073337","components/data/Tag.jsx":"ff566e27c468","components/feedback/Dialog.jsx":"d6e7c132c3e2","components/feedback/Toast.jsx":"73508f71cb60","components/filters/Chip.jsx":"cc9900726b3b","components/forms/Input.jsx":"93dcc0b5fae9","components/forms/Select.jsx":"b38a7f0386a6","components/navigation/ModeNav.jsx":"bb759d20abcb","components/navigation/Tabs.jsx":"9d0266da4d2e","ui_kits/corpus-app/App.jsx":"3a5112016c1e","ui_kits/corpus-app/ImageView.jsx":"0eeb0912c46a","ui_kits/corpus-app/PostView.jsx":"d17deb68b654","ui_kits/corpus-app/Settings.jsx":"638f24bccc39","ui_kits/corpus-app/Sidebar.jsx":"fdebbd70a3f8","ui_kits/corpus-app/data.js":"4a388152138b","ui_kits/corpus-app/icons.jsx":"6b694a832f5c"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.CorpusDesignSystem_59d196 = window.CorpusDesignSystem_59d196 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Corpus Button — the primary action control.
 * Variants map to the brand's restraint: `primary` is the only accent-filled
 * surface; everything else is neutral. Structure comes from borders, not shadow.
 */
function Button({
  children,
  variant = 'secondary',
  // primary | secondary | ghost | danger
  size = 'md',
  // sm | md | lg
  icon = null,
  // leading node (e.g. an <svg> / emoji)
  disabled = false,
  fullWidth = false,
  type = 'button',
  onClick,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: {
      height: 'var(--control-sm)',
      padding: '0 10px',
      font: 'var(--text-base)',
      gap: '6px'
    },
    md: {
      height: 'var(--control-md)',
      padding: '0 14px',
      font: 'var(--text-md)',
      gap: '7px'
    },
    lg: {
      height: 'var(--control-lg)',
      padding: '0 18px',
      font: 'var(--text-md)',
      gap: '8px'
    }
  }[size];
  const variants = {
    primary: {
      background: 'var(--accent)',
      color: 'var(--accent-fg)',
      border: '1px solid var(--accent)'
    },
    secondary: {
      background: 'var(--surface)',
      color: 'var(--text-strong)',
      border: '1px solid var(--border-strong)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text)',
      border: '1px solid transparent'
    },
    danger: {
      background: 'var(--surface)',
      color: 'var(--danger)',
      border: '1px solid color-mix(in oklch, var(--danger) 40%, var(--border))'
    }
  }[variant];
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sizes.gap,
    height: sizes.height,
    padding: sizes.padding,
    width: fullWidth ? '100%' : 'auto',
    fontFamily: 'var(--font-sans)',
    fontSize: sizes.font,
    fontWeight: 'var(--weight-medium)',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    borderRadius: 'var(--radius-sm)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out), color var(--dur-base)',
    userSelect: 'none',
    ...variants,
    ...style
  };
  const hoverBg = {
    primary: 'var(--accent-hover)',
    secondary: 'var(--hover)',
    ghost: 'var(--hover)',
    danger: 'var(--danger-bg)'
  }[variant];
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    style: base,
    onMouseEnter: e => {
      if (!disabled) {
        e.currentTarget.style.background = hoverBg;
        if (variant === 'primary') e.currentTarget.style.borderColor = 'var(--accent-hover)';
      }
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = variants.background;
      e.currentTarget.style.borderColor = variants.border.split(' ').slice(2).join(' ');
    }
  }, rest), icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      fontSize: '1.05em'
    }
  }, icon), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * IconButton — a square, icon-only control. Used for tile/row hover actions
 * (folder, info, open, delete) and toolbar affordances.
 * `tone="onMedia"` renders the dark translucent pill used over imagery;
 * `tone="surface"` is the bordered chrome variant.
 */
function IconButton({
  icon,
  label,
  // accessible label (title + aria-label)
  tone = 'surface',
  // surface | onMedia | ghost
  size = 'md',
  // sm | md | lg
  danger = false,
  active = false,
  onClick,
  style = {},
  ...rest
}) {
  const dim = {
    sm: 24,
    md: 28,
    lg: 34
  }[size];
  const tones = {
    surface: {
      background: active ? 'var(--accent)' : 'var(--surface)',
      color: active ? 'var(--accent-fg)' : 'var(--text-muted)',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`
    },
    onMedia: {
      background: active ? 'var(--accent)' : 'rgba(8,10,14,0.62)',
      color: '#fff',
      border: '1px solid transparent'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-muted)',
      border: '1px solid transparent'
    }
  }[tone];
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: dim,
    height: dim,
    flexShrink: 0,
    padding: 0,
    fontSize: size === 'lg' ? 14 : 12,
    lineHeight: 1,
    borderRadius: tone === 'onMedia' ? 'var(--radius-xs)' : 'var(--radius-sm)',
    cursor: 'pointer',
    transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast), border-color var(--dur-fast)',
    ...tones,
    ...style
  };
  const hover = danger ? tone === 'onMedia' ? '#c0392b' : 'var(--danger-bg)' : tone === 'onMedia' ? 'var(--accent)' : 'var(--hover)';
  const hoverColor = danger && tone !== 'onMedia' ? 'var(--danger)' : tone === 'onMedia' ? '#fff' : 'var(--accent)';
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    title: label,
    "aria-label": label,
    onClick: onClick,
    style: base,
    onMouseEnter: e => {
      e.currentTarget.style.background = hover;
      e.currentTarget.style.color = hoverColor;
      if (tone === 'surface') e.currentTarget.style.borderColor = danger ? 'var(--danger)' : 'var(--accent)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = tones.background;
      e.currentTarget.style.color = tones.color;
      if (tone === 'surface') e.currentTarget.style.borderColor = active ? 'var(--accent)' : 'var(--border-strong)';
    }
  }, rest), icon);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Switch — a compact toggle. Corpus uses it for the theme switch and binary
 * settings. Accent-filled when on; neutral track when off. No bounce.
 */
function Switch({
  checked = false,
  onChange,
  disabled = false,
  size = 'md',
  // sm | md
  label = null,
  style = {},
  ...rest
}) {
  const dims = size === 'sm' ? {
    w: 30,
    h: 18,
    k: 12
  } : {
    w: 38,
    h: 22,
    k: 16
  };
  const track = {
    position: 'relative',
    width: dims.w,
    height: dims.h,
    flexShrink: 0,
    borderRadius: 'var(--radius-pill)',
    background: checked ? 'var(--accent)' : 'var(--surface-3)',
    border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--dur-base) var(--ease-out), border-color var(--dur-base)',
    padding: 0
  };
  const knob = {
    position: 'absolute',
    top: '50%',
    left: checked ? `calc(100% - ${dims.k + 2}px)` : '2px',
    transform: 'translateY(-50%)',
    width: dims.k,
    height: dims.k,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: 'var(--shadow-xs)',
    transition: 'left var(--dur-base) var(--ease-out)'
  };
  const btn = /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    role: "switch",
    "aria-checked": checked,
    disabled: disabled,
    onClick: () => !disabled && onChange && onChange(!checked),
    style: track
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: knob
  }));
  if (!label) return btn;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-5)',
      cursor: disabled ? 'default' : 'pointer',
      fontSize: 'var(--text-base)',
      color: 'var(--text)',
      ...style
    }
  }, btn, /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Switch.jsx", error: String((e && e.message) || e) }); }

// components/data/ImageTile.jsx
try { (() => {
/**
 * ImageTile — the square media tile from image-view. Shows the image with a
 * bottom scrim carrying author + likes, an ○ select ring (top-left), hover
 * actions (📁 / ℹ / ↗ / 🗑) top-right, an optional ×N group badge, and a
 * play/GIF overlay for motion. Selected tiles get the inset accent outline.
 */
function ImageTile({
  src,
  author = '',
  likes = null,
  // number
  count = 1,
  // ×N group size
  media = 'image',
  // image | video | gif
  selected = false,
  inFolder = false,
  onOpen,
  onFolder,
  onDetail,
  onDelete,
  onSelect,
  style = {}
}) {
  const [hover, setHover] = React.useState(false);
  const fmt = n => n == null ? null : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
  const tile = {
    position: 'relative',
    aspectRatio: '1',
    width: '100%',
    background: 'var(--surface-3)',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    outline: selected ? '2px solid var(--accent)' : 'none',
    outlineOffset: '-3px',
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
    cursor: 'pointer',
    boxShadow: hover ? 'var(--shadow-md)' : 'none',
    transform: hover ? 'scale(1.015)' : 'none',
    transition: 'transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast), border-color var(--dur-fast)',
    ...style
  };
  return /*#__PURE__*/React.createElement("div", {
    style: tile,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onClick: onOpen
  }, /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: "",
    loading: "lazy",
    decoding: "async",
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block'
    }
  }), media !== 'image' && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 42,
      height: 42,
      borderRadius: '50%',
      background: 'rgba(8,10,14,0.55)',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: media === 'gif' ? 12 : 15,
      fontWeight: 600,
      paddingLeft: media === 'video' ? 3 : 0
    }
  }, media === 'gif' ? 'GIF' : '▶')), count > 1 && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 6,
      right: 6,
      zIndex: 2,
      padding: '2px 6px',
      borderRadius: 'var(--radius-xs)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-2xs)',
      fontWeight: 600,
      background: 'rgba(8,10,14,0.8)',
      color: '#fff',
      opacity: hover ? 0 : 1,
      transition: 'opacity var(--dur-fast)'
    }
  }, "\xD7", count), /*#__PURE__*/React.createElement("span", {
    onClick: e => {
      e.stopPropagation();
      onSelect && onSelect();
    },
    style: {
      position: 'absolute',
      top: 6,
      left: 6,
      zIndex: 5,
      width: 22,
      height: 22,
      borderRadius: '50%',
      background: selected ? 'var(--accent)' : 'transparent',
      border: `2px solid ${selected ? '#fff' : '#fff'}`,
      boxShadow: '0 0 2px 1px rgba(0,0,0,0.45)',
      display: hover || selected ? 'flex' : 'none',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer'
    }
  }, selected && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 5,
      height: 9,
      marginTop: -1,
      border: 'solid #fff',
      borderWidth: '0 2px 2px 0',
      transform: 'rotate(45deg)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 6,
      right: 6,
      zIndex: 3,
      display: 'flex',
      gap: 4,
      opacity: hover ? 1 : 0,
      transition: 'opacity var(--dur-fast)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    tone: "onMedia",
    size: "sm",
    icon: "\uD83D\uDCC1",
    label: "\u30D5\u30A9\u30EB\u30C0",
    active: inFolder,
    onClick: e => {
      e.stopPropagation();
      onFolder && onFolder();
    }
  }), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    tone: "onMedia",
    size: "sm",
    icon: "\u2139",
    label: "\u8A73\u7D30",
    onClick: e => {
      e.stopPropagation();
      onDetail && onDetail();
    }
  }), onOpen && /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    tone: "onMedia",
    size: "sm",
    icon: "\u2197",
    label: "\u5143\u6295\u7A3F",
    onClick: e => {
      e.stopPropagation();
      onOpen && onOpen();
    }
  }), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    tone: "onMedia",
    size: "sm",
    icon: "\uD83D\uDDD1",
    label: "\u524A\u9664",
    danger: true,
    onClick: e => {
      e.stopPropagation();
      onDelete && onDelete();
    }
  })), (author || likes != null) && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: '14px 8px 7px',
      background: 'var(--scrim-grad)',
      color: '#fff',
      fontSize: 'var(--text-xs)',
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#eee',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, author), likes != null && /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      flexShrink: 0
    }
  }, "\u2764 ", fmt(likes))));
}
Object.assign(__ds_scope, { ImageTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ImageTile.jsx", error: String((e && e.message) || e) }); }

// components/data/PlatformBadge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const BRAND = {
  x: {
    bg: 'var(--brand-x)',
    fg: '#fff'
  },
  bluesky: {
    bg: 'var(--brand-bluesky)',
    fg: '#fff'
  },
  misskey: {
    bg: 'var(--brand-misskey)',
    fg: '#1a2e05'
  },
  mastodon: {
    bg: 'var(--brand-mastodon)',
    fg: '#fff'
  },
  pixiv: {
    bg: 'var(--brand-pixiv)',
    fg: '#fff'
  }
};

/**
 * PlatformBadge — the small brand-colored capsule identifying a post's source.
 * The only place platform brand colors appear. In dark theme the X badge
 * inverts to light (via --brand-x).
 */
function PlatformBadge({
  platform = 'x',
  style = {},
  ...rest
}) {
  const key = String(platform).toLowerCase();
  const c = BRAND[key] || {
    bg: 'var(--text-muted)',
    fg: '#fff'
  };
  // dark-theme X badge: light bg, dark text. Detect via CSS var fallback handled
  // by --brand-x flip; force readable text for X specifically.
  const isX = key === 'x';
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 7px',
      borderRadius: 'var(--radius-xs)',
      background: c.bg,
      color: isX ? 'var(--surface)' : c.fg,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-2xs)',
      fontWeight: 'var(--weight-semibold)',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      lineHeight: 1.4,
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), key === 'pixiv' ? 'pixiv' : key);
}
Object.assign(__ds_scope, { PlatformBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/PlatformBadge.jsx", error: String((e && e.message) || e) }); }

// components/data/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Tag — a small neutral metadata pill shown on cards and in detail views
 * (user-applied tags). Quieter than Chip: not interactive by default.
 * `tone="flag-type"` / `"flag-media"` render the post-type / media flags.
 */
function Tag({
  children,
  tone = 'default',
  style = {},
  ...rest
}) {
  const tones = {
    default: {
      background: 'var(--surface-3)',
      color: 'var(--text-muted)'
    },
    'flag-type': {
      background: 'color-mix(in oklch, var(--accent) 12%, var(--surface))',
      color: 'var(--accent-subtle-fg)'
    },
    'flag-media': {
      background: 'var(--surface-3)',
      color: 'var(--text-muted)'
    }
  }[tone];
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '1px 8px',
      borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-2xs)',
      lineHeight: 1.6,
      whiteSpace: 'nowrap',
      ...tones,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Tag.jsx", error: String((e && e.message) || e) }); }

// components/data/PostCard.jsx
try { (() => {
/**
 * PostCard — the information-dense saved-post card. Surfaces, at a glance:
 * platform badge · author + handle · post-type/media flags · body text ·
 * engagement (likes/reposts/replies) · date · tags · the 📁 one-click folder
 * action and hover actions (edit / open / delete).
 *
 * Two layouts: `grid` (image on top) and `list` (thumbnail left, text-first).
 */
function PostCard({
  post = {},
  layout = 'grid',
  // grid | list
  selected = false,
  selectable = false,
  inFolder = false,
  onOpen,
  onFolder,
  onDelete,
  style = {}
}) {
  const {
    platform = 'x',
    displayName = '',
    screenName = '',
    text = '',
    image = null,
    likes,
    reposts,
    replies,
    date = '',
    tags = [],
    isThread,
    isReply,
    isQuote,
    mediaType
  } = post;
  const [hover, setHover] = React.useState(false);
  const isList = layout === 'list';
  const fmt = n => n == null ? null : n.toLocaleString('en-US');
  const stats = [likes != null && `❤ ${fmt(likes)}`, reposts != null && `🔁 ${fmt(reposts)}`, replies != null && `💬 ${fmt(replies)}`].filter(Boolean);
  const flags = [isThread && 'セルフリプ', isReply && 'リプライ', isQuote && '引用'].filter(Boolean);
  const mediaLabel = {
    image: '画像',
    video: '動画',
    gif: 'GIF'
  }[mediaType];
  const card = {
    position: 'relative',
    display: 'flex',
    flexDirection: isList ? 'row' : 'column',
    alignItems: 'stretch',
    background: 'var(--surface)',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    outline: selected ? '2px solid var(--accent)' : 'none',
    outlineOffset: '-2px',
    borderRadius: isList ? 'var(--radius-sm)' : 'var(--radius-md)',
    overflow: 'hidden',
    cursor: 'pointer',
    boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
    transition: 'box-shadow var(--dur-base) var(--ease-out), border-color var(--dur-base)',
    ...style
  };
  const img = image && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      flexShrink: 0,
      width: isList ? 92 : '100%',
      height: isList ? 'auto' : 'auto',
      background: 'var(--surface-3)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: image,
    alt: "",
    loading: "lazy",
    style: {
      display: 'block',
      width: '100%',
      height: isList ? '100%' : 'auto',
      maxHeight: isList ? 116 : 280,
      objectFit: 'cover'
    }
  }));
  const actions = /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 8,
      right: 8,
      zIndex: 2,
      display: 'flex',
      gap: 6,
      opacity: hover ? 1 : 0,
      transition: 'opacity var(--dur-fast)',
      ...(isList ? {
        top: '50%',
        transform: 'translateY(-50%)'
      } : {})
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    tone: "onMedia",
    size: "md",
    icon: "\uD83D\uDCC1",
    label: "\u30D5\u30A9\u30EB\u30C0\u306B\u8FFD\u52A0",
    active: inFolder,
    onClick: e => {
      e.stopPropagation();
      onFolder && onFolder();
    }
  }), onOpen && /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    tone: "onMedia",
    size: "md",
    icon: "\u2197",
    label: "\u6295\u7A3F\u3092\u958B\u304F",
    onClick: e => {
      e.stopPropagation();
      onOpen && onOpen();
    }
  }), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    tone: "onMedia",
    size: "md",
    icon: "\uD83D\uDDD1",
    label: "\u524A\u9664",
    danger: true,
    onClick: e => {
      e.stopPropagation();
      onDelete && onDelete();
    }
  }));
  return /*#__PURE__*/React.createElement("div", {
    style: card,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onClick: onOpen
  }, selectable && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 8,
      left: 8,
      zIndex: 3,
      width: 22,
      height: 22,
      borderRadius: '50%',
      border: `2px solid ${selected ? 'var(--accent)' : '#fff'}`,
      background: selected ? 'var(--accent)' : 'rgba(255,255,255,0.85)',
      boxShadow: '0 0 2px 1px rgba(0,0,0,0.3)',
      display: hover || selected ? 'flex' : 'none',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, selected && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 5,
      height: 9,
      marginTop: -1,
      border: 'solid #fff',
      borderWidth: '0 2px 2px 0',
      transform: 'rotate(45deg)'
    }
  })), actions, img, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: isList ? 3 : 5,
      padding: isList ? '9px 14px' : '12px',
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 'var(--text-base)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--text-strong)',
      minWidth: 0,
      order: isList ? 1 : 0
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.PlatformBadge, {
    platform: platform
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, displayName), screenName && /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--text-subtle)',
      fontWeight: 400,
      fontSize: 'var(--text-sm)'
    }
  }, "@", screenName)), !isList && (flags.length || mediaLabel) ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 4
    }
  }, flags.map(f => /*#__PURE__*/React.createElement(__ds_scope.Tag, {
    key: f,
    tone: "flag-type"
  }, f)), mediaLabel && /*#__PURE__*/React.createElement(__ds_scope.Tag, {
    tone: "flag-media"
  }, mediaLabel)) : null, text && /*#__PURE__*/React.createElement("div", {
    style: {
      order: isList ? 0 : 0,
      fontSize: isList ? 'var(--text-md)' : 'var(--text-base)',
      lineHeight: 'var(--leading-snug)',
      color: isList ? 'var(--text-strong)' : 'var(--text)',
      display: '-webkit-box',
      WebkitLineClamp: isList ? 2 : 3,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden'
    }
  }, text), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 12,
      order: isList ? 2 : 0,
      flexWrap: 'wrap'
    }
  }, stats.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      display: 'flex',
      gap: 12,
      fontSize: 'var(--text-sm)',
      color: 'var(--text-muted)'
    }
  }, stats.map(s => /*#__PURE__*/React.createElement("span", {
    key: s
  }, s))), date && /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--text-subtle)',
      marginLeft: isList ? 'auto' : 0
    }
  }, date)), !isList && tags.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 3,
      marginTop: 1
    }
  }, tags.map(t => /*#__PURE__*/React.createElement(__ds_scope.Tag, {
    key: t
  }, t)))));
}
Object.assign(__ds_scope, { PostCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/PostCard.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
/**
 * Dialog — centered modal over a dim scrim. Used for the delete confirmation,
 * folder-management, and tag-edit modals. Header (title + ×), body (children),
 * and an optional footer for actions. Click the scrim to dismiss.
 */
function Dialog({
  open = false,
  title = '',
  onClose,
  children,
  footer = null,
  width = 420,
  style = {}
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 'var(--z-modal)',
      background: 'var(--overlay)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-9)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: 'var(--surface)',
      color: 'var(--text)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-lg)',
      width: '100%',
      maxWidth: width,
      maxHeight: '85vh',
      overflowY: 'auto',
      ...style
    }
  }, (title || onClose) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      padding: '14px 16px',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 'var(--text-lg)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--text-strong)'
    }
  }, title), onClose && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClose,
    "aria-label": "\u9589\u3058\u308B",
    style: {
      border: 'none',
      background: 'none',
      color: 'var(--text-muted)',
      fontSize: 18,
      lineHeight: 1,
      cursor: 'pointer',
      padding: 2
    }
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px'
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      padding: '12px 16px',
      borderTop: '1px solid var(--border-subtle)'
    }
  }, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
/**
 * Toast — the transient bottom-center pill ("フォルダに追加しました"). Dark,
 * rounded, fades + lifts in. Controlled via `show`; auto-dismiss handled by
 * the caller. Mirrors the app's .iv-toast.
 */
function Toast({
  children,
  show = false,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "status",
    style: {
      position: 'fixed',
      left: '50%',
      bottom: 30,
      transform: `translateX(-50%) translateY(${show ? '0' : '8px'})`,
      background: 'rgba(8,10,14,0.88)',
      color: '#fff',
      padding: '9px 18px',
      borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-base)',
      boxShadow: 'var(--shadow-lg)',
      opacity: show ? 1 : 0,
      pointerEvents: 'none',
      transition: 'opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)',
      zIndex: 'var(--z-toast)',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/filters/Chip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Chip — the pill filter / tag control. A brand-core component: the sidebar
 * filters, tag chips, and active-filter bar are all Chips.
 * - default: neutral pill, hover lifts border+text to accent
 * - active: solid accent fill
 * - removable: shows an × and calls onRemove
 * - category: faint per-facet tint for active-filter pills (platform/date/…)
 */
function Chip({
  children,
  active = false,
  count = null,
  leading = null,
  // e.g. ★ for default folder
  removable = false,
  onRemove,
  onClick,
  category = null,
  // platform | postType | date | engagement | tag | media | user
  size = 'md',
  // sm | md
  style = {},
  ...rest
}) {
  const pad = size === 'sm' ? '2px 9px' : '4px 11px';
  const font = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)';

  // Category tints (used on active-filter pills). Subtle, theme-aware.
  const tint = category ? {
    background: 'var(--accent-subtle)',
    color: 'var(--accent-subtle-fg)',
    border: '1px solid var(--accent-border)'
  } : null;
  const base = active ? {
    background: 'var(--accent)',
    color: 'var(--accent-fg)',
    border: '1px solid var(--accent)'
  } : tint || {
    background: 'var(--surface-2)',
    color: 'var(--text-muted)',
    border: '1px solid var(--border)'
  };
  const wrap = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: pad,
    fontFamily: 'var(--font-sans)',
    fontSize: font,
    fontWeight: 'var(--weight-medium)',
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'background var(--dur-base) var(--ease-out), border-color var(--dur-base), color var(--dur-base)',
    ...base,
    ...style
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onClick: onClick,
    style: wrap,
    onMouseEnter: e => {
      if (!active && !category) {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.color = 'var(--accent)';
      } else if (category || active) {
        e.currentTarget.style.opacity = '0.82';
      }
    },
    onMouseLeave: e => {
      e.currentTarget.style.opacity = '1';
      if (!active && !category) {
        e.currentTarget.style.borderColor = base.border.split(' ').slice(2).join(' ');
        e.currentTarget.style.color = base.color;
      }
    }
  }, rest), leading && /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: 0.85
    }
  }, leading), children, count != null && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontVariantNumeric: 'tabular-nums',
      opacity: 0.6,
      fontSize: '0.92em'
    }
  }, count), removable && /*#__PURE__*/React.createElement("span", {
    onClick: e => {
      e.stopPropagation();
      onRemove && onRemove();
    },
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      marginLeft: '1px',
      marginRight: '-2px',
      fontSize: '1.05em',
      lineHeight: 1,
      opacity: 0.7
    }
  }, "\xD7"));
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/filters/Chip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Input — text / search / number field. The search variant adds a leading
 * Lucide-style icon slot. Focus shows the indigo ring + accent border.
 * `hasValue` lights the border to signal an active filter (matches the app's
 * `.has-value` affordance).
 */
function Input({
  value,
  onChange,
  placeholder = '',
  type = 'text',
  icon = null,
  // leading node; renders a search-style field
  size = 'md',
  // sm | md | lg
  hasValue = false,
  disabled = false,
  fullWidth = true,
  style = {},
  ...rest
}) {
  const h = {
    sm: 'var(--control-sm)',
    md: 'var(--control-md)',
    lg: 'var(--control-lg)'
  }[size];
  const [focus, setFocus] = React.useState(false);
  const accent = focus || hasValue;
  const wrap = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    height: h,
    width: fullWidth ? '100%' : 'auto',
    padding: icon ? '0 11px' : '0 11px',
    background: 'var(--surface)',
    border: `1px solid ${accent ? 'var(--accent)' : 'var(--border-strong)'}`,
    borderRadius: 'var(--radius-sm)',
    boxShadow: focus ? 'var(--ring)' : hasValue ? '0 0 0 1px var(--accent)' : 'none',
    transition: 'border-color var(--dur-base), box-shadow var(--dur-base)',
    opacity: disabled ? 0.5 : 1,
    ...style
  };
  const input = {
    flex: 1,
    minWidth: 0,
    height: '100%',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: 'var(--text-strong)',
    fontFamily: type === 'number' ? 'var(--font-mono)' : 'var(--font-sans)',
    fontSize: 'var(--text-md)'
  };
  return /*#__PURE__*/React.createElement("span", {
    style: wrap
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      color: 'var(--text-subtle)',
      fontSize: 14
    }
  }, icon), /*#__PURE__*/React.createElement("input", _extends({
    type: type,
    value: value,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    style: input,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false)
  }, rest)));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Select — native dropdown styled to match Input. Keeps the OS picker (good
 * for an Electron tool) while wearing the brand's border/radius and a
 * Geist caret. Used for sort order, date field, engagement type.
 */
function Select({
  value,
  onChange,
  children,
  size = 'md',
  // sm | md | lg
  fullWidth = true,
  disabled = false,
  style = {},
  ...rest
}) {
  const h = {
    sm: 'var(--control-sm)',
    md: 'var(--control-md)',
    lg: 'var(--control-lg)'
  }[size];
  const [focus, setFocus] = React.useState(false);
  const caret = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236c7280' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>";
  const base = {
    height: h,
    width: fullWidth ? '100%' : 'auto',
    padding: '0 30px 0 11px',
    appearance: 'none',
    WebkitAppearance: 'none',
    background: `var(--surface) url("${caret}") no-repeat right 10px center`,
    color: 'var(--text-strong)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-base)',
    border: `1px solid ${focus ? 'var(--accent)' : 'var(--border-strong)'}`,
    borderRadius: 'var(--radius-sm)',
    cursor: disabled ? 'default' : 'pointer',
    boxShadow: focus ? 'var(--ring)' : 'none',
    outline: 'none',
    opacity: disabled ? 0.5 : 1,
    transition: 'border-color var(--dur-base), box-shadow var(--dur-base)',
    ...style
  };
  return /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    onChange: onChange,
    disabled: disabled,
    style: base,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false)
  }, rest), children);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/navigation/ModeNav.jsx
try { (() => {
/**
 * ModeNav — the top-level mode switcher (投稿閲覧 / 画像閲覧). Always visible,
 * sticky across modes. Each item is an icon + label; the active item gets the
 * accent-subtle wash + accent text/icon. Designed to sit at the top of the
 * sidebar.
 */
function ModeNav({
  items = [],
  value,
  onChange,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      ...style
    }
  }, items.map(it => {
    const active = it.id === value;
    return /*#__PURE__*/React.createElement("button", {
      key: it.id,
      type: "button",
      onClick: () => onChange && onChange(it.id),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        padding: '8px 10px',
        borderRadius: 'var(--radius-md)',
        background: active ? 'var(--accent-subtle)' : 'transparent',
        color: active ? 'var(--accent-subtle-fg)' : 'var(--text)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-md)',
        fontWeight: 'var(--weight-medium)',
        transition: 'background var(--dur-base), color var(--dur-base)'
      },
      onMouseEnter: e => {
        if (!active) e.currentTarget.style.background = 'var(--hover)';
      },
      onMouseLeave: e => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        width: 18,
        height: 18,
        flexShrink: 0,
        color: active ? 'var(--accent)' : 'var(--text-muted)'
      }
    }, it.icon), /*#__PURE__*/React.createElement("span", null, it.label));
  }));
}
Object.assign(__ds_scope, { ModeNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/ModeNav.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
/**
 * Tabs — the in-sidebar tab strip (投稿 / ハッシュタグ / ユーザー / 設定).
 * Vertical by default (sidebar); pass orientation="horizontal" for a top strip.
 * Active tab gets accent text + a leading rail (vertical) or underline (horizontal).
 */
function Tabs({
  items = [],
  // [{ id, label }]
  value,
  onChange,
  orientation = 'vertical',
  style = {}
}) {
  const vertical = orientation === 'vertical';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: vertical ? 'column' : 'row',
      gap: vertical ? 2 : 4,
      borderBottom: vertical ? 'none' : '1px solid var(--border)',
      ...style
    }
  }, items.map(it => {
    const active = it.id === value;
    const base = {
      appearance: 'none',
      background: active ? 'var(--accent-subtle)' : 'transparent',
      border: 'none',
      cursor: 'pointer',
      textAlign: 'left',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-md)',
      fontWeight: 'var(--weight-medium)',
      color: active ? 'var(--accent-subtle-fg)' : 'var(--text-muted)',
      transition: 'color var(--dur-base), background var(--dur-base), border-color var(--dur-base)',
      ...(vertical ? {
        padding: '8px 12px',
        borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0'
      } : {
        padding: '9px 4px',
        marginBottom: -1,
        borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        background: 'transparent'
      })
    };
    return /*#__PURE__*/React.createElement("button", {
      key: it.id,
      type: "button",
      style: base,
      onClick: () => onChange && onChange(it.id),
      onMouseEnter: e => {
        if (!active) e.currentTarget.style.color = 'var(--text-strong)';
      },
      onMouseLeave: e => {
        if (!active) e.currentTarget.style.color = 'var(--text-muted)';
      }
    }, it.label);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/corpus-app/App.jsx
try { (() => {
/* global React, Sidebar, PostView, ImageView, Settings */
const {
  Chip,
  Dialog,
  Toast,
  Button,
  Input
} = window.CorpusDesignSystem_59d196;
const {
  POSTS,
  TAGS,
  FOLDERS
} = window.CorpusData;
function HashtagsPanel({
  query
}) {
  const list = TAGS.filter(t => t.label.includes(query));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px 28px 40px',
      maxWidth: 900
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 'var(--text-2xl)',
      fontWeight: 600,
      color: 'var(--text-strong)',
      marginBottom: 18
    }
  }, "\u30CF\u30C3\u30B7\u30E5\u30BF\u30B0"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8
    }
  }, list.map(t => /*#__PURE__*/React.createElement("span", {
    key: t.label,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      padding: '7px 13px',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--surface)',
      color: 'var(--accent)',
      fontSize: 13,
      cursor: 'pointer'
    }
  }, "#", t.label, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 11,
      color: 'var(--text-subtle)',
      background: 'var(--surface-2)',
      padding: '1px 7px',
      borderRadius: 'var(--radius-pill)'
    }
  }, t.count)))));
}
function UsersPanel({
  query
}) {
  const users = [...new Map(POSTS.map(p => [p.screenName, p])).values()].filter(p => p.displayName.includes(query) || p.screenName.includes(query));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px 28px 40px',
      maxWidth: 900
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 'var(--text-2xl)',
      fontWeight: 600,
      color: 'var(--text-strong)',
      marginBottom: 18
    }
  }, "\u30E6\u30FC\u30B6\u30FC"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, users.map(u => /*#__PURE__*/React.createElement("button", {
    key: u.screenName,
    type: "button",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '9px 13px',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--surface)',
      cursor: 'pointer',
      textAlign: 'left',
      font: 'inherit'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, u.displayName), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--text-subtle)',
      fontSize: 13
    }
  }, "@", u.screenName), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      marginLeft: 'auto',
      fontSize: 12,
      color: 'var(--text-muted)',
      background: 'var(--surface-2)',
      borderRadius: 'var(--radius-pill)',
      padding: '2px 10px'
    }
  }, POSTS.filter(p => p.screenName === u.screenName).length, " \u4EF6")))));
}
function FolderModal({
  open,
  onClose,
  onToast
}) {
  const [name, setName] = React.useState('');
  return /*#__PURE__*/React.createElement(Dialog, {
    open: open,
    title: "\u30D5\u30A9\u30EB\u30C0\u3092\u7BA1\u7406",
    onClose: onClose,
    width: 440
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "\u65B0\u3057\u3044\u30D5\u30A9\u30EB\u30C0\u540D",
    value: name,
    onChange: e => setName(e.target.value)
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: () => {
      setName('');
      onToast('フォルダを作成しました');
    }
  }, "\u4F5C\u6210")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, FOLDERS.map(f => /*#__PURE__*/React.createElement("div", {
    key: f.id,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 4px',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: f.default ? 'var(--accent)' : 'var(--text-subtle)',
      cursor: 'pointer'
    },
    title: "\u30C7\u30D5\u30A9\u30EB\u30C8\u306B\u8A2D\u5B9A"
  }, "\u2605"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      color: 'var(--text)'
    }
  }, f.label), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 11,
      color: 'var(--text-muted)'
    }
  }, f.count), /*#__PURE__*/React.createElement("button", {
    type: "button",
    title: "\u524A\u9664",
    style: {
      border: 'none',
      background: 'none',
      color: 'var(--text-subtle)',
      cursor: 'pointer',
      fontSize: 14
    }
  }, "\uD83D\uDDD1")))), /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 12,
      color: 'var(--text-subtle)',
      fontSize: 11
    }
  }, "\u2605 = \uD83D\uDCC1 \u30EF\u30F3\u30AF\u30EA\u30C3\u30AF\u3067\u8FFD\u52A0\u3055\u308C\u308B\u5148\uFF08\u30C7\u30D5\u30A9\u30EB\u30C8\uFF09"));
}
function DetailModal({
  post,
  onClose
}) {
  if (!post) return null;
  const row = (k, v) => v != null && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      padding: '5px 0',
      borderBottom: '1px solid var(--border-subtle)',
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      flex: '0 0 76px'
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      color: 'var(--text)',
      wordBreak: 'break-word'
    }
  }, v));
  return /*#__PURE__*/React.createElement(Dialog, {
    open: true,
    title: post.displayName + ' — 詳細',
    onClose: onClose,
    width: 420
  }, /*#__PURE__*/React.createElement("img", {
    src: post.image,
    alt: "",
    style: {
      width: '100%',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border)',
      marginBottom: 12,
      display: 'block'
    }
  }), row('作者', `${post.displayName} @${post.screenName}`), row('プラットフォーム', post.platform), row('いいね', post.likes?.toLocaleString('en-US')), row('投稿日', post.date), row('タグ', post.tags?.join('、')));
}
function App() {
  const [theme, setTheme] = React.useState('light');
  const [mode, setMode] = React.useState('post');
  const [tab, setTab] = React.useState('posts');
  const [view, setView] = React.useState('grid');
  const [sort, setSort] = React.useState('date-desc');
  const [tile, setTile] = React.useState(180);
  const [query, setQuery] = React.useState('');
  const [platforms, setPlatforms] = React.useState(new Set());
  const [tags, setTags] = React.useState(new Set());
  const [folder, setFolder] = React.useState(null);
  const [selected, setSelected] = React.useState(new Set());
  const [confirmDelete, setConfirmDelete] = React.useState(true);
  const [folderModal, setFolderModal] = React.useState(false);
  const [detail, setDetail] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const toastTimer = React.useRef();
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const onToast = msg => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };
  const togglePlatform = id => setPlatforms(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleTag = l => setTags(s => {
    const n = new Set(s);
    n.has(l) ? n.delete(l) : n.add(l);
    return n;
  });
  const toggleSelect = id => setSelected(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  // filter + sort
  let posts = POSTS.filter(p => {
    if (platforms.size && !platforms.has(p.platform)) return false;
    if (tags.size && !p.tags?.some(t => tags.has(t))) return false;
    if (folder && !p.folder) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!`${p.displayName} ${p.screenName} ${p.text} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  posts = [...posts].sort((a, b) => {
    if (sort === 'likes-desc') return (b.likes || 0) - (a.likes || 0);
    if (sort === 'date-asc') return a.date.localeCompare(b.date);
    return b.date.localeCompare(a.date);
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      minHeight: '100vh',
      background: 'var(--bg)'
    }
  }, /*#__PURE__*/React.createElement(Sidebar, {
    key: mode + '|' + tab,
    mode: mode,
    setMode: setMode,
    tab: tab,
    setTab: setTab,
    theme: theme,
    setTheme: setTheme,
    query: query,
    setQuery: setQuery,
    platforms: platforms,
    togglePlatform: togglePlatform,
    tags: tags,
    toggleTag: toggleTag,
    folder: folder,
    setFolder: setFolder,
    onManageFolders: () => setFolderModal(true)
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, mode === 'image' ? /*#__PURE__*/React.createElement(ImageView, {
    posts: posts,
    tile: tile,
    setTile: setTile,
    selected: selected,
    toggleSelect: toggleSelect,
    onToast: onToast,
    onDetail: setDetail
  }) : tab === 'posts' ? /*#__PURE__*/React.createElement(PostView, {
    posts: posts,
    view: view,
    setView: setView,
    sort: sort,
    setSort: setSort,
    selected: selected,
    toggleSelect: toggleSelect,
    onToast: onToast
  }) : tab === 'tags' ? /*#__PURE__*/React.createElement(HashtagsPanel, {
    query: query
  }) : tab === 'users' ? /*#__PURE__*/React.createElement(UsersPanel, {
    query: query
  }) : /*#__PURE__*/React.createElement(Settings, {
    theme: theme,
    setTheme: setTheme,
    confirmDelete: confirmDelete,
    setConfirmDelete: setConfirmDelete,
    onToast: onToast
  })), /*#__PURE__*/React.createElement(FolderModal, {
    open: folderModal,
    onClose: () => setFolderModal(false),
    onToast: onToast
  }), /*#__PURE__*/React.createElement(DetailModal, {
    post: detail,
    onClose: () => setDetail(null)
  }), /*#__PURE__*/React.createElement(Toast, {
    show: !!toast
  }, toast));
}
window.CorpusApp = App;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/corpus-app/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/corpus-app/ImageView.jsx
try { (() => {
/* global React */
const {
  ImageTile
} = window.CorpusDesignSystem_59d196;
function ImageView({
  posts,
  tile,
  setTile,
  selected,
  toggleSelect,
  onToast,
  onDetail
}) {
  const selCount = selected.size;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 28px 40px',
      height: '100vh',
      overflowY: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'sticky',
      top: -16,
      zIndex: 10,
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      margin: '-16px -28px 14px',
      padding: '16px 28px 12px'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 'var(--text-2xl)',
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, "\u753B\u50CF"), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--text-subtle)'
    }
  }, posts.length, " \u4EF6"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, selCount > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, selCount, " \u4EF6\u9078\u629E\u4E2D"), selCount > 0 && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => onToast(`${selCount} 件をグループ化しました`),
    style: {
      background: 'var(--surface)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-sm)',
      padding: '5px 12px',
      fontSize: 12,
      color: 'var(--text)',
      cursor: 'pointer'
    }
  }, "\u9078\u629E\u3092\u30B0\u30EB\u30FC\u30D7\u5316"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 11,
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u30BF\u30A4\u30EB"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => setTile(Math.max(120, tile - 30)),
    style: tileBtn
  }, "\u2212"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => setTile(Math.min(260, tile + 30)),
    style: tileBtn
  }, "\uFF0B")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fill, minmax(${tile}px, 1fr))`,
      gap: 8
    }
  }, posts.map((p, i) => /*#__PURE__*/React.createElement(ImageTile, {
    key: p.id,
    src: p.image,
    author: p.displayName,
    likes: p.likes,
    count: i % 5 === 0 ? 3 : 1,
    media: p.mediaType,
    inFolder: p.folder,
    selected: selected.has(p.id),
    onSelect: () => toggleSelect(p.id),
    onOpen: () => onToast('元投稿を開きます'),
    onFolder: () => onToast('フォルダに追加しました'),
    onDetail: () => onDetail(p),
    onDelete: () => onToast('削除しました')
  }))));
}
const tileBtn = {
  width: 28,
  height: 24,
  border: '1px solid var(--border-strong)',
  background: 'var(--surface)',
  color: 'var(--text)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1
};
window.ImageView = ImageView;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/corpus-app/ImageView.jsx", error: String((e && e.message) || e) }); }

// ui_kits/corpus-app/PostView.jsx
try { (() => {
/* global React */
const {
  PostCard,
  Select,
  Chip
} = window.CorpusDesignSystem_59d196;
function ViewToggle({
  view,
  setView
}) {
  const Btn = ({
    id,
    icon,
    label
  }) => {
    const active = view === id;
    return /*#__PURE__*/React.createElement("button", {
      type: "button",
      title: label,
      onClick: () => setView(id),
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 'var(--control-md)',
        border: 'none',
        background: active ? 'var(--accent)' : 'var(--surface)',
        color: active ? '#fff' : 'var(--text-muted)',
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement(window.Icon, {
      n: icon,
      size: 15
    }));
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-sm)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    id: "grid",
    icon: "layout-grid",
    label: "\u30B0\u30EA\u30C3\u30C9"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 1,
      background: 'var(--border-strong)'
    }
  }), /*#__PURE__*/React.createElement(Btn, {
    id: "list",
    icon: "rows-3",
    label: "\u30EA\u30B9\u30C8"
  }));
}
function PostView({
  posts,
  view,
  setView,
  sort,
  setSort,
  selected,
  toggleSelect,
  onToast
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px 28px 40px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 'var(--text-2xl)',
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, "\u6295\u7A3F"), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 'var(--text-sm)',
      color: 'var(--text-subtle)'
    }
  }, posts.length, " \u4EF6"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Select, {
    value: sort,
    onChange: e => setSort(e.target.value),
    fullWidth: false,
    size: "md",
    style: {
      minWidth: 130
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "date-desc"
  }, "\u65B0\u3057\u3044\u9806"), /*#__PURE__*/React.createElement("option", {
    value: "date-asc"
  }, "\u53E4\u3044\u9806"), /*#__PURE__*/React.createElement("option", {
    value: "likes-desc"
  }, "\u3044\u3044\u306D\u9806"), /*#__PURE__*/React.createElement("option", {
    value: "captured-desc"
  }, "\u30AD\u30E3\u30D7\u30C1\u30E3\u65E5\u6642\u9806")), /*#__PURE__*/React.createElement(ViewToggle, {
    view: view,
    setView: setView
  }))), view === 'grid' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: 16
    }
  }, posts.map(p => /*#__PURE__*/React.createElement(PostCard, {
    key: p.id,
    post: p,
    selectable: true,
    selected: selected.has(p.id),
    inFolder: p.folder,
    onOpen: () => toggleSelect(p.id),
    onFolder: () => onToast('フォルダに追加しました'),
    onDelete: () => onToast('削除しました')
  }))) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, posts.map(p => /*#__PURE__*/React.createElement(PostCard, {
    key: p.id,
    post: p,
    layout: "list",
    inFolder: p.folder,
    onOpen: () => onToast('投稿を開きます'),
    onFolder: () => onToast('フォルダに追加しました'),
    onDelete: () => onToast('削除しました')
  }))), posts.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: '60px 20px',
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      marginBottom: 6,
      color: 'var(--text)'
    }
  }, "\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13
    }
  }, "\u691C\u7D22\u6761\u4EF6\u3092\u5909\u66F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002")));
}
window.PostView = PostView;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/corpus-app/PostView.jsx", error: String((e && e.message) || e) }); }

// ui_kits/corpus-app/Settings.jsx
try { (() => {
/* global React */
const {
  Button,
  Switch,
  Select
} = window.CorpusDesignSystem_59d196;
function Section({
  title,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: '16px 20px',
      marginBottom: 16,
      boxShadow: 'var(--shadow-sm)'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    className: "eyebrow",
    style: {
      marginBottom: 12
    }
  }, title), children);
}
function Settings({
  theme,
  setTheme,
  confirmDelete,
  setConfirmDelete,
  onToast
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px 28px 40px',
      maxWidth: 720
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 'var(--text-2xl)',
      fontWeight: 600,
      color: 'var(--text-strong)',
      marginBottom: 18
    }
  }, "\u8A2D\u5B9A"), /*#__PURE__*/React.createElement(Section, {
    title: "\u4FDD\u5B58\u5148\u30D5\u30A9\u30EB\u30C0"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("code", {
    style: {
      flex: 1,
      minWidth: 200,
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--text-muted)',
      background: 'var(--surface-2)',
      padding: '7px 11px',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border-subtle)'
    }
  }, "~/Corpus/save"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: () => onToast('フォルダを選択しました')
  }, "\u30D5\u30A9\u30EB\u30C0\u3092\u9078\u629E")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      color: 'var(--text-subtle)',
      marginTop: 8,
      lineHeight: 1.5
    }
  }, "\u30AD\u30E3\u30D7\u30C1\u30E3\u3057\u305F\u753B\u50CF\u3068\u30E1\u30BF\u30C7\u30FC\u30BF\u306E\u4FDD\u5B58\u5148\u3002\u5909\u66F4\u3059\u308B\u3068\u6B21\u56DE\u30AD\u30E3\u30D7\u30C1\u30E3\u5206\u304B\u3089\u65B0\u3057\u3044\u5834\u6240\u306B\u4FDD\u5B58\u3055\u308C\u307E\u3059\u3002")), /*#__PURE__*/React.createElement(Section, {
    title: "\u5916\u89B3"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--text)'
    }
  }, "\u30C0\u30FC\u30AF\u30C6\u30FC\u30DE"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--text-subtle)',
      marginTop: 2
    }
  }, "\u6697\u3044\u74B0\u5883\u3067\u9577\u6642\u9593\u773A\u3081\u308B\u3068\u304D\u306B\u3002")), /*#__PURE__*/React.createElement(Switch, {
    checked: theme === 'dark',
    onChange: v => setTheme(v ? 'dark' : 'light')
  }))), /*#__PURE__*/React.createElement(Section, {
    title: "\u8A00\u8A9E"
  }, /*#__PURE__*/React.createElement(Select, {
    defaultValue: "ja"
  }, /*#__PURE__*/React.createElement("option", {
    value: "auto"
  }, "\u81EA\u52D5\uFF08OS\u306E\u8A00\u8A9E\u8A2D\u5B9A\u306B\u5F93\u3046\uFF09"), /*#__PURE__*/React.createElement("option", {
    value: "ja"
  }, "\u65E5\u672C\u8A9E"), /*#__PURE__*/React.createElement("option", {
    value: "en"
  }, "English")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      color: 'var(--text-subtle)',
      marginTop: 8
    }
  }, "\u30D3\u30E5\u30FC\u30A2\u306E\u8868\u793A\u8A00\u8A9E\u3092\u5909\u66F4\u3057\u307E\u3059\u3002\u5909\u66F4\u5F8C\u306B\u518D\u8AAD\u307F\u8FBC\u307F\u3055\u308C\u307E\u3059\u3002")), /*#__PURE__*/React.createElement(Section, {
    title: "\u30C7\u30FC\u30BF"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    onClick: () => onToast('エクスポートしました')
  }, "ZIP \u30A8\u30AF\u30B9\u30DD\u30FC\u30C8"), /*#__PURE__*/React.createElement(Button, {
    onClick: () => onToast('インポートしました')
  }, "ZIP \u304B\u3089\u5FA9\u5143"), /*#__PURE__*/React.createElement(Button, {
    onClick: () => onToast('画像を取り込みました')
  }, "\u753B\u50CF\u3092\u53D6\u308A\u8FBC\u307F"))), /*#__PURE__*/React.createElement(Section, {
    title: "\u5371\u967A\u306A\u64CD\u4F5C"
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: confirmDelete,
    onChange: setConfirmDelete,
    label: "\u6295\u7A3F\u524A\u9664\u6642\u306B\u78BA\u8A8D\u3092\u8868\u793A\u3059\u308B"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    onClick: () => onToast('全データを削除しました')
  }, "\u5168\u30C7\u30FC\u30BF\u3092\u524A\u9664"))));
}
window.Settings = Settings;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/corpus-app/Settings.jsx", error: String((e && e.message) || e) }); }

// ui_kits/corpus-app/Sidebar.jsx
try { (() => {
/* global React */
const {
  ModeNav,
  Tabs,
  Chip,
  Input,
  Switch
} = window.CorpusDesignSystem_59d196;
const {
  PLATFORMS,
  TAGS,
  FOLDERS
} = window.CorpusData;
const Lic = ({
  n,
  size = 18
}) => {
  const I = window.Icon;
  return /*#__PURE__*/React.createElement(I, {
    n: n,
    size: size
  });
};
function SbSection({
  title,
  action,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 2px',
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, title), action), children);
}
function Sidebar({
  mode,
  setMode,
  tab,
  setTab,
  theme,
  setTheme,
  query,
  setQuery,
  platforms,
  togglePlatform,
  tags,
  toggleTag,
  folder,
  setFolder,
  onManageFolders
}) {
  const isPost = mode === 'post';
  const showFilters = isPost ? tab === 'posts' : true;
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 264,
      flexShrink: 0,
      position: 'sticky',
      top: 0,
      height: '100vh',
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 'var(--z-sidebar)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      padding: '14px 14px 12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 26,
      height: 26,
      borderRadius: 7,
      background: 'var(--accent)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      color: '#fff',
      fontWeight: 700,
      fontSize: 15,
      lineHeight: 1
    }
  }, "C")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      fontWeight: 600,
      letterSpacing: '-0.01em',
      color: 'var(--text-strong)',
      flex: 1
    }
  }, "Corpus"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    title: "\u30C6\u30FC\u30DE\u5207\u66FF",
    style: {
      width: 30,
      height: 30,
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      color: 'var(--text-muted)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lic, {
    n: theme === 'dark' ? 'sun' : 'moon',
    size: 15
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 10px 8px'
    }
  }, /*#__PURE__*/React.createElement(ModeNav, {
    value: mode,
    onChange: setMode,
    items: [{
      id: 'post',
      label: '投稿閲覧',
      icon: /*#__PURE__*/React.createElement(Lic, {
        n: "rows-3"
      })
    }, {
      id: 'image',
      label: '画像閲覧',
      icon: /*#__PURE__*/React.createElement(Lic, {
        n: "layout-grid"
      })
    }]
  })), isPost && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '6px 10px 4px',
      borderTop: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    items: [{
      id: 'posts',
      label: '投稿'
    }, {
      id: 'tags',
      label: 'ハッシュタグ'
    }, {
      id: 'users',
      label: 'ユーザー'
    }, {
      id: 'settings',
      label: '設定'
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: '4px 12px 16px',
      borderTop: '1px solid var(--border-subtle)'
    }
  }, showFilters && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 0 4px'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    type: "search",
    icon: /*#__PURE__*/React.createElement(Lic, {
      n: "search",
      size: 15
    }),
    placeholder: "\u691C\u7D22\uFF08\u4F5C\u8005\u30FB\u672C\u6587\u30FB\u30BF\u30B0\uFF09",
    value: query,
    onChange: e => setQuery(e.target.value),
    hasValue: !!query
  })), /*#__PURE__*/React.createElement(SbSection, {
    title: "\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 5
    }
  }, PLATFORMS.map(p => /*#__PURE__*/React.createElement(Chip, {
    key: p.id,
    size: "sm",
    active: platforms.has(p.id),
    onClick: () => togglePlatform(p.id)
  }, p.label)))), /*#__PURE__*/React.createElement(SbSection, {
    title: "\u30BF\u30B0"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 5
    }
  }, TAGS.slice(0, 6).map(t => /*#__PURE__*/React.createElement(Chip, {
    key: t.label,
    size: "sm",
    active: tags.has(t.label),
    count: t.count,
    onClick: () => toggleTag(t.label)
  }, t.label)))), /*#__PURE__*/React.createElement(SbSection, {
    title: "\u30D5\u30A9\u30EB\u30C0",
    action: /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: onManageFolders,
      style: {
        fontSize: 10,
        fontWeight: 500,
        color: 'var(--accent)',
        background: 'none',
        border: 'none',
        cursor: 'pointer'
      }
    }, "\u7BA1\u7406")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 5
    }
  }, FOLDERS.map(f => /*#__PURE__*/React.createElement(Chip, {
    key: f.id,
    size: "sm",
    active: folder === f.id,
    leading: f.default ? '★' : null,
    count: f.count,
    onClick: () => setFolder(folder === f.id ? null : f.id)
  }, f.label))))), isPost && tab === 'settings' && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 2px',
      color: 'var(--text-muted)',
      fontSize: 12,
      lineHeight: 1.6
    }
  }, "\u8A2D\u5B9A\u306F\u53F3\u5074\u306E\u30D1\u30CD\u30EB\u3067\u5909\u66F4\u3067\u304D\u307E\u3059\u3002"), isPost && (tab === 'tags' || tab === 'users') && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 0'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    type: "search",
    icon: /*#__PURE__*/React.createElement(Lic, {
      n: "search",
      size: 15
    }),
    placeholder: tab === 'tags' ? 'ハッシュタグを絞り込み' : 'ユーザー名で絞り込み',
    value: query,
    onChange: e => setQuery(e.target.value)
  }))));
}
window.Sidebar = Sidebar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/corpus-app/Sidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/corpus-app/data.js
try { (() => {
// Sample archive data for the Corpus UI kit — fake posts/illustrations.
// Images are the abstract placeholder set in assets/sample/.
(function () {
  const img = n => `../../assets/sample/art-${String(n).padStart(2, '0')}.jpg`;
  const POSTS = [{
    id: 1,
    platform: 'bluesky',
    displayName: '青空スケッチ',
    screenName: 'sora_sketch',
    text: '夕方の光がきれいだったので描きました。空のグラデーションを意識しています。',
    image: img(3),
    likes: 12480,
    reposts: 321,
    replies: 42,
    date: '2026-06-08',
    capturedAt: '2026-06-08',
    tags: ['イラスト', '風景'],
    mediaType: 'image',
    folder: true
  }, {
    id: 2,
    platform: 'x',
    displayName: 'machi',
    screenName: 'machi_draws',
    text: 'ラフ。あとで清書する。色のあたりだけ置いた状態。',
    image: img(7),
    likes: 842,
    reposts: 18,
    replies: 3,
    date: '2026-06-06',
    tags: ['ラフ'],
    isReply: true,
    mediaType: 'image'
  }, {
    id: 3,
    platform: 'pixiv',
    displayName: '灯と影',
    screenName: 'akari_kage',
    text: '連作「街の明かり」3枚目。夜のシリーズが続きます。',
    image: img(1),
    likes: 5300,
    reposts: 210,
    replies: 31,
    date: '2026-06-05',
    tags: ['イラスト', '夜景', '連作'],
    mediaType: 'image',
    folder: true
  }, {
    id: 4,
    platform: 'misskey',
    displayName: 'haru',
    screenName: 'haru_m',
    text: '走り描きGIF。動きの練習。',
    image: img(9),
    likes: 128,
    reposts: 6,
    replies: 1,
    date: '2026-06-03',
    tags: ['練習'],
    mediaType: 'gif'
  }, {
    id: 5,
    platform: 'mastodon',
    displayName: 'よる',
    screenName: 'yoru',
    text: '静物。質感の検証。布の落ち方が難しい。',
    image: img(4),
    likes: 64,
    reposts: 2,
    replies: 0,
    date: '2026-06-01',
    tags: ['習作'],
    mediaType: 'image'
  }, {
    id: 6,
    platform: 'x',
    displayName: 'くも',
    screenName: 'kumo_art',
    text: '引用元の構図がよかったので自分でも。',
    image: img(11),
    likes: 2100,
    reposts: 88,
    replies: 12,
    date: '2026-05-29',
    tags: ['イラスト'],
    isQuote: true,
    mediaType: 'image'
  }, {
    id: 7,
    platform: 'bluesky',
    displayName: 'もり',
    screenName: 'mori_zzz',
    text: '森の中の小さな家。背景の練習を続けています。',
    image: img(2),
    likes: 910,
    reposts: 40,
    replies: 7,
    date: '2026-05-27',
    tags: ['風景', '背景'],
    mediaType: 'image',
    folder: true
  }, {
    id: 8,
    platform: 'pixiv',
    displayName: 'なみ',
    screenName: 'nami_draw',
    text: '海シリーズ。波の表現を変えてみた。',
    image: img(6),
    likes: 430,
    reposts: 14,
    replies: 2,
    date: '2026-05-24',
    tags: ['イラスト', '海'],
    mediaType: 'image'
  }, {
    id: 9,
    platform: 'x',
    displayName: 'そら',
    screenName: 'sora_v',
    text: 'タイムラプス動画。制作過程です。',
    image: img(10),
    likes: 3400,
    reposts: 156,
    replies: 23,
    date: '2026-05-22',
    tags: ['過程'],
    mediaType: 'video'
  }, {
    id: 10,
    platform: 'misskey',
    displayName: 'つき',
    screenName: 'tsuki',
    text: '月と猫。今日のらくがき。',
    image: img(8),
    likes: 220,
    reposts: 9,
    replies: 4,
    date: '2026-05-20',
    tags: ['らくがき', '猫'],
    mediaType: 'image'
  }, {
    id: 11,
    platform: 'bluesky',
    displayName: 'あめ',
    screenName: 'ame_ame',
    text: '雨の日の窓。にじみの表現が気に入っている。',
    image: img(5),
    likes: 1580,
    reposts: 62,
    replies: 9,
    date: '2026-05-18',
    tags: ['イラスト', '雨'],
    mediaType: 'image'
  }, {
    id: 12,
    platform: 'pixiv',
    displayName: 'ひかり',
    screenName: 'hikari_p',
    text: '光の差し込む部屋。逆光の練習。',
    image: img(12),
    likes: 7200,
    reposts: 298,
    replies: 51,
    date: '2026-05-15',
    tags: ['イラスト', '光'],
    mediaType: 'image',
    folder: true
  }];
  const PLATFORMS = [{
    id: 'x',
    label: 'X'
  }, {
    id: 'bluesky',
    label: 'Bluesky'
  }, {
    id: 'misskey',
    label: 'Misskey'
  }, {
    id: 'mastodon',
    label: 'Mastodon'
  }, {
    id: 'pixiv',
    label: 'pixiv'
  }];
  const TAGS = [{
    label: 'イラスト',
    count: 128
  }, {
    label: '風景',
    count: 64
  }, {
    label: '夜景',
    count: 21
  }, {
    label: '習作',
    count: 18
  }, {
    label: 'らくがき',
    count: 15
  }, {
    label: '海',
    count: 12
  }, {
    label: '背景',
    count: 11
  }, {
    label: '猫',
    count: 9
  }];
  const FOLDERS = [{
    id: 'fav',
    label: 'お気に入り',
    count: 42,
    default: true
  }, {
    id: 'ref',
    label: '資料',
    count: 88
  }, {
    id: 'wip',
    label: '制作中',
    count: 13
  }];
  window.CorpusData = {
    POSTS,
    PLATFORMS,
    TAGS,
    FOLDERS
  };
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/corpus-app/data.js", error: String((e && e.message) || e) }); }

// ui_kits/corpus-app/icons.jsx
try { (() => {
/* global React */
// React-native icon set for the kit. Inline SVG so React fully controls the
// DOM (calling lucide.createIcons() on a re-rendering tree corrupts
// reconciliation). Mode glyphs mirror the original app; the rest match Lucide's
// stroke style (1.75–2px, round caps).
const ICON_PATHS = {
  'rows-3': '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/>',
  'layout-grid': '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  'search': '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  'moon': '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
};
function Icon({
  n,
  size = 18,
  stroke = 1.9
}) {
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      display: 'block'
    },
    dangerouslySetInnerHTML: {
      __html: ICON_PATHS[n] || ''
    }
  });
}
window.Icon = Icon;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/corpus-app/icons.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.ImageTile = __ds_scope.ImageTile;

__ds_ns.PlatformBadge = __ds_scope.PlatformBadge;

__ds_ns.PostCard = __ds_scope.PostCard;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.ModeNav = __ds_scope.ModeNav;

__ds_ns.Tabs = __ds_scope.Tabs;

})();

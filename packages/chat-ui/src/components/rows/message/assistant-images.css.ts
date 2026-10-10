// [XG-CUSTOM 2026-10-09] Styles for agent-sent image cards (assistant messages).
// Geometry mirrors `assistant-images.ts` (thumb square + one caption line) so the
// measured row height and the rendered box always agree.

import { style } from '@vanilla-extract/css';
import { vars } from '@styles/theme.css';
import {
  ASSISTANT_IMAGE_CAPTION,
  ASSISTANT_IMAGE_GAP,
  ASSISTANT_IMAGE_THUMB,
} from './assistant-images';

export const imageGrid = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: ASSISTANT_IMAGE_GAP,
  paddingBottom: ASSISTANT_IMAGE_GAP,
});

export const imageCell = style({
  position: 'relative',
  display: 'block',
  width: ASSISTANT_IMAGE_THUMB,
  height: ASSISTANT_IMAGE_THUMB + ASSISTANT_IMAGE_CAPTION,
  padding: 0,
  margin: 0,
  border: 'none',
  background: 'none',
  textAlign: 'left',
  borderRadius: vars.radiusMd,
  textDecoration: 'none',
  color: 'inherit',
  selectors: {
    '&:focus-visible': {
      outline: '2px solid currentColor',
      outlineOffset: '2px',
    },
  },
});

/** Clickable card (has an http(s) `page`). */
export const imageCellClickable = style({ cursor: 'pointer' });

export const imageThumb = style({
  display: 'block',
  width: ASSISTANT_IMAGE_THUMB,
  height: ASSISTANT_IMAGE_THUMB,
  borderRadius: vars.radiusMd,
  objectFit: 'cover',
  background: vars.bg2,
  boxShadow: `0 0 0 1px ${vars.border}`,
});

/** Single-line caption (ellipsised) — fixed height keeps grid math exact. */
export const imageCaption = style({
  display: 'block',
  height: ASSISTANT_IMAGE_CAPTION,
  lineHeight: `${ASSISTANT_IMAGE_CAPTION}px`,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  color: vars.fgMuted,
  fontSize: '11px',
});

/** Corner badge: host of `page` (fallback: marker `source`). */
export const imageBadge = style({
  position: 'absolute',
  top: '6px',
  right: '6px',
  maxWidth: 'calc(100% - 12px)',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  padding: '1px 6px',
  borderRadius: vars.radiusMd,
  background: 'rgba(0, 0, 0, 0.55)',
  color: '#fff',
  fontSize: '10px',
  lineHeight: '14px',
  pointerEvents: 'none',
});

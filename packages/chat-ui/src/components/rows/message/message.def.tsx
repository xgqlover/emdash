import { StreamContext, type StreamAnimation } from '@components/contexts/StreamContext';
import { BlockStackView } from '@components/primitives/BlockStackView';
import { CopyButton } from '@components/primitives/CopyButton';
import type { StackLayout } from '@core/compose';
import type { MeasureCtx, Measured, RenderCtx } from '@core/define';
import { layoutBlockStack } from '@core/layout/block-stack';
import type { Block } from '@core/markdown/document';
import { blockPlainText } from '@core/markdown/plain-text';
import type { SegmentCtx } from '@core/units';
import { defineUnit } from '@core/units';
import { pxTokens } from '@styles/px-tokens';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import { Show, For, createMemo } from 'solid-js';
import type { ChatMessage, ChatMessageImage } from '@/model';
import {
  assistantImageDataUrl,
  assistantImageGridHeight,
  buildAssistantImages,
  splitAssistantImageMeta,
} from './assistant-images';
import {
  imageBadge,
  imageCaption,
  imageCell,
  imageCellClickable,
  imageGrid,
  imageThumb,
} from './assistant-images.css';
import { attachStripHeight, type MessageVars, userInnerWidth } from './metrics';
import { UserMessageCard } from './UserMessageCard';
import {
  assistantOuter,
  assistantRoot,
  assistantVars,
  footerRow,
  messageText,
  srOnly,
} from './message.css';

export function messageFromItem(item: ChatMessage, ctx: SegmentCtx): ChatMessage {
  // [XG-CUSTOM 2026-10-09] Assistant images (项我 bridge): the `[XG-IMG-META]` marker
  // always arrives in the message text (its own chunk) while the base64 image
  // blocks ride along as `images`. Strip the marker and pair both here, so every
  // downstream consumer (measure + render) sees plain text plus resolved images.
  // User messages keep the pre-existing attachments path untouched.
  const isAssistant = item.role === 'assistant';
  const parsed = isAssistant
    ? splitAssistantImageMeta(item.text)
    : { text: item.text, meta: [] as ReturnType<typeof splitAssistantImageMeta>['meta'] };
  const images =
    isAssistant && item.images?.length
      ? buildAssistantImages(item.id, item.images, parsed.meta)
      : undefined;
  return {
    ...item,
    text: parsed.text,
    streaming: ctx.active && item.role === 'assistant',
    attachments: item.attachments?.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
    })),
    images,
  };
}

// ── Measure ───────────────────────────────────────────────────────────────────

export function measureMessage(item: ChatMessage, ctx: MeasureCtx, vars: MessageVars): number {
  const { userCardPadY, cardBorder, collapsedMaxH, expandedMaxH } = vars;
  const blocks = item.streaming
    ? ctx.caches.parseBlocksStreaming(item.id, item.text)
    : ctx.caches.parseBlocks(item.id, item.text);

  if (item.role === 'user') {
    const innerW = userInnerWidth(ctx.width, vars);
    const aH = attachStripHeight(item.attachments?.length ?? 0, innerW, vars);
    if (blocks.length === 0) {
      const fallback = aH + ctx.theme.fonts.body.lineHeight + 2 * userCardPadY + 2 * cardBorder;
      return Math.min(fallback, ctx.expandedId === item.id ? expandedMaxH : collapsedMaxH);
    }
    const innerCtx = { ...ctx, width: innerW };
    const stack = layoutBlockStack(blocks, innerCtx, { isCollapsed: ctx.isCollapsed });
    const contentH = aH + stack.height + 2 * userCardPadY + 2 * cardBorder;
    return Math.min(contentH, ctx.expandedId === item.id ? expandedMaxH : collapsedMaxH);
  }

  // assistant / thought
  const footer = item.role === 'assistant' ? vars.footerH : 0;
  // [XG-CUSTOM 2026-10-09] Agent images render as a grid under the text; empty text
  // with images must NOT reserve a stray text line.
  const imagesH =
    item.role === 'assistant' ? assistantImageGridHeight(item.images?.length ?? 0, ctx.width) : 0;
  if (blocks.length === 0) {
    if (imagesH > 0) return imagesH + footer;
    return ctx.theme.fonts.body.lineHeight + footer;
  }
  const stack = layoutBlockStack(blocks, ctx, { isCollapsed: ctx.isCollapsed });
  return stack.height + imagesH + footer;
}

// [XG-CUSTOM 2026-10-09] One agent-sent image card: thumbnail + caption + source
// badge. Clicking opens the source page through the SAME external-link pathway
// markdown links already use (a plain `<a target="_blank">` — see Prose.tsx), so
// no bespoke opening bridge is introduced. Cards without an http(s) `page` are
// inert (and not clickable).
function AssistantImageContent(props: { image: ChatMessageImage }) {
  const caption = () => props.image.caption ?? '';
  const badge = () => props.image.sourceHost ?? '';
  return (
    <>
      <img
        src={assistantImageDataUrl(props.image)}
        alt={caption()}
        class={imageThumb}
        decoding="async"
      />
      <Show when={caption() !== ''}>
        <span class={imageCaption} title={caption()}>
          {caption()}
        </span>
      </Show>
      <Show when={badge() !== ''}>
        <span class={imageBadge}>{badge()}</span>
      </Show>
    </>
  );
}

function AssistantImageCard(props: { image: ChatMessageImage }) {
  const page = () => props.image.page ?? '';
  return (
    <Show
      when={page() !== ''}
      fallback={
        <div class={imageCell}>
          <AssistantImageContent image={props.image} />
        </div>
      }
    >
      <a
        class={`${imageCell} ${imageCellClickable}`}
        href={page()}
        target="_blank"
        rel="noopener noreferrer"
        title={page()}
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <AssistantImageContent image={props.image} />
      </a>
    </Show>
  );
}

function AssistantRender(props: { data: ChatMessage; ctx: RenderCtx; vars: MessageVars }) {
  const mCtx = () => props.ctx.measureCtx?.();

  // One frontier Map per mounted instance — persists across streaming chunks
  // because the <For> in UnitRow keeps this component alive. Shared by ref with
  // StreamContext so Prose.tsx can update it after each render without reactivity.
  //
  // `streaming` and `settledCount` are reactive accessors so Code.tsx effects
  // track the per-block settled transition (fence close or blank-line boundary)
  // and highlight each block exactly once when it crosses that boundary.
  const parsed = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return { blocks: [] as Block[], settledCount: 0 };
    const blocks = props.data.streaming
      ? ctx.caches.parseBlocksStreaming(props.data.id, props.data.text)
      : ctx.caches.parseBlocks(props.data.id, props.data.text);
    const settledCount = props.data.streaming
      ? ctx.caches.settledBlockCount(props.data.id)
      : blocks.length;
    return { blocks, settledCount };
  });

  const streamAnimation: StreamAnimation = {
    frontier: new Map(),
    streaming: () => props.data.streaming === true,
    settledCount: () => parsed().settledCount,
  };

  const stack = createMemo<Measured<StackLayout> | null>(() => {
    const ctx = mCtx();
    if (!ctx) return null;
    const blocks = parsed().blocks;
    if (blocks.length === 0) return null;
    return layoutBlockStack(blocks, ctx, { isCollapsed: ctx.isCollapsed });
  });

  const totalH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return props.data.role === 'assistant' ? props.vars.footerH : 0;
    return measureMessage(props.data, ctx, props.vars);
  });

  const plainText = () => {
    const ctx = mCtx();
    if (!ctx) return props.data.text;
    // Use the same parse path as the renderer so we don't trigger a full reparse
    // during streaming just for the screen-reader text.
    const parse = props.data.streaming ? ctx.caches.parseBlocksStreaming : ctx.caches.parseBlocks;
    return parse(props.data.id, props.data.text).map(blockPlainText).join('\n\n');
  };

  const role = () =>
    (props.data.role === 'thought' ? 'thought' : 'assistant') as 'thought' | 'assistant';

  return (
    <div
      class={`${assistantOuter} ${messageText({ role: role() })} ${assistantRoot}`}
      style={assignInlineVars(assistantVars, pxTokens({ height: totalH() }))}
    >
      <div class={srOnly}>{plainText()}</div>
      <StreamContext.Provider value={props.data.streaming ? streamAnimation : null}>
        <Show when={stack()}>{(s) => <BlockStackView node={s()} />}</Show>
      </StreamContext.Provider>
      {/* [XG-CUSTOM 2026-10-09] Agent images, rendered under the text in send order. */}
      <Show when={props.data.images?.length}>
        <div class={imageGrid}>
          <For each={props.data.images}>
            {(image) => <AssistantImageCard image={image} />}
          </For>
        </div>
      </Show>
      <Show when={props.data.role === 'assistant'}>
        <div
          class={footerRow}
          style={{ height: `${props.vars.footerH}px` }}
          aria-hidden={props.data.streaming ? 'true' : undefined}
        >
          <Show when={!props.data.streaming}>
            <CopyButton text={props.data.text} variant="inline" label="Copy message" />
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ── MessageUnitRender ─────────────────────────────────────────────────────────

function MessageUnitRender(props: { data: ChatMessage; ctx: RenderCtx; vars: MessageVars }) {
  if (props.data.role === 'user') {
    return <UserMessageCard data={props.data} ctx={props.ctx} vars={props.vars} />;
  }
  return <AssistantRender data={props.data} ctx={props.ctx} vars={props.vars} />;
}

// ── UnitDef ───────────────────────────────────────────────────────────────────

export const messageUnitDef = defineUnit<ChatMessage, MessageVars>({
  kind: 'message',
  margin: { top: 8, bottom: 8 },
  vars: {
    cardBorder: 1,
    collapsedMaxH: 120,
    expandedMaxH: 360,
    userCardPadX: 16,
    userCardPadY: 16,
    attachThumb: 32,
    attachGap: 8,
    footerH: 24,
  },

  estimate(item, ctx, vars): number {
    if (item.role === 'user') {
      const innerW = userInnerWidth(ctx.width, vars);
      const lines = Math.max(1, Math.ceil(item.text.length / 60));
      const aH = attachStripHeight(item.attachments?.length ?? 0, innerW, vars);
      const est =
        aH + lines * ctx.theme.fonts.body.lineHeight + 2 * vars.userCardPadY + 2 * vars.cardBorder;
      return Math.min(est, ctx.expandedId === item.id ? vars.expandedMaxH : vars.collapsedMaxH);
    }
    const footer = item.role === 'assistant' ? vars.footerH : 0;
    // [XG-CUSTOM 2026-10-09] Keep the estimate shape identical to measure(): an
    // image-only message must not reserve a text line.
    const imagesH =
      item.role === 'assistant'
        ? assistantImageGridHeight(item.images?.length ?? 0, ctx.width)
        : 0;
    const lines =
      item.text.length === 0 && imagesH > 0 ? 0 : Math.max(1, Math.ceil(item.text.length / 60));
    return lines * ctx.theme.fonts.body.lineHeight + footer + imagesH;
  },

  measure: measureMessage,

  Render: MessageUnitRender,
});

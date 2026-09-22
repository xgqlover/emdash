import { Dialog, Button } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import type { ExpertHandoffTopic } from '@core/primitives/desktop-host/api/host-contract';
import {
  expertHandoffAccept,
  expertHandoffDelete,
} from '@core/primitives/desktop-host/browser/host-client';
import { useModalController } from '@core/manifests/browser/modal-api';
import { defineModal } from '@core/primitives/modals/react';

// [XG-CUSTOM] 专家交接平台：/use 切专家时弹「前专家产出主题」清单，用户可接下/删除。
// 复用 emdash 原生 Dialog/Button，不自造弹窗框架。
export const ExpertHandoffModal = observer(function ExpertHandoffModal({
  topics,
}: {
  topics: ExpertHandoffTopic[];
}) {
  const { complete } = useModalController('expertHandoffModal');
  const [list, setList] = useState<ExpertHandoffTopic[]>(topics);

  async function handleAccept(topic: ExpertHandoffTopic) {
    try {
      await expertHandoffAccept(String(topic.id));
      setList((cur) => cur.filter((t) => t.id !== topic.id));
    } catch (e) {
      // 交接失败不阻塞，保留主题
      void e;
    }
  }

  async function handleDelete(topic: ExpertHandoffTopic) {
    try {
      await expertHandoffDelete(String(topic.id));
      setList((cur) => cur.filter((t) => t.id !== topic.id));
    } catch (e) {
      void e;
    }
  }

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>专家交接</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        {list.length === 0 ? (
          <div className="py-4 text-sm text-foreground-muted">没有待交接的主题。</div>
        ) : (
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {list.map((topic) => (
              <div
                key={topic.id}
                className="flex items-start gap-2 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{topic.title}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-foreground-muted">
                    {topic.summary}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button variant="primary" size="sm" onClick={() => void handleAccept(topic)}>
                    接下
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void handleDelete(topic)}>
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={() => complete({ topics: list })}>
          关闭
        </Button>
      </Dialog.Footer>
    </>
  );
});

export const expertHandoffModal = defineModal<{ topics: ExpertHandoffTopic[] }>()({
  id: 'expertHandoffModal',
  component: ExpertHandoffModal,
});

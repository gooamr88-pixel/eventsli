'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { Panel } from '../../../../components/ui/Page';
import { Loading, Empty } from '../../../../components/Feedback';
import FormError from '../../../../components/forms/FormError';
import { useConfirm } from '../../../../components/ui/Confirm';
import { useToast } from '../../../../components/ui/Toast';
import { useContentSection, useSectionDraft, uploadImage, IMAGE_ACCEPT } from './useContentSection';
import SaveBar from './SaveBar';
import RowControls from './RowControls';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event's gallery — photographs and video, in one list.
 *
 * ONE LIST FOR BOTH, because to the reader of the event page it is one strip.
 * Splitting images from video in the editor would make the organizer manage two
 * orders that interleave into one on the page, which is the kind of thing that
 * is only discovered after publishing.
 *
 * A video is a LINK, never an upload: the file lives on YouTube or Vimeo, who
 * have already solved transcoding, bandwidth and playback on a bad connection.
 * Hosting it ourselves would mean solving all three to do worse.
 *
 * Captions are optional and mean it. Most photographs of a venue do not need a
 * sentence under them, and a required caption is how a gallery ends up captioned
 * "image 1", "image 2".
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function GalleryEditor({ eventId }) {
  const { items, error, busy, add, edit, remove, move, setError } = useContentSection(eventId, 'media');
  const input = useRef(null);
  const confirm = useConfirm();
  const toast = useToast();
  const [videoUrl, setVideoUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  /**
   * Pending caption edits. A caption is the only typed field here — adding a
   * photo, adding a video, reordering and removing are single deliberate
   * clicks whose result is visible, and they stay immediate.
   */
  const rows = useSectionDraft({
    items,
    // Empty is `null`, not `''` — "no caption" is what makes the event page
    // leave the line out rather than render a blank one under the photo.
    edit: (id, pending) => edit(id, { caption: String(pending.caption || '').trim() || null }),
  });

  async function addImages(files) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      // One at a time rather than in parallel. A phone gallery hands over eight
      // 4MB photographs at once, and eight simultaneous uploads on a venue's
      // wifi is how all eight time out instead of the first three landing.
      for (const file of files) {
        const path = await uploadImage(eventId, file, 'gallery');
        const { ok } = await add({ kind: 'image', path });
        if (!ok) break;
      }
      toast.success(files.length === 1 ? 'Photo added.' : `${files.length} photos added.`);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
      // Cleared so choosing the SAME file again still fires a change event.
      if (input.current) input.current.value = '';
    }
  }

  async function addVideo(e) {
    e.preventDefault();
    const url = videoUrl.trim();
    if (!url) return;
    const { ok } = await add({ kind: 'video', url });
    if (ok) {
      setVideoUrl('');
      toast.success('Video added.');
    }
  }

  async function removeItem(item) {
    const ok = await confirm({
      title: item.kind === 'video' ? 'Remove this video?' : 'Remove this photo?',
      tone: 'danger',
      body: <p>It comes off your event page straight away. {item.kind === 'image' && 'The file is deleted, so bringing it back means uploading it again.'}</p>,
      confirmLabel: 'Remove',
    });
    if (ok) remove(item.id);
  }

  return (
    <Panel
      title="Gallery"
      description="Photos and video shown under your event description. Drag the arrows to set the order people see them in."
    >
      <FormError error={error} />

      {items === null ? (
        <Loading variant="list" rows={2} label="Loading the gallery" />
      ) : items.length === 0 ? (
        <Empty
          title="No photos yet"
          hint="A few pictures of the venue or a past event do more for ticket sales than another paragraph."
        />
      ) : (
        <ul className="fx-grid" style={{ '--fx-col': '220px', '--fx-gap': '12px' }}>
          {items.map((item, index) => (
            <li key={item.id} className="fx-stack fx-stack--sm rounded-(--es-radius-md) border border-border-base p-3">
              {item.kind === 'video' ? (
                <div className="fx-stack fx-stack--sm">
                  <div className="grid aspect-video place-items-center rounded-(--es-radius-sm) bg-bg-sunken text-sm text-subtle">
                    Video
                  </div>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="fx-break text-xs text-accent"
                  >
                    {item.url}
                  </a>
                </div>
              ) : (
                <div className="relative aspect-video overflow-hidden rounded-(--es-radius-sm) bg-bg-sunken">
                  <Image src={item.url} alt={item.caption || ''} fill sizes="220px" className="object-cover" />
                </div>
              )}

              <label className="fx-stack fx-stack--sm gap-1">
                <span className="text-xs text-subtle">Caption (optional)</span>
                {/* Held as a draft and saved on the button below. This was
                    `defaultValue` + `onBlur`, which wrote on the way past the
                    field and never said whether the write had landed. */}
                <input
                  className="es-input es-input--sm"
                  value={rows.valueOf(item, 'caption')}
                  maxLength={200}
                  placeholder="Add a caption"
                  onChange={(e) => rows.setField(item.id, 'caption', e.target.value)}
                />
              </label>

              <RowControls
                index={index}
                total={items.length}
                busy={busy}
                onMove={(delta) => move(item.id, delta)}
                onRemove={() => removeItem(item)}
              />
            </li>
          ))}
        </ul>
      )}

      <SaveBar
        dirty={rows.dirty}
        status={rows.status}
        failure={rows.failure}
        onSave={rows.save}
        onDiscard={rows.discard}
        label="caption changes"
      />

      <div className="fx-stack fx-stack--sm border-t border-border-base pt-4">
        <input
          ref={input}
          id={`gallery-${eventId}`}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          className="sr-only"
          disabled={uploading || busy}
          onChange={(e) => addImages(Array.from(e.target.files || []))}
        />
        <label
          htmlFor={`gallery-${eventId}`}
          aria-disabled={uploading || busy || undefined}
          className="es-btn es-btn--secondary self-start"
        >
          {uploading ? 'Uploading…' : 'Add photos'}
        </label>

        <form onSubmit={addVideo} className="fx-row flex-wrap items-end gap-2">
          <label className="fx-stack fx-stack--sm fx-min0 flex-1 gap-1">
            <span className="text-sm text-ink">Or paste a video link</span>
            <input
              className="es-input"
              type="url"
              inputMode="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
            />
          </label>
          <button type="submit" disabled={!videoUrl.trim() || busy} className="es-btn es-btn--secondary">
            Add video
          </button>
        </form>
        <p className="text-xs text-subtle">
          YouTube and Vimeo links work best — they play on every device without slowing your page down.
        </p>
      </div>
    </Panel>
  );
}

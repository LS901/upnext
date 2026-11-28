import type { ReactNode } from "react";
import { Poster } from "@/components/poster";
import { StatusChip } from "@/components/status-chip";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { seasonDetails, seasonLabel, seasonName } from "@/app/search/season-label";
import { bookMeta } from "@/lib/format/book";
import { formatDuration } from "@/lib/format/duration";
import { playAgainLabel, playCountLine } from "@/lib/format/plays";
import { formatScore } from "@/lib/format/score";
import { TYPE_LABELS } from "@/lib/format/type-labels";
import type {
  ItemRow,
  LibraryGroup,
  SeasonRow,
  SeriesBookRow,
  SeriesRow,
  ShowRow,
  UpNextRow,
} from "@/lib/library/queries";
import type { EntryStatus } from "@/lib/library/status";
import { queuedTitle } from "./drag-name";

// The library's rows, shared by My library (with the owner's controls) and a
// public profile (read-only). What sits beside each entry comes from the page,
// so the read-only rows never carry a form, a note or an exclusion control.

export const muted = "text-sm text-muted-foreground break-words";

/** One library entry, as the controls beside it need it. `name` tells entries apart when heard. */
export type EntryRef = { entryId: string; status: EntryStatus; playCount: number; again: string; name: string };

export type RowControls = {
  /** What sits beside each entry: the owner's controls, or just its status. */
  entry: (entry: EntryRef) => ReactNode;
  /** The Progress control under a show or series; none when read-only. */
  showCount?: (show: ShowRow) => ReactNode;
  seriesCount?: (series: SeriesRow) => ReactNode;
};

/** Another user's library: the status only, nothing to change and nothing private. */
export const READ_ONLY: RowControls = { entry: (entry) => <StatusChip status={entry.status} /> };

const audioName = (row: ItemRow) => (row.version === "audio" ? `${row.title} · Audiobook` : row.title);

export function itemMeta(item: ItemRow): string {
  if (item.mediaType === "book") return bookMeta(item);
  // Other has no time, no score: its label, then the length the user typed.
  if (item.mediaType === "other") return item.lengthNote ? `${TYPE_LABELS.other} · ${item.lengthNote}` : TYPE_LABELS.other;
  const time =
    item.mediaType === "game"
      ? `Time to beat: ${formatDuration(item.minutes)} (story)`
      : `Time to finish: ${formatDuration(item.minutes)}`;
  return [TYPE_LABELS[item.mediaType], time, formatScore(item.score, item.scoreCount, item.providerName)].join(" · ");
}

/** A queued row's poster, title and details; the page adds what goes under them. */
export function QueuedSummary({ row }: { row: UpNextRow }) {
  const season = row.kind === "season";
  const meta = season
    ? [...seasonDetails(row), `Time to finish: ${formatDuration(row.runtimeMinutes)}`, formatScore(row.score, row.scoreCount)]
    : [itemMeta(row)];
  return (
    <>
      <Poster url={row.imageUrl} title={queuedTitle(row)} size="md" mediaType={season ? "show" : row.mediaType} />
      <div className="min-w-0 flex-1 basis-32">
        <h4 className="font-medium break-words">{queuedTitle(row)}</h4>
        <p className={muted}>{meta.join(" · ")}</p>
      </div>
    </>
  );
}

/** What a queued row's controls know about it. */
export function queuedRef(row: UpNextRow): EntryRef {
  return {
    entryId: row.entryId,
    status: row.status,
    playCount: row.playCount,
    again: row.kind === "season" ? playAgainLabel("show", null) : playAgainLabel(row.mediaType, row.version),
    name: row.kind === "season" ? queuedTitle(row) : audioName(row),
  };
}

export function Group({ group, controls }: { group: LibraryGroup; controls: RowControls }) {
  const id = `status-${group.status}`;
  return (
    <section aria-labelledby={id}>
      <Card className="min-w-0 gap-3" size="sm">
        <h2 id={id} className="px-(--card-spacing) text-xl font-semibold">
          {group.label}
        </h2>
        <ul className="flex flex-col divide-y divide-border px-(--card-spacing)">
          {group.rows.map((row) =>
            row.kind === "item" ? (
              <Item key={row.entryId} item={row} controls={controls} />
            ) : row.kind === "show" ? (
              <Show key={row.showId} show={row} controls={controls} />
            ) : (
              <Series key={row.seriesId} series={row} controls={controls} />
            ),
          )}
        </ul>
      </Card>
    </section>
  );
}

function Item({ item, controls }: { item: ItemRow; controls: RowControls }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
      <Poster url={item.imageUrl} title={item.title} size="md" mediaType={item.mediaType} />
      <div className="min-w-0 flex-1 basis-32">
        <h3 className="font-medium break-words">{item.title}</h3>
        <p className={muted}>{itemMeta(item)}</p>
        <PlayCount line={playCountLine(item.mediaType, item.version, item.playCount)} />
      </div>
      {controls.entry({
        entryId: item.entryId,
        status: item.status,
        playCount: item.playCount,
        again: playAgainLabel(item.mediaType, item.version),
        name: audioName(item),
      })}
    </li>
  );
}

// The show's progress counts all its seasons; the rows are only the user's
// seasons in this group's status. Never a season synopsis (INV-004).
function Show({ show, controls }: { show: ShowRow; controls: RowControls }) {
  const { finished, total } = show.progress;
  const progress = total ? `${finished} of ${total} seasons finished` : "No seasons yet";
  return (
    <li className="py-3">
      <div className="flex items-center gap-4">
        <Poster url={show.imageUrl} title={show.title} size="md" mediaType="show" />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium break-words">{show.title}</h3>
          <p className={muted}>{[TYPE_LABELS.show, progress, formatScore(show.score, show.scoreCount)].join(" · ")}</p>
          {total > 0 && <Progress aria-hidden="true" value={(finished / total) * 100} className="mt-2 max-w-48" />}
        </div>
      </div>
      {controls.showCount?.(show)}
      <ul className="mt-2 flex flex-col divide-y divide-border sm:pl-24">
        {show.seasons.map((season) => (
          <Season key={season.entryId} season={season} showTitle={show.title} controls={controls} />
        ))}
      </ul>
    </li>
  );
}

// Like a show: the series' progress counts all the user's books in it, in any
// status; the rows are only the user's books in this group's status. A series
// has no score of its own, so its line carries none.
function Series({ series, controls }: { series: SeriesRow; controls: RowControls }) {
  const { read, total } = series.progress;
  const meta = total ? `Series · ${read} of ${total} read` : "Series";
  return (
    <li className="py-3">
      <div className="flex items-center gap-4">
        <Poster url={series.books[0]?.imageUrl ?? null} title={series.title} size="md" mediaType="book" />
        <div className="min-w-0 flex-1">
          <h3 className="font-medium break-words">{series.title}</h3>
          <p className={muted}>{meta}</p>
          {total > 0 && <Progress aria-hidden="true" value={Math.min(100, (read / total) * 100)} className="mt-2 max-w-48" />}
        </div>
      </div>
      {controls.seriesCount?.(series)}
      <ul className="mt-2 flex flex-col divide-y divide-border sm:pl-24">
        {series.books.map((book) => (
          <SeriesBook key={book.entryId} book={book} controls={controls} />
        ))}
      </ul>
    </li>
  );
}

function SeriesBook({ book, controls }: { book: SeriesBookRow; controls: RowControls }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 py-2">
      <div className="min-w-0 flex-1 basis-32">
        <h4 className="break-words">{book.position === null ? book.title : `#${book.position} ${book.title}`}</h4>
        <p className={muted}>{bookMeta(book)}</p>
        <PlayCount line={playCountLine("book", book.version, book.playCount)} />
      </div>
      {controls.entry({
        entryId: book.entryId,
        status: book.status,
        playCount: book.playCount,
        again: playAgainLabel("book", book.version),
        name: audioName(book),
      })}
    </li>
  );
}

function Season({ season, showTitle, controls }: { season: SeasonRow; showTitle: string; controls: RowControls }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 py-2">
      <div className="min-w-0 flex-1 basis-32">
        <h4 className="break-words">{seasonLabel(season)}</h4>
        <p className={muted}>Time to finish: {formatDuration(season.runtimeMinutes)}</p>
        <PlayCount line={playCountLine("show", null, season.playCount)} />
      </div>
      {controls.entry({
        entryId: season.entryId,
        status: season.status,
        playCount: season.playCount,
        again: playAgainLabel("show", null),
        name: `${showTitle} · ${seasonName(season.number)}`,
      })}
    </li>
  );
}

function PlayCount({ line }: { line: string | null }) {
  return line && <p className={muted}>{line}</p>;
}

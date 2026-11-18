import type { Translations } from "./i18n";

/** Les erreurs du moteur vidéo sont des phrases anglaises (voir `video-export`, `video_tool.rs`) :
 * celles qu'on sait reconnaître sont affichées dans la langue de l'interface. Les autres (ffmpeg
 * lui-même) restent telles quelles. */
export function engineErrorText(message: string, t: Translations): string {
  const clean = message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  if (/^cancelled$/i.test(clean)) return t.export_cancelled;
  if (/^Nothing to export/i.test(clean)) return t.export_nothing;
  if (/Stabilization is not available/i.test(clean)) return t.export_error_stabilization;
  if (/must differ from the source|same file as the input/i.test(clean)) return t.export_error_same_file;
  if (/^Invalid export options/i.test(clean)) return t.export_error_invalid;
  if (/has no video stream/i.test(clean)) return t.export_error_no_video;
  if (/Another queued export already writes/i.test(clean)) return t.export_error_queue_conflict;
  if (/^No sequence to merge/i.test(clean)) return t.export_error_no_sequence;
  if (/^Too many sequences/i.test(clean)) return t.export_error_too_many_sequences;
  if (/^Too many frames requested/i.test(clean)) return t.export_error_too_many_frames;
  if (/Failed to launch ffmpeg/i.test(clean)) return t.export_error_ffmpeg_missing;
  if (/^Cannot write the (subtitles|motion file|audio file)/i.test(clean)) return t.export_error_write_temp;
  return clean;
}

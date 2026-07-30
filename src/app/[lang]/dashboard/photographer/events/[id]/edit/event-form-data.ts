import type { FormValues } from './edit-event-schema';

/**
 * Build the `FormData` payload `updateEventAction` expects from a parsed form
 * value set. Shared by the full edit form and the section-scoped edit forms so
 * they serialize every field identically — a scoped form still sends the whole
 * event (the unedited fields ride along at their current values), which is what
 * keeps `updateEventAction`'s cross-field invariants (watermark↔public,
 * collaborative share code, reveal gate, minors) intact regardless of which
 * section was edited.
 */
export function buildEventUpdateFormData(
  parsed: FormValues,
  options: { includeBundlePricing?: boolean } = {},
): FormData {
  // T-212: whether THIS form actually edits the ladder. Only a form that renders
  // the ladder editor may speak about it; everything else stays silent and the
  // action leaves the stored columns untouched. See the append site below.
  const { includeBundlePricing = true } = options;
  const formData = new FormData();
  formData.append('name', parsed.name.trim());
  formData.append('activity', parsed.activity);
  formData.append('date', parsed.date);
  // Always send session_time/session_end_time (even empty) so clearing persists
  // as null (T-106/T-180).
  formData.append('session_time', parsed.session_time?.trim() ?? '');
  formData.append('session_end_time', parsed.session_end_time?.trim() ?? '');
  if (parsed.city?.trim()) {
    formData.append('city', parsed.city.trim());
  }
  // Always send state/country (even empty) so switching to a place without one,
  // or clearing, persists (T-107).
  formData.append('state', parsed.state?.trim() ?? '');
  formData.append('country', parsed.country?.trim() ?? '');
  formData.append('is_public', parsed.is_public ? 'true' : 'false');
  formData.append('watermark_enabled', parsed.watermark_enabled ? 'true' : 'false');
  formData.append('is_collaborative', parsed.is_collaborative ? 'true' : 'false');
  formData.append('allow_guest_upload', parsed.allow_guest_upload ? 'true' : 'false');
  formData.append('require_upload_approval', parsed.require_upload_approval ? 'true' : 'false');
  formData.append('ai_matching_enabled', parsed.ai_matching_enabled ? 'true' : 'false');
  formData.append('bib_detection_enabled', parsed.bib_detection_enabled ? 'true' : 'false');
  formData.append('reveal_gate_enabled', parsed.reveal_gate_enabled ? 'true' : 'false');
  // `contains_minors` is read-only post-creation. We still send the current
  // value so the server-side guard can compare and reject any tampering.
  formData.append('contains_minors', parsed.contains_minors ? 'true' : 'false');
  // Volume-pricing ladder (T-203), sent ONLY by a form that actually edits it
  // (T-212). The reverse rule shipped first — always send, absent means clear —
  // and it had two bad consequences, because a scoped form echoes the whole
  // event: (1) a stored ladder the read parser rejects came back as '' and the
  // first unrelated save deleted it, and (2) lowering the price from the Info
  // card validated the echoed ladder and threw `total_not_a_discount` from a
  // section with no way to fix it. Staying silent makes the action treat the
  // field as `absent` and leave the column alone, which is what an edit that
  // isn't about pricing should do.
  if (includeBundlePricing) {
    formData.append('bundle_tiers', parsed.bundle_tiers ? JSON.stringify(parsed.bundle_tiers) : '');
    formData.append(
      'bundle_all_photos_cents',
      parsed.bundle_all_photos_cents !== null ? String(parsed.bundle_all_photos_cents) : '',
    );
  }
  if (parsed.price_per_photo !== undefined && parsed.price_per_photo !== null) {
    const price =
      typeof parsed.price_per_photo === 'string'
        ? Number.parseFloat(parsed.price_per_photo)
        : parsed.price_per_photo;
    if (!Number.isNaN(price) && price >= 0) {
      formData.append('price_per_photo', price.toString());
    }
  }
  return formData;
}

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
export function buildEventUpdateFormData(parsed: FormValues): FormData {
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
  // Volume-pricing ladder (T-203) as JSON. ALWAYS sent, even when null — an
  // absent field means "clear the ladder" server-side, so a scoped form that
  // omitted it would silently wipe the pricing while editing something else.
  // Sending the echoed current value is what makes an unrelated edit a no-op
  // for pricing.
  formData.append('bundle_tiers', parsed.bundle_tiers ? JSON.stringify(parsed.bundle_tiers) : '');
  // Same always-send rule for the "all photos" ceiling — an absent field clears it.
  formData.append(
    'bundle_all_photos_cents',
    parsed.bundle_all_photos_cents !== null ? String(parsed.bundle_all_photos_cents) : '',
  );
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

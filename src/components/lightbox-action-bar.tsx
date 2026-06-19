/**
 * Localized copy for the lightbox's per-photo action icons. Every field is
 * optional — a viewer supplies only the labels it needs (currently the
 * toolbar's "Add to my profile" claim tooltip and the "Uploaded by" caption).
 */
export interface LightboxActionLabels {
  download?: string;
  addToFavorites?: string;
  removeFromFavorites?: string;
  addToProfile?: string;
  addedToProfile?: string;
  addToCart?: string;
  removeFromCart?: string;
  remove?: string;
  tagPeople?: string;
  /** "Uploaded by {name}" template — `{name}` is substituted. */
  uploadedBy?: string;
}

# photo-detail-modal Specification

## Purpose

Present a conversion-focused two-panel photo detail (`PhotoDetailModal`) on paid event browse surfaces — a large image on the left and a dedicated info/CTA panel on the right (attribution, location, date, dimensions, price, and a prominent primary button) — while preserving the existing lightbox for free events, the photographer surface, and any other use. Navigation and image-load logic are shared with the lightbox via extracted hooks and a shared `PhotoCarousel`, and the primary CTA is derived from the viewer's existing action matrix rather than reimplemented.

## Requirements

### Requirement: Two-panel photo detail on paid purchase surfaces

The system SHALL provide a `PhotoDetailModal` component, built on the existing Shadcn `Dialog`, that opens when a talent or guest taps a photo on a **paid** event's browse surface (public event page, talent dashboard event view, and AI face-search results). It SHALL present the photo (via the shared `PhotoCarousel`) and a dedicated info/CTA panel instead of the icon-toolbar lightbox. **Free events SHALL keep the existing lightbox** (no purchase moment). It SHALL NOT provide a secondary full-screen zoom layer.

#### Scenario: Free event keeps the lightbox
- **WHEN** a talent or guest taps a photo on a free (no `price_per_photo`) event
- **THEN** the existing lightbox opens, not the two-panel modal

#### Scenario: Desktop split layout
- **WHEN** the modal opens on a viewport at or above the desktop breakpoint
- **THEN** the image occupies the majority of the width on the left with prev/next controls
- **AND** a fixed-width info/CTA column is shown on the right

#### Scenario: Mobile stacked layout
- **WHEN** the modal opens on a mobile viewport
- **THEN** the image is stacked on top and the info/CTA panel below it
- **AND** the primary button is reachable in the lower (thumb) region
- **AND** the layout respects safe-area insets so controls are not hidden behind browser bars

#### Scenario: Close returns to the gallery
- **WHEN** the user closes the modal (close button, backdrop, or Escape)
- **THEN** the modal dismisses and the underlying gallery grid is shown unchanged

### Requirement: Right info panel content and order

The right info/CTA panel (white background) SHALL display, top to bottom, when the corresponding data is present: uploader/photographer attribution (reusing the existing attribution logic), location, date, pixel dimensions (e.g. `7008 × 4672px`), a "Price per Photo" label with the amount formatted as `<amount> USD` (e.g. `10.00 USD`), and the primary CTA button at the bottom. The panel SHALL NOT contain the share action or the position counter (those live on the image side).

#### Scenario: Fields render from available data in order
- **WHEN** the current photo has an uploader, a location, a date, and known dimensions
- **THEN** the panel shows, in order, the attribution, the location, the date, the dimensions formatted as `<width> × <height>px`, the "Price per Photo" label with `<amount> USD`, and the primary CTA at the bottom

#### Scenario: Missing optional fields are omitted
- **WHEN** the current photo has no location or no known dimensions
- **THEN** those rows are omitted without leaving empty placeholders or breaking layout

#### Scenario: Free event price
- **WHEN** the event is free (no `price_per_photo`)
- **THEN** the "Price per Photo" / amount row is omitted and the primary CTA reflects the free action

### Requirement: Image-side action icons and counter

On the image (left) side, the share action icon SHALL be placed in the top-right corner of the image area, and a position counter reading `n / total` SHALL be placed at the far top-right.

#### Scenario: Share icon on the image
- **WHEN** the modal is open and sharing is available
- **THEN** a share icon is shown in the top-right corner of the image area

#### Scenario: Counter reflects position
- **WHEN** the modal shows photo number `n` of `total`
- **THEN** a counter reading `n / total` is shown at the far top-right

### Requirement: Conditional primary CTA reused from the action matrix

The primary CTA SHALL be derived from the same action flags/gates the viewer already computes for the lightbox (visibility flags, per-photo download gate, purchased/in-cart/in-library state, authentication, guest-cart). The modal SHALL NOT re-implement or hardcode the action decision.

#### Scenario: Paid photo not yet purchased
- **WHEN** the event is paid and the current photo is not in the viewer's purchased set
- **THEN** the primary CTA is "Add to cart" and shows the price
- **AND** for a guest it uses the guest cart, and for an authenticated talent it uses the authenticated cart

#### Scenario: Photo already in the cart
- **WHEN** the current photo is already in the cart
- **THEN** the primary CTA reflects the in-cart state (remove / added) consistent with the existing action state

#### Scenario: Already-purchased photo
- **WHEN** the current photo is in the viewer's purchased set
- **THEN** the primary CTA is the download action for the owned photo

#### Scenario: Auth-only actions gated
- **WHEN** the viewer is an unauthenticated guest
- **THEN** actions that require authentication (e.g. add-to-library / favorite) are not offered, while the guest cart remains available

### Requirement: Navigation reused via shared hooks

Prev/next, keyboard control, and image-load handling SHALL be provided by shared hooks used by both the new modal and the existing lightbox, rather than duplicated. Navigation SHALL wrap around at the ends and update the reported current photo id.

#### Scenario: Prev/next wraps around
- **WHEN** the user advances past the last photo (or before the first)
- **THEN** the modal wraps to the first (or last) photo

#### Scenario: Keyboard control
- **WHEN** the modal is open and the user presses ArrowLeft, ArrowRight, or Escape
- **THEN** the modal navigates previous, navigates next, or closes respectively

#### Scenario: Loading indicator
- **WHEN** the current image has not finished loading
- **THEN** a loading indicator is shown until the image load completes

### Requirement: Existing lightbox preserved

The change SHALL NOT remove or alter the behavior of the existing lightbox. The photographer event surface SHALL keep its existing lightbox/role-action treatment (delete, tag) and SHALL NOT show a purchase CTA. A `detailVariant` switch on the shared album viewer SHALL select which detail component renders per surface.

#### Scenario: Photographer surface unchanged
- **WHEN** a photographer opens a photo in their own event dashboard
- **THEN** the existing lightbox with role actions is shown, with no purchase CTA

#### Scenario: Lightbox still available elsewhere
- **WHEN** a surface does not opt into the purchase variant
- **THEN** it continues to render the existing lightbox unchanged

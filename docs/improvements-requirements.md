# Website Improvements and Feature Implementation

> **Reference only.** The project owner supplied this document ("Fixing.txt") on 2 November 2026. `docs/AGENT_START.md` (BR-63 to BR-66, §6, §11 and milestone M6b) says what is built from it; where they differ, AGENT_START.md wins. How its open points were settled:
> - **Labels:** "Nýr viðburður" is kept in its correct existing form (written `Nýtt viðburð` below). "Mínir viðburðir" (written `Mínar viðburðir` below) and "Kennarasvæði" went with their pages: the student's section on the front page is "Þínir viðburðir", and the managers' is "Viðburðir sem þú sérð um". The `Attach file` button says "Hengja við skrá" in the Icelandic UI and "Attach file" in English.
> - **The 2-per-day limit** is one of the student's own limits, so a teacher adding by hand cannot override it (BR-37).
> - **Without JavaScript**, the core flows still work (§11): `Skrá` and `Afskrá` are plain forms, and the `Nýr viðburður` button is a link to the existing form page.
> - **The old pages:** `/my-events` and `/teacher` redirect to the front page, so old links keep working. A teacher's event-day tools stay on each event's own management page.

## Objective
Improve the existing website's event management, registration, filtering, sorting, navigation, and event creation workflows. Implement the changes directly in the existing codebase while preserving the current design system, Icelandic terminology, and established functionality.

**Important:** Keep all existing Icelandic section names and UI labels in Icelandic, including `Mínar viðburðir`, `Kennarasvæði`, `Stjórnendasvæði`, `Nánar`, `Skrá`, `Afskrá`, `Sía`, `Raða`, and `Nýtt viðburð` (or the existing correct label used in the application).

Before implementing changes, inspect the existing application structure, routing, data models, authentication, and styling. Reuse existing components and logic wherever possible. Avoid duplicating functionality or breaking existing features.

## 1. Add Registration Actions to Event Cards

Add direct registration controls to event cards displayed on the homepage.

- Add a `Skrá` button for events the current user has not registered for.
- Add an `Afskrá` button for events the current user is already registered for.
- Users must be able to register for or unregister from an event directly from the event card without opening `Nánar`.
- Update the registration state and participant count immediately after a successful action.
- Ensure the interface reflects the actual registration state, including after page reloads.
- Prevent duplicate registrations and enforce any existing eligibility or capacity restrictions.
- Provide clear loading, success, and error states.

## 2. Fix and Expand Event Filtering

Fix the existing `Sía` button in the section displaying all other events.

The filtering interface must support the following criteria:

- **Verð:** Filter by event price, supporting appropriate price ranges and free events.
- **Braut:** Filter by the event's track or category.
- **Dagsetning:** Filter by event date or date range.
- **Tími:** Filter by event start time or time range.
- **Fyrir Hádegi / Eftir Hádegi:** Filter events occurring before or after noon.

Requirements:

- Multiple filters must be combinable.
- The event list must update correctly when filters are applied.
- Users must be able to clear individual filters and reset all filters.
- Show a clear active-filter state and an appropriate empty state when no events match.
- Handle missing or incomplete event data gracefully.
- Ensure filtering works consistently across supported screen sizes.

## 3. Add Event Sorting

Add a `Raða` button immediately beside the `Sía` button.

Support the following sorting options:

- **Verð:** Lowest to highest and highest to lowest.
- **Stafrófsröð:** Alphabetical order (A–Z) and reverse alphabetical order (Z–A).
- **Dagsetning:** Earliest to latest and latest to earliest.
- **Tími:** Earliest to latest and latest to earliest.
- **Fyrir Hádegi / Eftir Hádegi:** Sort events by whether they take place before or after noon.

Requirements:

- Filtering and sorting must work together.
- Sorting must use the actual event data rather than display strings.
- Keep sorting stable when events have equal values.
- Provide a clear indication of the currently selected sort option and direction.
- Allow users to return to the default ordering.

## 4. Consolidate Homepage, `Mínar viðburðir`, and `Kennarasvæði`

Simplify navigation by consolidating the relevant functionality into the homepage.

### `Mínar viðburðir`

- Remove the need for a separate `Mínar viðburðir` page when it duplicates the corresponding section on the homepage.
- Make the homepage section the single primary place where users can view and manage their registered events.
- Update navigation links and internal references accordingly.
- Preserve any useful functionality currently available on the separate page.

### `Kennarasvæði`

- Integrate the event creation functionality currently available in `Kennarasvæði` directly into the homepage.
- Teachers must be able to create and manage events without navigating to a separate teacher page.
- Remove redundant navigation and duplicate interfaces once the functionality has been migrated.
- Preserve teacher-specific permissions and functionality.

### `Stjórnendasvæði`

- Keep `Stjórnendasvæði` available as a separate section.
- Preserve its existing functionality, access controls, and administrative permissions.
- Do not remove or unintentionally alter administrator capabilities.

## 5. Add an Event Participation Counter

In the homepage's `Þínir viðburðir` section, display a participation counter in the format:

`0/4`

The counter represents the user's current number of registered events out of a maximum of four.

Requirements:

- Maximum of **4 registered events per user**.
- Maximum of **2 registered events on any single day**.
- Update the counter immediately when the user successfully registers for or unregisters from an event.
- Keep the counter synchronized with the persisted registration data.
- Prevent registration if either limit would be exceeded.
- Display a clear explanation when a registration is blocked because a limit has been reached.
- Enforce these restrictions in the backend or authoritative data layer, not only in the frontend.
- Ensure concurrent registration attempts cannot bypass the limits.

For example, if a user is registered for two events, the counter should display `2/4`. If both events occur on the same day, the user must not be allowed to register for a third event on that day.

## 6. Fix the Hamburger Menu Animation

Fix the hamburger menu animation so it works every time the menu is opened or closed.

Current issue: The animation only plays on the first click.

Requirements:

- Trigger the opening animation on every transition from closed to open.
- Trigger the closing animation on every transition from open to closed.
- Ensure repeated toggling works consistently.
- Synchronize the icon animation, menu visibility, and accessibility state.
- Avoid stale animation state, one-time event handlers, or DOM manipulation that prevents subsequent animations.
- Preserve the existing visual design and responsive behavior.
- Ensure the menu can be operated using keyboard controls and appropriate accessibility attributes.

## 7. Add a Floating `Nýtt viðburð` Button

Add a `Nýtt viðburð` button to the bottom-right corner of the homepage's main content area.

Requirements:

- Position the button at the bottom-right of the main content area.
- Make it visible and easy to access without obstructing important content.
- Use the existing design system and button styles.
- Display it only to users with permission to create events, such as authorized teachers or administrators.
- Clicking the button must open the event creation modal described below, without navigating to another page or opening a new browser tab.

Use the application's established Icelandic label if it differs from `Nýtt viðburð`.

## 8. Build an Event Creation Modal

When the user clicks `Nýtt viðburð`, open a modal overlay on top of the current page.

Do not navigate to another page or open a new browser tab.

### Modal behavior

- Display the modal above the existing homepage.
- Apply a darkened backdrop to the content behind the modal.
- Keep the modal visually distinct and focused.
- Close the modal through a clearly visible close button.
- Support closing with the Escape key when appropriate.
- Prevent unintended interaction with the background while the modal is open.
- Preserve form data when appropriate if the user temporarily closes and reopens the modal.
- Include appropriate validation, loading, error, and success states.

### Modal layout

Use a two-column layout with the following approximate proportions:

- **Left column: 66% of the modal width.** Contains the event creation form.
- **Right column: 33% of the modal width.** Dedicated to event image upload.

Allow a small gap or divider between columns as needed. The proportions should remain approximately 2:1 while adapting to smaller screens.

### Left column: Event details form

Create a clear, structured form using the existing event data model and required fields.

Include the applicable fields for:

- Event title.
- Event description.
- Event date.
- Event start time and, if supported, end time.
- Event price.
- `Braut` or event category.
- Event location, if applicable.
- Maximum participant capacity, if applicable.
- Any additional fields already required by the existing application.

Requirements:

- Use Icelandic labels consistent with the existing interface.
- Clearly mark required fields.
- Validate field formats and required values.
- Show helpful validation messages next to the relevant fields.
- Preserve entered data when validation fails.
- Do not invent new business rules that conflict with the existing application.

### Right column: Event image upload

Add a clear heading, such as `Mynd fyrir viðburð`, so users immediately understand the purpose of this section.

Include:

- An `Attach file` button.
- File selection for uploading an event image.
- A preview of the selected image.
- The ability to replace or remove the selected image.
- Appropriate file-type and file-size validation.
- Upload progress and error feedback when applicable.

Store the image using the application's existing file-storage mechanism. If no suitable mechanism exists, implement one that integrates with the current architecture and security model.

The right column should remain an intentional image-upload area rather than appearing as an unfinished or unexplained empty space.

On smaller screens, adapt the modal into a usable stacked layout while preserving both the event form and image-upload functionality.

## 9. Save New Events as Drafts

Newly created events must **not be published immediately**.

After the teacher submits the creation form:

1. Validate the event details and selected image.
2. Save the event with a `draft` status.
3. Keep the draft associated with its creator.
4. Show a confirmation that the event has been saved as a draft.
5. Make the draft accessible through an appropriate teacher-facing event management interface on the homepage.

### Draft review and preview

Teachers must be able to open a saved draft and review the event before publishing it.

Provide the ability to:

- Review all event details.
- Edit the event information.
- Preview the uploaded image.
- Preview the event as a student would see it on the homepage or event card.
- Review the full event detail view from the student's perspective.
- Save further changes without publishing.
- Publish the event explicitly when it is ready.

The student preview must accurately represent the student-facing UI without exposing teacher-only controls or administrative information.

### Publication and access rules

- Draft events must not appear in public event listings or student-facing event searches.
- Draft events must not be available for student registration.
- Only authorized users may view, edit, or publish their drafts, subject to the application's existing permission model.
- Published events must become visible through the normal event discovery workflow.
- Changing an existing published event must not unintentionally unpublish it unless explicitly required by the existing workflow.
- Enforce draft visibility and publishing permissions in the backend or authoritative data layer.

## 10. Data Integrity, Security, and Compatibility

Across all changes:

- Reuse existing data models, APIs, components, and design tokens wherever possible.
- Preserve existing authentication and authorization behavior.
- Enforce teacher and administrator permissions on the backend.
- Prevent unauthorized users from creating, editing, or publishing events.
- Ensure registration limits are enforced reliably.
- Avoid duplicate event records and duplicate registrations.
- Handle network failures and failed uploads gracefully.
- Preserve existing event and registration data during migrations.
- Keep the existing `Stjórnendasvæði` functional.
- Ensure filtering, sorting, modal behavior, and registration work on desktop and mobile.
- Use Icelandic for user-facing interface text, consistent with the existing application.

## 11. Acceptance Criteria

Consider the implementation complete only when all of the following are verified:

1. Users can register for and unregister from event cards without opening `Nánar`.
2. `Sía` supports price, track, date, time, and before-noon/after-noon filters.
3. `Raða` supports all specified sorting options and directions.
4. Filtering and sorting work together correctly.
5. `Mínar viðburðir` and teacher event creation functionality are integrated into the homepage without unnecessary duplicate pages.
6. `Stjórnendasvæði` remains functional.
7. The `Þínir viðburðir` counter accurately displays the number of registrations out of four.
8. The four-event maximum and two-events-per-day maximum are enforced.
9. The hamburger menu animates correctly on every open and close.
10. The bottom-right `Nýtt viðburð` button opens the event creation modal.
11. The modal has a dark backdrop, a 66% event form column, and a 33% image-upload column.
12. The image-upload area has a clear heading, an `Attach file` button, and an image preview.
13. Newly created events are saved as drafts rather than published immediately.
14. Teachers can review, edit, preview, and explicitly publish their drafts.
15. Students cannot see or register for draft events.
16. Existing functionality, permissions, and data remain intact.

## Implementation Instructions

Work directly in the existing project.

1. Inspect the codebase and identify the relevant pages, components, API endpoints, database models, and styling.
2. Briefly identify the implementation approach and any dependencies or migrations required.
3. Implement the requested changes end to end, including frontend, backend, and database changes where necessary.
4. Reuse existing components and conventions instead of creating redundant systems.
5. Add or update automated tests for registration limits, filtering, sorting, draft visibility, permissions, and event creation.
6. Run the available tests, linting, type checks, and build commands.
7. Fix any regressions introduced by the changes.
8. Report the files changed, implementation decisions, tests performed, and any remaining issues.

Do not stop after providing a plan or mockup. Implement the features in the existing application and verify them wherever the available environment permits. If a requirement cannot be implemented because of a missing dependency, permission, or infrastructure capability, explain the blocker clearly rather than silently omitting the feature.

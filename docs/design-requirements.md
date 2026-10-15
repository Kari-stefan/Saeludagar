# Sæludagar Website. Design and Development Requirements

> **Reference only.** The project owner supplied this document on 15 October 2026, with the red FB logo. `docs/AGENT_START.md` (BR-62 to BR-64, §6, §11 and milestone M5b) says what is built from it; where they differ, AGENT_START.md wins. The project owner decided on 15 October 2026:
> - The site stays bilingual (ÍS/EN, BR-59), although section 1 below says Icelandic only.
> - Login stays kennitala + emailed code (BR-02). Section 6's email field and "Nýskrá" mode are not built, because accounts come from the CSV import and the admin.
> - Everything else is built in milestone M5b, before M6. The Icelandic UI says "viðburðir", not "atburðir" (BR-61).

## 1. Project Overview

Build a modern, mobile-friendly website for **Sæludagar**, a school events platform.

The website must support two main user states:
1. **Gestur**, a visitor who can browse public event information.
2. **Skráður inn**, a user who has logged in and can register for events and view their registered events.

The design should use a **red and white color palette**, with both **light mode and dark mode**.

Prioritize usability, clear navigation, a consistent design, and responsive layouts across mobile phones, tablets, and desktop screens.

All user-facing text must be in Icelandic.

## 2. Design System

### Colors
- Primary color: White.
- Secondary color: Red.
- Light mode: White or light gray backgrounds, dark text, and red accents.
- Dark mode: Dark backgrounds, light text, and red accents.
- Use red for primary buttons, active navigation items, and important interface elements.
- Maintain readable contrast in both modes.

### General Design
- Use a clean, modern, organized layout.
- Use consistent spacing, typography, buttons, borders, and card styles.
- Make interactive elements easy to identify and use.
- Add subtle hover and focus states for buttons, links, and event cards.
- Ensure forms and navigation work with both mouse and keyboard.
- Keep the layout visually consistent across every page.

### Theme Switching
- Include a theme toggle for switching between light and dark mode.
- Apply the selected theme across the entire website.
- Keep the header, event cards, forms, menus, and other components consistent with the selected theme.

## 3. Header and Navigation

Create one shared header component used across all website pages.

### Desktop Header

The header must contain:

- **Left:** The Sæludagar logo.
- **Center:** The title "Sæludagar".
- **Below the title:** A navigation bar containing:
  - "Heimasíða", which navigates to the main events page.
  - "Upplýsingar", which navigates to the information page.
- **Top right:** An "Innskráning" button.
- A theme toggle for switching between light and dark mode.

Keep the logo on the left, the title and navigation centered, and the login button on the right.

### Mobile Header

On mobile screens:

- Replace the desktop navigation with a hamburger menu icon.
- Keep the logo and website title visible.
- Display the hamburger menu on the right.
- When the hamburger icon is pressed, open a side navigation drawer that slides in from the side.
- The drawer must contain the same navigation links and actions as the desktop header, including:
  - Heimasíða
  - Upplýsingar
  - Innskráning or the signed-in user status
  - Theme toggle
- Include a clear way to close the drawer.
- Allow the drawer to close when the user selects a navigation item or presses Escape.

The header must remain consistent across the main page, information page, and other relevant pages.

## 4. Guest Homepage

The homepage is the primary event discovery page for visitors who are not logged in.

### Event Grid

Display available events as cards in a responsive grid.

Each event card must contain:

- Event image.
- Event title.
- Short description.
- Price.
- Number of participants.
- A "Nánar" button that opens the event details page.

The event cards should have consistent styling and image proportions.

### Desktop Layout

- Display a maximum of four event cards per row.
- Adjust the number of columns according to the available screen width.
- Keep the event search and sorting controls above the event grid, aligned to the right.

### Mobile Layout

- Display a maximum of two event cards per row on mobile screens where the available width allows it.
- On narrow screens, reduce the grid to one column when necessary.
- Place search and sorting controls above the event cards.
- Allow controls to wrap onto separate lines to prevent horizontal overflow.
- Keep buttons large enough to tap comfortably.

### Search and Sorting

Place the following controls above the event grid:

1. A text input where visitors can enter an event name.
2. A "Leita" button that filters events by name.
3. A "Sía" button that opens sorting options.

The sorting menu should allow users to choose an ordering, such as:

- Dagsetning, elst fyrst.
- Dagsetning, nýjast fyrst.
- Verð, lægst fyrst.
- Verð, hæst fyrst.
- Nafn, A til Ö.
- Nafn, Ö til A.

Search and sorting must work together. Applying one must not reset the other.

Display a helpful message if no events match the search.

## 5. Event Details Page

When a visitor presses "Nánar" on an event card, open a dedicated event details page.

Display:

- Event image.
- Event title.
- Full event description.
- Date and time.
- Location.
- Price.
- Number of participants or available places.
- A button to register for the event.

If the visitor is not logged in, ask them to sign in before completing event registration. After successful sign-in, allow them to return to the selected event.

Do not allow duplicate registrations for the same event.

## 6. Sign-In and Registration Page

Create a dedicated authentication page with a centered form box.

### Layout

- Place a back button in the top-left corner.
- The back button should return the user to the homepage.
- Center the form vertically and horizontally when screen space allows.
- Make the form responsive and easy to use on mobile devices.
- Use the same red, white, light mode, and dark mode design system as the rest of the website.

### Authentication Form

The form must contain:

- An "Email" input field.
- A "Kennitala" input field.
- A primary action button.
- A text link for switching between login and registration.

### Registration Mode

- Show the email and kennitala input fields.
- The primary button should say "Nýskrá".
- The link should allow users to switch to login mode.

### Login Mode

- Show the email and kennitala input fields.
- The primary button should say "Innskrá".
- The link should allow users to switch to registration mode.

Use clear labels, input validation, and helpful error messages.

The form must not submit when required fields are empty or invalid.

Implement authentication securely if a backend is available. Do not treat a user as authenticated merely because they entered an email and kennitala. If authentication is not connected to a backend, clearly separate the demonstration interface from real authentication.

## 7. Signed-In User Header

When a user successfully signs in:

- Replace the "Innskráning" button with a visible status element containing the text "Skráður inn".
- Keep the header layout consistent.
- Show the same status in the mobile navigation drawer.
- Ensure the user can distinguish their signed-in state from the guest state.

## 8. Signed-In Homepage

When a user is logged in, keep the same overall homepage design as the guest homepage, but divide the events into two sections.

### Section A: Þínir atburðir

Place this section at the top of the main content.

It must contain:

- A section heading: "Þínir atburðir".
- A responsive grid of events the user has registered for.
- The same event card design used on the guest homepage.
- Search and sorting controls specific to this section.

Sort the user's registered events by date and time by default, with the earliest upcoming event first.

Allow users to search their registered events by name and sort them independently using the available sorting options.

When the user has not registered for any events, display a message such as:

"Þú hefur ekki skráð þig á neina atburði ennþá."

Include a link or button that takes them to the other available events.

### Section B: Aðrir atburðir

Display all other available events below the "Þínir atburðir" section.

Requirements:

- Add a clear section heading: "Aðrir atburðir".
- Use the same responsive event grid as the guest homepage.
- Include a separate search input, "Leita" button, and "Sía" button.
- Allow the user to search and sort these events independently of their registered events.
- Exclude events for which the user is already registered.

Keep the two sections visually distinct and organized.

Registering for an event must immediately update the interface so that the event moves from "Aðrir atburðir" to "Þínir atburðir".

## 9. Information Page

Create an "Upplýsingar" page that explains what Sæludagar is and provides relevant information about the event platform.

Use the shared header and responsive design system.

The page should have a clear title, readable content, and an organized layout that works on both desktop and mobile.

Do not invent specific school policies, event rules, or contact information. Use placeholders when the required information has not been provided.

## 10. Responsive Design Requirements

Use a mobile-first approach.

The website must adapt to:

- Mobile phones.
- Tablets.
- Laptops.
- Desktop monitors.

Requirements:

- No horizontal page overflow.
- Responsive navigation.
- Responsive event cards and images.
- Forms that fit within narrow screens.
- Search and sorting controls that wrap when necessary.
- Consistent spacing and readable text sizes.
- Touch-friendly buttons and controls.
- Responsive layouts for both light and dark mode.

## 11. Functionality Requirements

All visible controls must work.

Implement:

- Navigation between pages.
- Mobile hamburger menu and side drawer.
- Light and dark mode switching.
- Event search.
- Event sorting.
- Event details navigation.
- User registration and login.
- Event registration.
- Duplicate-registration prevention.
- Separate registered and unregistered event sections.
- Independent search and sorting for both sections.
- Responsive behavior at different screen widths.
- Input validation and appropriate error messages.

Use reusable components for the header, event cards, search controls, sorting menus, authentication form, and theme toggle.

Store and manage event data consistently. If a backend is available, persist user accounts and event registrations securely. If a backend is not available, use clearly identified sample data and demonstration behavior rather than claiming that real registrations or authentication have been saved.

## 12. Implementation and Quality Checks

Before considering the website complete, verify the following:

- The desktop header matches the specified layout.
- The mobile header uses a working hamburger menu.
- The event grid displays no more than four columns on desktop and two on mobile, reducing to one on narrow screens.
- Search and sorting work together correctly.
- Light and dark modes work on every page.
- Login and registration modes switch correctly.
- A signed-in user sees "Þínir atburðir" above "Aðrir atburðir".
- Registered events appear in the correct section and sort by date and time.
- Each event's "Nánar" button opens the correct details.
- Users cannot register for the same event twice.
- The layout works on different screen sizes.
- There are no broken links, nonfunctional buttons, or horizontal scrolling issues.

Build a complete, working website rather than a static visual mockup. If a required backend service or piece of information is missing, identify the dependency and implement the remaining functionality using a clearly labeled demonstration setup.

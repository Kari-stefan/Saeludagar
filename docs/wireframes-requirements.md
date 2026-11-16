# Implementation Task: Event Details & Fjarvistastig

> **Reference only.** The project owner supplied this document ("Wireframes-Agent.txt") on 12 November 2026. `docs/AGENT_START.md` (BR-17, BR-23, BR-27, BR-38, BR-41, BR-67 to BR-69, §6, §11 and milestone M6c) says what is built from it; where they differ, AGENT_START.md wins. The project owner decided on 13 November 2026:
> - **"Hópur"** lists the students signed up for the event, and only the event's owner, its co-teachers and admins see it. Everyone else sees how many are signed up, because students never see each other's names (BR-23, BR-68).
> - **The steppers on "Fjarvistastig"** move 4 points at a time: the 4 points of one attendance go to one course, and a course takes at most 4 (BR-40, BR-42, BR-69). The counter shows points, such as "4/12".
> - **Images:** an event has up to 5 (BR-27), which changed the data model (schema version 3).
> - **A course that leaves a student's list** in a later import gives its points back to the student (BR-17).
> - **Student event managers** (open question 21): nobody marks their own attendance, and the role can be taken away only from a student (BR-38, BR-67).
>
> Settled while building, and confirmed by the project owner on 16 November 2026:
> - **"Nánari Upplýsingar"** is the "Nánar" button the event cards already have. The label stays, as the improvements brief asked.
> - **The event manager's email** is shown to logged-in users only, and a student who runs an event is named only to those who manage it (BR-68).
> - **After the course-choice deadline** an import that drops a course keeps the choice instead of clearing it, because the student could no longer give the points to another course (BR-17).
> - **A "class"** is a course code from the imported student list. The site has no course names.
> - **The event's facts and the sign-up box**, which the wireframe leaves out, stay on the page: the facts under the title, and the sign-up box at the top of the right column.

## Role

Act as a senior full-stack developer working within the existing application. Your task is to implement the two features described below, following the project's current architecture, design language, coding conventions, and technology stack.

Do not rebuild the application or introduce unnecessary dependencies.

## 1. Before Implementation

First, inspect the existing project to understand:

- The frontend framework and project structure.
- Existing routing and navigation.
- The shared header and footer components.
- Existing page layouts, especially the page named "Innskŕaning" in the wireframe.
- Existing styling conventions, reusable components, and responsive breakpoints.
- Existing event, user, member, class, and attendance data structures.
- Existing backend endpoints and data persistence mechanisms.

Reuse existing components and functionality wherever appropriate.

Do not modify unrelated pages or functionality.

---

# FEATURE 1: Event Details ("Nánari Upplýsingar")

## Objective

Implement the detailed event view that appears when a user presses the **"Nánari Upplýsingar"** button.

The page must display event images, the event description, event organizer information, and the event member list.

## 1.1 Page Layout

The existing application header and footer must remain consistent across the application.

The main content area must contain two vertical columns:

- Left column: 60% of the available content width.
- Right column: 40% of the available content width.

Both columns contain vertically stacked content boxes.

### Left Column — 60%

**Box 1: Event Image Carousel**

Display the images uploaded by the event manager.

Requirements:

- Display one primary image at a time.
- Include a left arrow and right arrow for navigation.
- Users must be able to cycle through all available event images.
- Give the carousel a layered visual appearance, suggesting that additional images exist behind the currently displayed image.
- Update the primary image when the user navigates.
- Handle events with only one image or no images gracefully.
- Images should maintain an appropriate aspect ratio without unwanted distortion.

**Box 2: Event Description**

Display the event description entered by the event manager.

Requirements:

- Retrieve the description associated with the selected event.
- Preserve the description's intended formatting where supported by the existing application.
- Allow the content box to expand vertically to accommodate longer descriptions.

### Right Column — 40%

**Box 1: Event Manager Information**

Create an information box displaying the person responsible for organizing the event.

Display the following information in this order:

1. Event Manager Name
2. Event Manager Email

Use the information associated with the selected event.

**Box 2: Event Member List**

Create a member information box.

At the top of the box, display the heading:

**"Hópur"**

Below the heading, display the event members in a vertical list.

Each member should have:

1. Name
2. Email

Retrieve members associated with the selected event.

The list should accommodate multiple members and longer lists without breaking the layout.

## 1.2 Responsive Behavior

The desktop layout must use the 60% / 40% column split.

On mobile:

- Collapse the main two-column layout into a single-column layout.
- Stack content boxes vertically.
- Keep the event manager information box above the member list.
- The "Hópur" member list must appear directly below the event manager information box.
- Ensure the image carousel remains usable on touchscreens.
- Prevent horizontal overflow.
- Ensure text, images, and content boxes fit the available screen width.

---

# FEATURE 2: Fjarvistastig

## Objective

Implement a new application page that allows users to allocate their earned **Fjarvistastig** (absence points) across the classes they currently attend.

The system should behave similarly to a skill-point allocation system in a game.

Users earn points by fully attending events. Earned points can then be allocated using number steppers.

## 2.1 Navigation

Add a new navigation tab to the existing application header.

The exact tab label must be:

**"Fjarvistastig"**

Requirements:

- Follow the existing navigation design.
- The tab must navigate to the new Fjarvistastig page.
- Preserve the existing header and footer.
- Ensure the navigation works on desktop and mobile.

## 2.2 Page Layout

The main content should use a centered layout similar to the existing "Innskŕaning" page.

There must be two primary content areas:

**Area 1: Available Fjarvistastig Counter**

Position a counter box near the top-left of the main content area.

The counter must display the user's point balance in this format:

`x/x`

Interpretation:
- First number: Remaining points available to allocate.
- Second number: Total points earned.

For example, `3/5` means the user has earned 5 points and has 3 points remaining to allocate.

Update the counter whenever the user changes a class allocation.

**Area 2: Class Allocation Box**

Create a centered content box containing a vertical list of classes.

Each row must contain the following elements, in this order from left to right:

1. Class Name
2. Number Stepper

Requirements:

- Generate one row for each class the user is currently attending.
- Display the corresponding class name.
- Provide a number stepper for each class.
- The number stepper must support increasing and decreasing the allocated points.
- Values must be whole numbers.
- The minimum value must be zero.
- The combined allocation across all classes must never exceed the user's available Fjarvistastig.
- Prevent users from allocating more points than they have earned and have available.
- Update the available-points counter immediately when an allocation changes.

The number of class rows must reflect the user's current class enrollment.

## 2.3 Fjarvistastig Business Logic

Implement the following rules:

1. Users earn Fjarvistastig after fully attending an event.
2. Points earned must be associated with the correct user.
3. Users can allocate their available points across their currently attended classes.
4. A point can only be allocated once.
5. Decreasing an allocation returns that point to the available balance.
6. The total allocated points must never exceed the total earned points.
7. Existing allocations must be retained when the user revisits the page, provided the application supports persistent storage.
8. Users must not be able to manipulate the frontend to allocate more points than their actual available balance.

Enforce important allocation restrictions in the backend as well as the frontend wherever backend functionality exists.

Do not fabricate points, classes, attendance records, or user information.

## 2.4 Responsive Behavior

On desktop:

- Display the available Fjarvistastig counter near the top-left of the main content area.
- Display the class allocation box centrally within the main content area.

On mobile:

- Place the available Fjarvistastig counter above the class allocation box.
- Display the class allocation rows vertically.
- Ensure number steppers are comfortably usable on touchscreens.
- Prevent horizontal overflow.

---

# 3. Design and Implementation Requirements

Both features must feel like part of the existing application.

Follow these requirements:

- Reuse the existing header and footer.
- Reuse existing typography, colors, spacing, borders, and component styles.
- Maintain visual consistency with the existing application.
- Use the existing routing system.
- Use existing data models and backend services wherever possible.
- Implement responsive layouts rather than simply scaling down desktop layouts.
- Use accessible labels and controls.
- Ensure carousel navigation and number steppers are keyboard accessible.
- Provide appropriate empty, loading, and error states using existing application conventions.
- Avoid unnecessary dependencies and duplicated code.
- Do not introduce unrelated features.

If a required backend operation or data model does not exist, identify the missing functionality rather than pretending it works.

---

# 4. Acceptance Criteria

The implementation is considered complete only when all the following requirements are met.

## Event Details

- [ ] Pressing "Nánari Upplýsingar" opens the correct event details.
- [ ] Existing header and footer remain unchanged.
- [ ] Desktop content uses a 60% left column and 40% right column.
- [ ] The left column displays an image carousel.
- [ ] Carousel arrows correctly navigate between images.
- [ ] The event description is displayed.
- [ ] Event manager name and email are displayed.
- [ ] The right column contains a member list headed "Hópur".
- [ ] Each member's name and email are displayed.
- [ ] Mobile layout stacks the content vertically.
- [ ] The member list appears below the event manager information on mobile.

## Fjarvistastig

- [ ] A new "Fjarvistastig" navigation tab exists.
- [ ] The tab opens the correct page.
- [ ] The page follows the existing "Innskŕaning" layout style.
- [ ] An `x/x` points counter is displayed.
- [ ] One class row is displayed for each currently attended class.
- [ ] Each row contains a class name and number stepper.
- [ ] Number steppers cannot go below zero.
- [ ] Users cannot allocate more points than they have available.
- [ ] The available-points counter updates when allocations change.
- [ ] Fully attending an event earns Fjarvistastig.
- [ ] Point allocation and earned-point data are handled consistently.
- [ ] Mobile layout places the points counter above the allocation box.

## Quality Assurance

- [ ] No existing unrelated functionality is broken.
- [ ] No horizontal overflow occurs on mobile.
- [ ] No console errors are introduced.
- [ ] Existing application conventions are followed.
- [ ] All implemented functionality uses real application data rather than fabricated placeholder data.

---

# 5. Final Instructions to the Agent

Work directly within the existing project.

Do not stop after producing a visual mockup. Implement the actual functionality using the application's existing architecture.

Follow this execution order:

1. Inspect the project and identify the relevant components, pages, data models, and services.
2. Implement the Event Details feature.
3. Implement the Fjarvistastig feature.
4. Connect both features to the existing application data and backend where supported.
5. Implement desktop and mobile responsive behavior.
6. Run the available tests, linting, and build checks.
7. Fix any errors introduced by the implementation.
8. Review the acceptance criteria and report which requirements have been completed.

At the end, provide a brief implementation report containing:

- Files created or modified.
- Features implemented.
- Backend changes or dependencies.
- Tests and build checks performed.
- Any requirements that could not be completed and why.

Prioritize a working, integrated implementation over a superficial visual approximation.

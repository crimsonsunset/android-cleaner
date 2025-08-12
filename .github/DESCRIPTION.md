# Repository Description

SvelteKit web application for managing Android apps via ADB commands. Features batch processing, metadata analysis, and bulk operations for device cleanup.

## Key Features
- Batch app processing and uninstallation
- Real app names via AAPT integration
- Device detection and management
- App metadata analysis (install dates, sizes, sources)
- Bulk selection and range operations

## Technical Stack
- Frontend: SvelteKit + DaisyUI + TailwindCSS
- Backend: SvelteKit API routes + Node.js ADB integration
- Android: ADB commands + Android SDK build-tools

## Use Case
Primarily designed for device cleanup before migrations (e.g., Samsung Fold 5 → Fold 7), but useful for any Android app management tasks.

## Status
Functional with core features working. Currently undergoing architecture refactoring (Phase 5.5) to improve maintainability before distribution implementation.

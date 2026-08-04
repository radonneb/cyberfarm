# Native integration status

## Validation performed for this package

- All three SQL migrations were applied in sequence to an empty SQLite database without SQL errors.
- The changed frontend and Pages Functions passed a TypeScript static check using local ambient declarations.
- Grain Bunker source formulas passed the 10 numerical assertions preserved from the original standalone calculator.
- A full Vite production build could not be executed in the editing environment because the npm registry was unreachable. Run `npm install && npm run build` on the target Mac before applying the remote D1 migration.

## Implemented

### Farm foundation

- `farms`
- `farm_memberships`
- `farm_module_permissions`
- `user_preferences.active_farm_id`
- `farm_imports`
- `projects.farm_id`
- farm-scoped project APIs
- farm-scoped R2 upload keys
- server-side active-farm selection

### Browser storage quota fix

The following legacy keys are removed on startup and are no longer used for project geometry:

- `gargha_import_history`
- `gargha_current_taskdata`
- `gargha_current_file_name`
- `cyberfarm_active_project`

Import history records only metadata in D1. Full `TaskDataModel` snapshots are not serialized to browser storage.

### Workspace

- compact glass icon rail
- profile/farm switcher
- create-farm action
- create-new-farm or add-to-current-farm import choice
- SHA-256 import fingerprint metadata
- automatic project save indicator
- source-file upload and deletion
- field deletion remains available through Edit and is automatically persisted

### Pivot Track

- free mode and existing-field mode
- automatic initial pivot center from field geometry
- draggable/manual center correction
- circle and sector modes
- individual wheel width and enabled state
- click-to-toggle wheel markers
- irrigation sweep trace
- track area in m², ha and percent
- per-field configuration stored inside farm project data

### Grain Bunker

- simple and advanced modes
- Case IH AFS 9240/9250 and John Deere S680/S790 presets
- six crop groups and 120 source density profiles
- original moisture, tank-shape, impurity, calibration and yield calculations
- field-area selection from imported fields
- TXT calculation export
- explicit estimator warning

## Remaining planned work

### Authentication and access

- one-time invitation tokens
- email delivery
- accept-invite page
- password setup/reset
- editor/viewer farm roles in the admin interface
- per-module permission matrix and enforcement

### GeoTIFF

- field-linked raster records
- R2 original/preview objects
- large-file upload flow
- raster rendering and clipping
- legends, opacity and layer order
- raster deletion

### Routes

- route session storage
- CSV/TXT upload
- time filtering and gap segmentation
- simplified reference-line generation
- deviation statistics and map colouring

### Data model

- normalized fields/boundaries/guidance tables
- independent server operations for field deletion and geometry edits
- audit log

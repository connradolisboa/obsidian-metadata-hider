I vibe-coded the fixes and improvements with Claude. All props to https://www.buymeacoffee.com/benature

Major fixes:
	•	Fixed rule conflicts
	•	Fixed inconsistent hiding (checkboxes, camel cases, numbers)
	•	Fixed priority bugs
	•	Fixed folder/tag logic conflicts 
	•	Fixed metadata refresh issues

Major new features:
	•	Show rules
	•	Value-based rules
	•	Folder/tag auto-fold
	•	Rule priority system
	•	Drag-and-drop UI
	•	Regex improvements



Overview

Metadata Hider gives you complete control over which properties are visible in Obsidian.

Hide, show, or conditionally control metadata based on:
	•	Property name
	•	Property value
	•	Folder
	•	Tag
	•	Regex patterns
	•	Rule priority

You can also auto-fold metadata only where you want.

Everything is controlled through a unified rule system.

⸻

Major Features

Rule-based visibility system

Each rule can:
	•	Hide a property
	•	Show a property
	•	Apply only in specific folders
	•	Apply only to specific tags
	•	Apply only when the property has a specific value
	•	Match using exact name or regex

This allows full context-aware metadata visibility.

⸻

First-match-wins priority system

Rules are evaluated from top to bottom.

The first matching rule decides the outcome.

This fixes previous conflicts and makes behavior predictable.

You can reorder rules using:
	•	Drag-and-drop
	•	Up / Down buttons

Each rule displays a priority number.

⸻

Show rules (new)

You can now explicitly show properties.

Example:

Show status in:

Projects/

Hide it everywhere else.

⸻

Value-based conditions (new)

Rules can trigger only when a property has specific values.

Example:

Hide:

status = Cancelled

But show:

status = Active

Supports:
	•	Text
	•	Select
	•	Multi-select
	•	Numbers

Supports multiple values:

Cancelled, Done

Case-insensitive.

⸻

Folder and tag filtering

Rules can apply only when:

File is inside a folder:

Projects/Clients

Or file contains a tag:

#private

Both filters can be combined.

⸻

Regex support

Match multiple properties using regex.

Example:

Hide all internal properties:

^_


⸻

Auto-fold metadata (improved)

You can now auto-fold metadata:

Globally

OR

Only in specific folders or tags.

Example:

Auto-fold only in:

Journal/

But keep expanded in:

Projects/


⸻

Works everywhere in Obsidian

Supports hiding in:
	•	Properties table
	•	File properties panel
	•	All properties panel
	•	Live Preview
	•	Reading view

Updates instantly when:
	•	Opening files
	•	Editing properties
	•	Saving files

⸻

Examples

Example 1 — Hide internal properties

Rule:

Action: Hide
Name:

^_

Regex: enabled

Result:

_private
_internal

Hidden everywhere.

⸻

Example 2 — Hide cancelled projects only

Rule:

Action: Hide
Name:

status

Value equals:

Cancelled

Folder:

Projects/


⸻

Example 3 — Show status only in Projects

Rule 1:

Show:

status

Folder:

Projects/

Rule 2:

Hide:

status

Global

⸻

Example 4 — Auto-fold Journal metadata

Auto-fold rule:

Folder:

Journal/


⸻

Settings

Open:

Settings → Community Plugins → Metadata Hider

You can:
	•	Add rules
	•	Choose Hide or Show
	•	Add value conditions
	•	Add folder filters
	•	Add tag filters
	•	Enable regex
	•	Reorder priority
	•	Add auto-fold rules
	•	Import / Export settings

⸻

What’s New

v1.4.0

Major UI improvements
	•	Drag-to-reorder rules
	•	Priority indicators
	•	Improved settings layout

⸻

v1.3.0

Auto-fold rules added
	•	Folder-based folding
	•	Tag-based folding

⸻

v1.2.0

Value-based hiding added
	•	Hide based on property value
	•	Multiple values supported
	•	Live updates while editing

⸻

v1.1.0

Major rule engine rewrite
	•	First-match-wins priority
	•	Show rules added
	•	Multiple rules per property allowed

⸻

v1.0.x

Original functionality
	•	Hide empty properties
	•	Always show properties
	•	Basic filters

⸻

Install

Community Plugins (recommended)

Open:

Settings → Community Plugins → Browse

Search:

Metadata Hider

Install and enable.

Or click:

https://obsidian.md/plugins?id=metadata-hider

⸻

BRAT (beta)

Install:

BRAT plugin

Add repository:

https://github.com/Benature/obsidian-metadata-hider

Enable plugin.

⸻

Build

Clone repo:

git clone https://github.com/Benature/obsidian-metadata-hider

Install:

npm install

Build:

npm run build

Dev mode:

npm run dev


⸻

Why this plugin exists

Obsidian properties are powerful.

But large vaults become cluttered.

Metadata Hider gives you precise control.

Your metadata appears only when useful.

⸻

Support

If this plugin helps you, consider supporting the developer:

Buy Me a Coffee:

https://www.buymeacoffee.com/benature



# macOS permissions and application builds

Permissions are checked for the running application, using public macOS APIs.
The list in System Settings can contain an enabled Ovule entry whose code
requirement no longer matches the current build. An enabled entry by name is
not evidence that the running process has access.

A confirmed example from the local TCC diagnostic log was:

```
Failed to match existing code requirement for subject io.ovule.desktop
and service kTCCServiceScreenCapture

Failed to match existing code requirement for subject io.ovule.desktop
and service kTCCServiceAccessibility
```

The old and running requirements were different `cdhash` values. Ad-hoc signed
packages use such a requirement, so replacing or rebuilding a package can
invalidate an earlier grant even when the bundle ID and app name stay the same.
Moving a matching signed copy does not by itself prove a different grant.

Use About Ovule to find the actual running app, its signature and other
registered copies. If an old grant no longer matches, remove the old entry in
System Settings and add the running app from Finder. Fully quit and reopen
Ovule after changing access. Refresh re-runs checks and displays completion;
it cannot migrate an old code requirement or grant access itself. Production
builds should use a consistent signing identity and designated requirement.
Do not weaken the code requirement to trust any app with the same bundle ID.

Permission actions differ:

- Screen Recording and Accessibility request access through their public APIs.
- Input Monitoring uses `CGRequestListenEventAccess` on an explicit click; a
  settings link alone does not register the app.
- Files and Folders is requested when accessing protected folders, or the user
  can select a folder using a file picker. There is no generic folder grant.
- Full Disk Access requires the user to add/enable the app in System Settings.
  The UI provides settings and Finder links; there is no programmatic grant.
- Automation requires an Apple Events integration and consent for each target
  app. No integration is currently enabled. Opening the Automation pane does
  not create an Ovule entry, so the UI does not offer a misleading grant button.

The permission checks do not read or modify the TCC database, reset grants or
request any access automatically. A recent successful local screenshot is
reported separately as observed capture capability, not a permanent OS grant.

The permission row also offers **Repair access** for unavailable permissions in
an ad-hoc build. Its confirmation explains that it resets only the selected
Screen Capture or Accessibility service for the running Ovule bundle ID (all
same-ID copies are affected), then requests access again through the public
API. It invokes `/usr/bin/tccutil reset <fixed-service> <current-bundle-id>`
without a shell, after checking the current application identity. It never
resets all services or runs as part of refresh/startup. The user must still
approve access in macOS and restart Ovule. A stable signing identity is needed
to avoid repeating this after each new ad-hoc package.
